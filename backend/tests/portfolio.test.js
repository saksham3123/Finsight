import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { pool, setup } from "./helpers.js";

let ctx;
let user;
let tcs;
let btc;
before(async () => {
  ctx = await setup();
  user = await ctx.register();
  tcs = await ctx.addPrices("TCS", 2, (i) => (i === 0 ? 3000 : 3300)); // yesterday 3000, today 3300
  btc = await ctx.addPrices("BTC", 1, 50000);
});
after(() => ctx.close());

describe("assets", () => {
  test("list is public and includes the latest quote and daily change", async () => {
    const res = await ctx.request("GET", "/assets?type=stock&q=tcs");
    assert.equal(res.status, 200);
    assert.equal(res.body.assets.length, 1);
    const [asset] = res.body.assets;
    assert.equal(asset.symbol, "TCS");
    assert.equal(asset.latestPrice, 3300);
    assert.equal(asset.previousClose, 3000);
    assert.equal(asset.changePct, 10);
  });

  test("search treats LIKE wildcards literally", async () => {
    const res = await ctx.request("GET", "/assets?q=%25");
    assert.equal(res.body.assets.length, 0);
  });

  test("price history returns dates as YYYY-MM-DD strings in ascending order", async () => {
    const res = await ctx.request("GET", `/assets/${tcs}/prices`);
    assert.equal(res.status, 200);
    assert.equal(res.body.prices.length, 2);
    assert.match(res.body.prices[0].date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(res.body.prices[0].date < res.body.prices[1].date);
  });

  test("invalid and unknown ids return 400 and 404", async () => {
    assert.equal((await ctx.request("GET", "/assets/not-a-uuid")).status, 400);
    assert.equal((await ctx.request("GET", "/assets/00000000-0000-0000-0000-000000000000")).status, 404);
  });

  test("only admins can create assets", async () => {
    const body = { symbol: "WIPRO", name: "Wipro Ltd", assetType: "stock", exchange: "NSE" };
    assert.equal((await ctx.request("POST", "/assets", { token: user.token, body })).status, 403);
    const admin = await ctx.loginAdmin();
    const res = await ctx.request("POST", "/assets", { token: admin.token, body });
    assert.equal(res.status, 201);
    assert.equal(res.body.asset.currency, "INR");
    assert.equal((await ctx.request("POST", "/assets", { token: admin.token, body })).status, 409);
  });
});

describe("watchlist", () => {
  test("add, list (with quotes), re-add idempotently, remove", async () => {
    const add = await ctx.request("POST", "/watchlist", { token: user.token, body: { assetId: tcs } });
    assert.equal(add.status, 201);
    const again = await ctx.request("POST", "/watchlist", { token: user.token, body: { assetId: tcs } });
    assert.equal(again.status, 200);

    const list = await ctx.request("GET", "/watchlist", { token: user.token });
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].latestPrice, 3300);

    assert.equal((await ctx.request("DELETE", `/watchlist/${tcs}`, { token: user.token })).status, 204);
    assert.equal((await ctx.request("DELETE", `/watchlist/${tcs}`, { token: user.token })).status, 404);
  });
});

describe("transactions and holdings", () => {
  test("buys update quantity and weighted average cost exactly", async () => {
    const a = await ctx.request("POST", "/transactions", { token: user.token, body: { assetId: tcs, type: "buy", quantity: 10, price: 3000 } });
    assert.equal(a.status, 201);
    const b = await ctx.request("POST", "/transactions", { token: user.token, body: { assetId: tcs, type: "buy", quantity: "5", price: "3600" } });
    assert.equal(b.status, 201);

    const { rows } = await pool.query("SELECT quantity::text, avg_buy_price::text FROM holdings WHERE user_id = $1 AND asset_id = $2", [user.user.id, tcs]);
    assert.equal(rows[0].quantity, "15.00000000");
    assert.equal(rows[0].avg_buy_price, "3200.00000000"); // (10*3000 + 5*3600) / 15
  });

  test("price defaults to the latest close", async () => {
    const res = await ctx.request("POST", "/transactions", { token: user.token, body: { assetId: btc, type: "buy", quantity: "0.12345678" } });
    assert.equal(res.status, 201);
    assert.equal(res.body.transaction.price, 50000);
    assert.equal(res.body.transaction.quantity, 0.12345678);
  });

  test("selling more than held is rejected and changes nothing", async () => {
    const res = await ctx.request("POST", "/transactions", { token: user.token, body: { assetId: tcs, type: "sell", quantity: 16, price: 3300 } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Insufficient/);
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM transactions WHERE user_id = $1 AND txn_type = 'sell'", [user.user.id]);
    assert.equal(rows[0].n, 0);
  });

  test("a sell reports realized P&L after fees", async () => {
    const res = await ctx.request("POST", "/transactions", { token: user.token, body: { assetId: tcs, type: "sell", quantity: 5, price: 3300, fees: "20" } });
    assert.equal(res.status, 201);
    assert.equal(res.body.realizedPnl, 480); // (3300 - 3200) * 5 - 20
  });

  test("selling everything removes the holding", async () => {
    await ctx.request("POST", "/transactions", { token: user.token, body: { assetId: btc, type: "sell", quantity: "0.12345678", price: 51000 } });
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM holdings WHERE user_id = $1 AND asset_id = $2", [user.user.id, btc]);
    assert.equal(rows[0].n, 0);
  });

  test("invalid quantities are rejected", async () => {
    for (const quantity of [0, -1, "1.123456789", "abc"]) {
      const res = await ctx.request("POST", "/transactions", { token: user.token, body: { assetId: tcs, type: "buy", quantity, price: 1 } });
      assert.equal(res.status, 400, `quantity ${quantity}`);
    }
  });

  test("transactions are listed newest first and are private to the user", async () => {
    const mine = await ctx.request("GET", "/transactions", { token: user.token });
    assert.equal(mine.body.transactions.length, 5);
    const other = await ctx.register();
    const theirs = await ctx.request("GET", "/transactions", { token: other.token });
    assert.equal(theirs.body.transactions.length, 0);
  });
});

describe("portfolio", () => {
  test("values holdings at the latest close with P&L and totals per currency", async () => {
    const res = await ctx.request("GET", "/portfolio", { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.holdings.length, 1);
    const [h] = res.body.holdings;
    assert.equal(h.symbol, "TCS");
    assert.equal(h.quantity, 10);
    assert.equal(h.costBasis, 32000);
    assert.equal(h.marketValue, 33000);
    assert.equal(h.unrealizedPnl, 1000);
    assert.equal(h.unrealizedPnlPct, 3.13);
    assert.equal(h.allocationPct, 100);
    assert.deepEqual(res.body.totals.map((t) => t.currency), ["INR"]);
    assert.equal(res.body.totals[0].marketValue, 33000);
  });
});

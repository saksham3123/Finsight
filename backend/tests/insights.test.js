import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
// helpers.js must be imported first: it points the app at the test database.
import { SERVICE_KEY, setup } from "./helpers.js";
import { computeAdvisory } from "../src/services/advisoryEngine.js";

let ctx;
let user;
before(async () => {
  ctx = await setup();
  user = await ctx.register();
});
after(() => ctx.close());

const service = { "X-Service-Key": SERVICE_KEY };

describe("ingestion authentication", () => {
  test("the ML service key or an admin token is required", async () => {
    const body = { advisories: [{ symbol: "TCS", assetType: "stock", date: "2026-01-02", signal: "buy" }] };
    assert.equal((await ctx.request("POST", "/advisories", { body })).status, 401);
    assert.equal((await ctx.request("POST", "/advisories", { body, token: user.token })).status, 403);
    assert.equal((await ctx.request("POST", "/advisories", { body, headers: { "X-Service-Key": "wrong" } })).status, 401);
    assert.equal((await ctx.request("POST", "/advisories", { body, headers: service })).status, 200);
  });
});

describe("prices ingestion", () => {
  test("bulk upsert of candles, rejecting high < low", async () => {
    const sbin = await ctx.assetId("SBIN");
    const candles = [
      { date: "2026-01-01", open: 800, high: 810, low: 790, close: 805, volume: 1000 },
      { date: "2026-01-02", open: 805, high: 820, low: 800, close: 815 },
    ];
    const res = await ctx.request("PUT", `/assets/${sbin}/prices`, { headers: service, body: { candles } });
    assert.equal(res.status, 200);
    assert.equal(res.body.upserted, 2);

    const bad = await ctx.request("PUT", `/assets/${sbin}/prices`, { headers: service, body: { candles: [{ ...candles[0], high: 1, low: 2 }] } });
    assert.equal(bad.status, 400);
  });

  test("replace: true swaps the whole history atomically", async () => {
    const sbin = await ctx.assetId("SBIN");
    const res = await ctx.request("PUT", `/assets/${sbin}/prices`, {
      headers: service,
      body: { replace: true, candles: [{ date: "2026-02-01", open: 900, high: 910, low: 890, close: 905 }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 2);
    const prices = await ctx.request("GET", `/assets/${sbin}/prices?from=2025-01-01&to=2026-12-31`);
    assert.deepEqual(prices.body.prices.map((p) => p.date), ["2026-02-01"]);
  });
});

describe("advisories", () => {
  test("one advisory per asset per day: posting again updates it", async () => {
    const body = (signal) => ({ advisories: [{ symbol: "TCS", assetType: "stock", date: "2026-01-02", signal, confidence: 0.7, riskScore: 0.3, sentimentScore: 0.2, modelVersion: "ml-v1" }] });
    await ctx.request("POST", "/advisories", { headers: service, body: body("hold") });
    await ctx.request("POST", "/advisories", { headers: service, body: body("sell") });
    const tcs = await ctx.assetId("TCS");
    const history = await ctx.request("GET", `/assets/${tcs}/advisories`);
    assert.equal(history.body.advisories.length, 1);
    assert.equal(history.body.advisories[0].signal, "sell");
  });

  test("scores outside their ranges are rejected", async () => {
    const res = await ctx.request("POST", "/advisories", {
      headers: service,
      body: { advisories: [{ symbol: "TCS", assetType: "stock", date: "2026-01-03", signal: "buy", confidence: 1.5 }] },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /confidence/);
  });

  test("GET /advisories returns the latest per asset and filters by signal", async () => {
    await ctx.request("POST", "/advisories", {
      headers: service,
      body: { advisories: [
        { symbol: "INFY", assetType: "stock", date: "2026-01-01", signal: "sell", confidence: 0.6 },
        { symbol: "INFY", assetType: "stock", date: "2026-01-05", signal: "buy", confidence: 0.8 },
      ] },
    });
    const all = await ctx.request("GET", "/advisories");
    const infy = all.body.advisories.filter((a) => a.symbol === "INFY");
    assert.equal(infy.length, 1);
    assert.equal(infy[0].signal, "buy");

    const sells = await ctx.request("GET", "/advisories?signal=sell");
    assert.ok(sells.body.advisories.every((a) => a.signal === "sell"));
    assert.ok(!sells.body.advisories.some((a) => a.symbol === "INFY"), "INFY's old sell is not its latest");
  });

  const ranged = (extra) => ({
    advisories: [{ symbol: "ITC", assetType: "stock", date: "2026-01-06", signal: "hold", confidence: 0.51,
      priceLow: 274.08, priceHigh: 295.13, rangeLevel: 0.8, horizonDays: 5, rangeModelVersion: "range-5d-gbm", ...extra }],
  });

  test("a range forecast is stored and returned with the advisory", async () => {
    assert.equal((await ctx.request("POST", "/advisories", { headers: service, body: ranged() })).status, 200);
    const itc = (await ctx.request("GET", "/advisories")).body.advisories.find((a) => a.symbol === "ITC");
    assert.equal(itc.priceLow, 274.08);
    assert.equal(itc.priceHigh, 295.13);
    assert.equal(itc.rangeLevel, 0.8);
    assert.equal(itc.horizonDays, 5);
    assert.equal(itc.rangeModelVersion, "range-5d-gbm");
    assert.equal(itc.currency, "INR");
    const detail = await ctx.request("GET", `/assets/${await ctx.assetId("ITC")}`);
    assert.equal(detail.body.latestAdvisory.priceHigh, 295.13);
  });

  test("a partial or inverted range is rejected", async () => {
    const partial = await ctx.request("POST", "/advisories", { headers: service, body: ranged({ horizonDays: undefined }) });
    assert.equal(partial.status, 400);
    assert.match(partial.body.error, /together/);
    const inverted = await ctx.request("POST", "/advisories", { headers: service, body: ranged({ priceLow: 300 }) });
    assert.equal(inverted.status, 400);
    assert.match(inverted.body.error, /priceHigh/);
    const level = await ctx.request("POST", "/advisories", { headers: service, body: ranged({ rangeLevel: 1 }) });
    assert.equal(level.status, 400);
  });

  test("the chat assistant leads with the range forecast", async () => {
    await ctx.request("POST", "/advisories", { headers: service, body: ranged() });
    const res = await ctx.request("POST", "/chat/messages", { token: user.token, body: { content: "Tell me about ITC" } });
    const reply = res.body.messages[1].content;
    assert.match(reply, /Forecast range: 80% likely to close between INR 274\.08 and INR 295\.13 in 5 trading days/);
  });
});

describe("baseline advisory engine", () => {
  const series = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  test("needs at least 50 closes", () => {
    assert.equal(computeAdvisory(series(49, () => 100)), null);
  });

  test("a steady uptrend is a buy, a downtrend a sell, a flat line a hold", () => {
    assert.equal(computeAdvisory(series(60, (i) => 100 * 1.005 ** i)).signal, "buy");
    assert.equal(computeAdvisory(series(60, (i) => 100 * 0.995 ** i)).signal, "sell");
    assert.equal(computeAdvisory(series(60, () => 100)).signal, "hold");
  });

  test("very volatile series are high_risk; negative news downgrades a buy to watch", () => {
    assert.equal(computeAdvisory(series(60, (i) => (i % 2 ? 150 : 80))).signal, "high_risk");
    assert.equal(computeAdvisory(series(60, (i) => 100 * 1.005 ** i), -0.8).signal, "watch");
  });

  test("admin endpoint generates advisories for assets with enough history", async () => {
    await ctx.addPrices("ITC", 60, (i) => 400 + i);
    const admin = await ctx.loginAdmin();
    const res = await ctx.request("POST", "/admin/advisories/generate", { token: admin.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.generated, 1);
    const itc = await ctx.assetId("ITC");
    const detail = await ctx.request("GET", `/assets/${itc}`);
    assert.equal(detail.body.latestAdvisory.signal, "buy");
    assert.equal(detail.body.latestAdvisory.modelVersion, "baseline-sma-v1");
  });
});

describe("news sentiment", () => {
  const article = (overrides = {}) => ({
    symbol: "TCS", assetType: "stock", headline: "TCS wins contract", source: "Example News",
    url: "https://example.com/tcs-contract", publishedAt: new Date().toISOString(),
    sentimentScore: 0.6, sentimentLabel: "positive", ...overrides,
  });

  test("articles are upserted by (asset, url), including market-wide ones", async () => {
    await ctx.request("POST", "/news", { headers: service, body: { articles: [article()] } });
    await ctx.request("POST", "/news", { headers: service, body: { articles: [article({ headline: "TCS wins big contract" })] } });
    const market = { headline: "Markets rally", url: "https://example.com/rally", publishedAt: new Date().toISOString(), sentimentScore: 0.3, sentimentLabel: "positive" };
    await ctx.request("POST", "/news", { headers: service, body: { articles: [market] } });
    await ctx.request("POST", "/news", { headers: service, body: { articles: [market] } });

    const res = await ctx.request("GET", "/news");
    assert.equal(res.body.news.length, 2);
    assert.ok(res.body.news.some((n) => n.headline === "TCS wins big contract"));
  });

  test("asset detail includes 7-day average sentiment", async () => {
    const tcs = await ctx.assetId("TCS");
    const res = await ctx.request("GET", `/assets/${tcs}`);
    assert.equal(res.body.sentiment7d.articles, 1);
    assert.equal(res.body.sentiment7d.average, 0.6);
  });

  test("invalid label and non-http URLs are rejected", async () => {
    assert.equal((await ctx.request("POST", "/news", { headers: service, body: { articles: [article({ sentimentLabel: "great" })] } })).status, 400);
    assert.equal((await ctx.request("POST", "/news", { headers: service, body: { articles: [article({ url: "javascript:alert(1)" })] } })).status, 400);
  });
});

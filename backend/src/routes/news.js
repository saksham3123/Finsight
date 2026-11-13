import { Router } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { requireAdminOrService } from "../middleware/auth.js";
import { resolveAssetId } from "../services/assets.js";
import { HttpError } from "../utils/httpError.js";
import { camelizeAll } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();

const LABELS = ["positive", "neutral", "negative"];

router.get("/", async (req, res) => {
  const { limit, offset } = v.pagination(req.query);
  const assetId = v.uuid(req.query.assetId, "assetId", { required: false });
  const sentiment = v.oneOf(req.query.sentiment, "sentiment", LABELS, { required: false });
  const { rows } = await pool.query(
    `SELECT n.id, n.asset_id, a.symbol, n.headline, n.source, n.url, n.published_at,
            n.sentiment_score, n.sentiment_label, n.created_at
     FROM news_sentiment n LEFT JOIN assets a ON a.id = n.asset_id
     WHERE ($1::uuid IS NULL OR n.asset_id = $1) AND ($2::text IS NULL OR n.sentiment_label = $2)
     ORDER BY n.published_at DESC LIMIT $3 OFFSET $4`,
    [assetId ?? null, sentiment ?? null, limit, offset]
  );
  res.json({ news: camelizeAll(rows), limit, offset });
});

// Ingestion endpoint for the ML service. Articles without assetId/symbol are market-wide.
router.post("/", requireAdminOrService, async (req, res) => {
  const articles = v.array(req.body?.articles, "articles", { max: 1000 });
  const upserted = await withTransaction(async (client) => {
    let count = 0;
    for (const [i, raw] of articles.entries()) {
      const field = `articles[${i}]`;
      const item = raw ?? {};
      const marketWide = item.assetId === undefined && item.symbol === undefined;
      const assetId = marketWide ? null : await resolveAssetId(client, item, field);
      const url = v.string(item.url, `${field}.url`, { max: 2000 });
      if (!/^https?:\/\//i.test(url)) throw new HttpError(400, `${field}.url must start with http:// or https://`);

      await client.query(
        `INSERT INTO news_sentiment (asset_id, headline, source, url, published_at, sentiment_score, sentiment_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (asset_id, url) DO UPDATE SET
           headline = EXCLUDED.headline, source = EXCLUDED.source, published_at = EXCLUDED.published_at,
           sentiment_score = EXCLUDED.sentiment_score, sentiment_label = EXCLUDED.sentiment_label`,
        [
          assetId,
          v.string(item.headline, `${field}.headline`, { max: 1000 }),
          v.string(item.source, `${field}.source`, { required: false, max: 100 }) ?? null,
          url,
          v.timestamp(item.publishedAt, `${field}.publishedAt`),
          v.score(item.sentimentScore, `${field}.sentimentScore`, -1, 1),
          v.oneOf(item.sentimentLabel, `${field}.sentimentLabel`, LABELS),
        ]
      );
      count += 1;
    }
    return count;
  });
  res.json({ upserted });
});

export default router;

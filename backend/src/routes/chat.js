import crypto from "crypto";
import { Router } from "express";
import pool from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { generateReply } from "../services/assistant.js";
import { notFound } from "../utils/httpError.js";
import { camelize, camelizeAll } from "../utils/serialize.js";
import * as v from "../utils/validate.js";

const router = Router();
router.use(requireAuth);

router.get("/conversations", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.conversation_id, LEFT(f.content, 80) AS title, c.message_count, c.started_at, c.last_message_at
     FROM (
       SELECT conversation_id, COUNT(*) AS message_count, MIN(created_at) AS started_at, MAX(created_at) AS last_message_at
       FROM chat_messages WHERE user_id = $1 GROUP BY conversation_id
     ) c
     LEFT JOIN LATERAL (
       SELECT content FROM chat_messages
       WHERE user_id = $1 AND conversation_id = c.conversation_id AND role = 'user'
       ORDER BY created_at LIMIT 1
     ) f ON TRUE
     ORDER BY c.last_message_at DESC`,
    [req.user.id]
  );
  res.json({ conversations: camelizeAll(rows) });
});

const loadConversation = async (userId, conversationId) => {
  const { rows } = await pool.query(
    "SELECT id, role, content, created_at FROM chat_messages WHERE user_id = $1 AND conversation_id = $2 ORDER BY created_at, id",
    [userId, conversationId]
  );
  if (!rows.length) throw notFound("Conversation");
  return rows;
};

router.get("/conversations/:id/messages", async (req, res) => {
  const conversationId = v.uuid(req.params.id, "id");
  res.json({ conversationId, messages: camelizeAll(await loadConversation(req.user.id, conversationId)) });
});

// clock_timestamp() (not NOW()) gives the question and the answer distinct, ordered timestamps.
const saveMessage = async (userId, conversationId, role, content) => {
  const { rows } = await pool.query(
    `INSERT INTO chat_messages (user_id, conversation_id, role, content, created_at)
     VALUES ($1, $2, $3, $4, clock_timestamp()) RETURNING id, role, content, created_at`,
    [userId, conversationId, role, content]
  );
  return rows[0];
};

router.post("/messages", async (req, res) => {
  const content = v.string(req.body?.content, "content", { max: 2000 });
  let conversationId = v.uuid(req.body.conversationId, "conversationId", { required: false });
  if (conversationId) await loadConversation(req.user.id, conversationId);
  else conversationId = crypto.randomUUID();

  const userMessage = await saveMessage(req.user.id, conversationId, "user", content);
  const reply = await generateReply(req.user.id, content);
  const assistantMessage = await saveMessage(req.user.id, conversationId, "assistant", reply);
  res.status(201).json({ conversationId, messages: [camelize(userMessage), camelize(assistantMessage)] });
});

router.delete("/conversations/:id", async (req, res) => {
  const conversationId = v.uuid(req.params.id, "id");
  const { rowCount } = await pool.query("DELETE FROM chat_messages WHERE user_id = $1 AND conversation_id = $2", [
    req.user.id,
    conversationId,
  ]);
  if (!rowCount) throw notFound("Conversation");
  res.status(204).end();
});

export default router;

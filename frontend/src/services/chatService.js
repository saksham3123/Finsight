import { api } from "./api";

/**
 * POST /chat/messages. Omit `conversationId` to start a new conversation; the server keeps the
 * history. Returns { conversationId, reply }.
 */
export async function sendMessage(content, conversationId) {
  const res = await api.post("/chat/messages", { content, conversationId: conversationId ?? undefined });
  return { conversationId: res.conversationId, reply: res.messages.find((m) => m.role === "assistant").content };
}

import { useEffect, useRef, useState } from "react";
import { FaPaperPlane, FaRobot, FaXmark } from "react-icons/fa6";
import { sendMessage } from "../../services/chatService";

const DISCLAIMER = "FinSight's assistant gives general information, not financial advice.";

const GREETING = {
  role: "assistant",
  text: "Hi! I'm the FinSight assistant. Ask me about your portfolio, watchlist, SIPs or any stock or coin, or type 'help'.",
};
const SUGGESTIONS = ["How is my portfolio doing?", "Top buy signals", "Tell me about RELIANCE"];

function Bubble({ role, text }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          mine ? "rounded-br-sm bg-series-1 text-white" : "rounded-bl-sm bg-surface-2 text-ink"
        }`}
      >
        {text}
      </p>
    </div>
  );
}

/** Floating assistant button (bottom-right) that opens a chat panel. Replies come from chatService. */
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  // The server stores the conversation; later messages in this session continue it.
  const [conversationId, setConversationId] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async (text) => {
    const message = text.trim();
    if (!message || typing) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setDraft("");
    setTyping(true);
    try {
      const res = await sendMessage(message, conversationId);
      setConversationId(res.conversationId);
      const reply = res.reply;
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `Sorry, I couldn't reply right now (${err.message}).` }]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="FinSight assistant"
          className="fixed bottom-24 right-4 z-50 flex h-[min(520px,calc(100vh-8rem))] w-[min(380px,calc(100vw-2rem))] animate-slide-up flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:right-6"
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-brand-ink">
              <FaRobot aria-hidden="true" />
            </span>
            <div className="flex-1">
              <h2 className="text-sm font-semibold">FinSight Assistant</h2>
              <p className="text-xs text-muted">Answers from your FinSight data</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="text-muted hover:text-ink">
              <FaXmark />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.map((m, i) => (
              <Bubble key={i} {...m} />
            ))}
            {typing && (
              <div className="flex gap-1 px-1" aria-label="Assistant is typing">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-2 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            )}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="border-t border-line p-3"
          >
            <div className="flex items-center gap-2">
              <label htmlFor="chat-input" className="sr-only">
                Message
              </label>
              <input
                id="chat-input"
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about your money…"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-series-1"
              />
              <button
                type="submit"
                disabled={!draft.trim() || typing}
                aria-label="Send"
                className="grid size-9 place-items-center rounded-lg bg-series-1 text-white disabled:opacity-50"
              >
                <FaPaperPlane />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted">{DISCLAIMER}</p>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close assistant" : "Open AI assistant"}
        aria-expanded={open}
        className="fixed bottom-6 right-4 z-50 grid size-14 place-items-center rounded-full bg-series-1 text-xl text-white shadow-xl transition-transform hover:scale-105 sm:right-6"
      >
        {open ? <FaXmark /> : <FaRobot />}
      </button>
    </>
  );
}

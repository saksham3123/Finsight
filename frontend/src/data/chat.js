// Canned replies for the mock AI assistant. The first rule whose keywords match wins.

export const CHAT_RULES = [
  {
    keywords: ["sip", "systematic", "monthly"],
    reply:
      "A SIP invests a fixed amount every month, so you buy more units when prices are low. Try the SIP page to see how ₹5,000 a month could grow at your expected return.",
  },
  {
    keywords: ["portfolio", "holding", "my stocks"],
    reply:
      "Your portfolio is mostly large-cap Indian stocks with a small crypto allocation. RELIANCE is your biggest gainer; INFY and ETH are below their average cost.",
  },
  {
    keywords: ["crypto", "bitcoin", "btc", "eth"],
    reply:
      "Crypto is far more volatile than equities. Many investors cap it at a small share of their portfolio, around 5%, and only invest what they can afford to lose.",
  },
  {
    keywords: ["buy", "sell", "hold", "recommend", "advice"],
    reply:
      "The advisory cards on your dashboard show the current Buy / Hold / Sell view for your holdings, with a confidence score and the reasoning behind each one.",
  },
  {
    keywords: ["risk", "safe", "diversif"],
    reply:
      "Spreading money across sectors and asset types lowers the impact of any one bad investment. Your holdings currently lean towards IT and banking.",
  },
  {
    keywords: ["hello", "hi", "hey"],
    reply: "Hi! I'm the FinSight assistant. Ask me about your portfolio, SIPs or any stock on the Stocks page.",
  },
];

export const FALLBACK_REPLY =
  "I'm a demo assistant for now, so I can only answer questions about your portfolio, SIPs, crypto and risk. Try asking about one of those.";

export const DISCLAIMER = "FinSight's assistant gives general information, not financial advice.";

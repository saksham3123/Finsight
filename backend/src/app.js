import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import pool from "./db/pool.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import adminRoutes from "./routes/admin.js";
import advisoryRoutes from "./routes/advisories.js";
import assetRoutes from "./routes/assets.js";
import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chat.js";
import newsRoutes from "./routes/news.js";
import portfolioRoutes from "./routes/portfolio.js";
import sipRoutes from "./routes/sips.js";
import transactionRoutes from "./routes/transactions.js";
import userRoutes from "./routes/users.js";
import watchlistRoutes from "./routes/watchlist.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/health/db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ database: "connected", time: result.rows[0].now });
  } catch (error) {
    console.error("Database connection failed:", error.message);
    res.status(503).json({ database: "disconnected" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/sips", sipRoutes);
app.use("/api/advisories", advisoryRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

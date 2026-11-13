import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Resolve backend/.env from this file so scripts work no matter which directory they run from.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
dotenv.config({ path: envPath, quiet: true });

export const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}. Set it in backend/.env (see .env.example).`);
    process.exit(1);
  }
  return value;
};

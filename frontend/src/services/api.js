import axios from "axios";
import { readStorage, STORAGE_KEYS, writeStorage } from "../utils/storage";

/**
 * Shared HTTP client for the FinSight Express API. Pages never call axios directly; they go
 * through the service modules in this folder.
 *
 *   VITE_API_URL   base URL of the API (default http://localhost:5000/api)
 *
 * Auth: the access token (15 min) is sent as a Bearer header. When a request fails with 401,
 * the refresh token is exchanged once for a new pair and the request is retried. The backend
 * rotates refresh tokens and treats reuse as theft, so concurrent 401s share one refresh call.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api";

export const api = axios.create({ baseURL: BASE_URL, timeout: 15000 });

export const tokens = {
  get access() {
    return readStorage(STORAGE_KEYS.accessToken);
  },
  get refresh() {
    return readStorage(STORAGE_KEYS.refreshToken);
  },
  set({ accessToken, refreshToken }) {
    writeStorage(STORAGE_KEYS.accessToken, accessToken);
    writeStorage(STORAGE_KEYS.refreshToken, refreshToken);
  },
  clear() {
    writeStorage(STORAGE_KEYS.accessToken, null);
    writeStorage(STORAGE_KEYS.refreshToken, null);
  },
};

// AuthContext listens for this and sends the user to the sign-in page.
export const UNAUTHORIZED_EVENT = "finsight:unauthorized";

api.interceptors.request.use((config) => {
  const access = tokens.access;
  if (access) config.headers.Authorization = `Bearer ${access}`;
  return config;
});

let refreshing = null;
function refreshTokens() {
  // A bare axios call, so a failing refresh can't trigger this interceptor again.
  refreshing ??= axios
    .post(`${BASE_URL}/auth/refresh`, { refreshToken: tokens.refresh }, { timeout: 15000 })
    .then((res) => tokens.set(res.data))
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const isAuthCall = (url = "") => /^\/?auth\//.test(url);

// Errors carry the backend's message ({ error: "..." }) and the HTTP status.
function toError(err) {
  const error = new Error(err.response?.data?.error ?? err.message ?? "Request failed");
  error.status = err.response?.status;
  return error;
}

api.interceptors.response.use(
  (res) => res.data,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && original && !original._retried && !isAuthCall(original.url)) {
      if (tokens.refresh) {
        original._retried = true;
        try {
          await refreshTokens();
          return api(original);
        } catch {
          // Refresh token expired or revoked: fall through to signing out.
        }
      }
      tokens.clear();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return Promise.reject(toError(err));
  },
);

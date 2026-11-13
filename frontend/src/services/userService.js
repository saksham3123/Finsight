import { api, tokens } from "./api";

/** POST /auth/register. Signs the new user in. */
export async function register(name, email, password) {
  const { user, ...pair } = await api.post("/auth/register", { name, email, password });
  tokens.set(pair);
  return user;
}

/** POST /auth/login */
export async function login(email, password) {
  const { user, ...pair } = await api.post("/auth/login", { email, password });
  tokens.set(pair);
  return user;
}

/** POST /auth/logout revokes the refresh token on the server; local tokens are cleared regardless. */
export async function logout() {
  const refreshToken = tokens.refresh;
  tokens.clear();
  if (refreshToken) await api.post("/auth/logout", { refreshToken }).catch(() => {});
}

/** GET /users/me → { user, preferences } */
export const getMe = () => api.get("/users/me");

/** PATCH /users/me */
export const updateName = (name) => api.patch("/users/me", { name }).then((r) => r.user);

/** PATCH /users/me/preferences, e.g. { theme: "dark" } */
export const savePreferences = (prefs) => api.patch("/users/me/preferences", prefs);

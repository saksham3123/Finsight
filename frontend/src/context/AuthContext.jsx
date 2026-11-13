import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { tokens, UNAUTHORIZED_EVENT } from "../services/api";
import * as users from "../services/userService";
import { useTheme } from "./ThemeContext";

const AuthContext = createContext(null);

/**
 * Signed-in user state. `status` is "loading" while a saved session is checked, then
 * "authed" or "guest". The theme is also saved to the account, so it follows the user
 * across browsers (the browser copy in localStorage still applies before sign-in).
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(tokens.refresh ? "loading" : "guest");
  const { theme, setTheme } = useTheme();
  const savedTheme = useRef(null);

  const loadMe = useCallback(async () => {
    const { user: me, preferences } = await users.getMe();
    savedTheme.current = preferences.theme;
    if (preferences.theme) setTheme(preferences.theme);
    setUser(me);
    setStatus("authed");
  }, [setTheme]);

  useEffect(() => {
    if (status === "loading") loadMe().catch(() => setStatus("guest"));
    // Only on first load; sign-in and sign-up call loadMe themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setStatus("guest");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (status !== "authed" || theme === savedTheme.current) return;
    savedTheme.current = theme;
    users.savePreferences({ theme }).catch(() => {});
  }, [status, theme]);

  const value = {
    user,
    status,
    login: async (email, password) => {
      await users.login(email, password);
      await loadMe();
    },
    register: async (name, email, password) => {
      await users.register(name, email, password);
      await loadMe();
    },
    logout: async () => {
      await users.logout();
      setUser(null);
      setStatus("guest");
    },
    setUser,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

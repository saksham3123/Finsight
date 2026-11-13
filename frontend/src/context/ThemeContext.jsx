import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { readStorage, STORAGE_KEYS, writeStorage } from "../utils/storage";

const ThemeContext = createContext({ theme: "light", setTheme: () => {}, toggleTheme: () => {} });

const initialTheme = () => (readStorage(STORAGE_KEYS.theme) === "dark" ? "dark" : "light");

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  // The attribute drives every colour token in index.css; the saved value is restored on the next visit.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage(STORAGE_KEYS.theme, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

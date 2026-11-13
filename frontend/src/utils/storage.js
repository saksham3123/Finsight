// localStorage can be missing or throw (private mode, blocked storage), so every access is guarded.

export function readStorage(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not persisting is acceptable; the app keeps working for this visit.
  }
}

export const STORAGE_KEYS = {
  theme: "theme",
  lastRoute: "finsight:lastRoute",
  chartHintDismissed: "finsight:chartHintDismissed",
  accessToken: "finsight:accessToken",
  refreshToken: "finsight:refreshToken",
};

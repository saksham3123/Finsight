import { useState } from "react";
import { FaMoon, FaSun } from "react-icons/fa6";
import { PageTitle } from "../components/layout/Layout";
import { Panel } from "../components/ui/Feedback";
import Button from "../components/ui/Button";
import { useTheme } from "../context/ThemeContext";
import { STORAGE_KEYS, writeStorage } from "../utils/storage";

const THEMES = [
  { value: "light", label: "Light", Icon: FaSun },
  { value: "dark", label: "Dark", Icon: FaMoon },
];

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [cleared, setCleared] = useState(false);

  const resetTips = () => {
    writeStorage(STORAGE_KEYS.chartHintDismissed, null);
    writeStorage(STORAGE_KEYS.lastRoute, null);
    setCleared(true);
  };

  return (
    <>
      <PageTitle title="Settings" subtitle="Preferences are saved in this browser." />
      <div className="max-w-2xl space-y-6">
        <Panel title="Appearance">
          <fieldset className="p-5">
            <legend className="mb-3 text-sm text-ink-2">Theme</legend>
            <div className="grid grid-cols-2 gap-3">
              {THEMES.map(({ value, label, Icon }) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 text-sm font-medium ${
                    theme === value ? "border-series-1 bg-surface-2 text-ink" : "border-line text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => setTheme(value)}
                    className="accent-[var(--series-1)]"
                  />
                  <Icon aria-hidden="true" /> {label}
                </label>
              ))}
            </div>
          </fieldset>
        </Panel>

        <Panel title="Saved data">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <p className="max-w-md text-sm text-ink-2">
              FinSight remembers the last page you opened and which tips you have dismissed. Reset them to start fresh.
            </p>
            <Button variant="secondary" onClick={resetTips}>
              Reset tips and last page
            </Button>
          </div>
          {cleared && (
            <p role="status" className="px-5 pb-5 text-sm text-good-ink">
              Done. Chart tips will show again.
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}

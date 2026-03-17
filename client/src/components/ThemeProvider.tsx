/**
 * ThemeProvider — dark/light mode + named theme presets + per-user customisation
 *
 * Key design principle: applyPrefs() writes directly to the DOM and never
 * triggers a React re-render. React state only changes on explicit save.
 * This prevents the flicker loop caused by live-preview ↔ state-sync fighting.
 */

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ColorMode = "dark" | "light";
export type ThemeId = "default" | "perplexity" | "shadcn";
export type ReadingWidth = "compact" | "default" | "wide";

export interface UserPrefs {
  colorMode: ColorMode;
  themeId: ThemeId;
  fontScale: number;
  readingWidth: ReadingWidth;
}

const DEFAULT_PREFS: UserPrefs = {
  colorMode: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  themeId: "default",
  fontScale: 1,
  readingWidth: "default",
};

// ── Theme definitions ─────────────────────────────────────────────────────────

export interface ThemeDef {
  id: ThemeId;
  label: string;
  description: string;
  light: Record<string, string>;
  dark: Record<string, string>;
  fonts: Record<string, string>;
}

export const THEMES: ThemeDef[] = [
  {
    id: "default",
    label: "Default",
    description: "Feedhunt's original blue + Cabinet Grotesk palette",
    fonts: {
      "--font-display": "'Cabinet Grotesk', 'Inter', sans-serif",
      "--font-body":    "'Satoshi', 'Inter', sans-serif",
    },
    light: {
      "--background":           "200 15% 97%",
      "--foreground":           "215 25% 12%",
      "--card":                 "0 0% 100%",
      "--card-foreground":      "215 25% 12%",
      "--primary":              "217 91% 48%",
      "--primary-foreground":   "0 0% 100%",
      "--secondary":            "215 14% 94%",
      "--secondary-foreground": "215 25% 20%",
      "--muted":                "215 14% 94%",
      "--muted-foreground":     "215 14% 48%",
      "--accent":               "217 91% 94%",
      "--accent-foreground":    "217 91% 30%",
      "--border":               "215 14% 88%",
      "--input":                "215 14% 88%",
      "--ring":                 "217 91% 48%",
    },
    dark: {
      "--background":           "222 22% 10%",
      "--foreground":           "215 20% 86%",
      "--card":                 "222 22% 13%",
      "--card-foreground":      "215 20% 86%",
      "--primary":              "217 91% 60%",
      "--primary-foreground":   "222 22% 8%",
      "--secondary":            "222 15% 18%",
      "--secondary-foreground": "215 20% 70%",
      "--muted":                "222 15% 18%",
      "--muted-foreground":     "215 14% 52%",
      "--accent":               "217 30% 22%",
      "--accent-foreground":    "217 91% 70%",
      "--border":               "222 15% 20%",
      "--input":                "222 15% 20%",
      "--ring":                 "217 91% 60%",
    },
  },
  {
    id: "perplexity",
    label: "Perplexity",
    description: "Teal accent, Inter, and Perplexity's signature neutral palette",
    fonts: {
      "--font-display": "'Inter', system-ui, sans-serif",
      "--font-body":    "'Inter', system-ui, sans-serif",
    },
    light: {
      "--background":           "0 0% 98%",
      "--foreground":           "240 10% 8%",
      "--card":                 "0 0% 100%",
      "--card-foreground":      "240 10% 8%",
      "--primary":              "174 72% 36%",
      "--primary-foreground":   "0 0% 100%",
      "--secondary":            "240 5% 94%",
      "--secondary-foreground": "240 10% 20%",
      "--muted":                "240 5% 94%",
      "--muted-foreground":     "240 5% 45%",
      "--accent":               "174 60% 92%",
      "--accent-foreground":    "174 72% 22%",
      "--border":               "240 5% 88%",
      "--input":                "240 5% 88%",
      "--ring":                 "174 72% 36%",
    },
    dark: {
      "--background":           "240 10% 8%",
      "--foreground":           "240 5% 90%",
      "--card":                 "240 10% 11%",
      "--card-foreground":      "240 5% 90%",
      "--primary":              "174 72% 48%",
      "--primary-foreground":   "240 10% 6%",
      "--secondary":            "240 8% 16%",
      "--secondary-foreground": "240 5% 72%",
      "--muted":                "240 8% 16%",
      "--muted-foreground":     "240 5% 50%",
      "--accent":               "174 30% 18%",
      "--accent-foreground":    "174 72% 60%",
      "--border":               "240 8% 18%",
      "--input":                "240 8% 18%",
      "--ring":                 "174 72% 48%",
    },
  },
  {
    id: "shadcn",
    label: "shadcn",
    description: "shadcn/ui's iconic zinc neutral palette with sharp geometry",
    fonts: {
      "--font-display": "system-ui, -apple-system, sans-serif",
      "--font-body":    "system-ui, -apple-system, sans-serif",
    },
    light: {
      "--background":           "0 0% 100%",
      "--foreground":           "240 10% 4%",
      "--card":                 "0 0% 100%",
      "--card-foreground":      "240 10% 4%",
      "--primary":              "240 6% 10%",
      "--primary-foreground":   "0 0% 98%",
      "--secondary":            "240 5% 96%",
      "--secondary-foreground": "240 6% 10%",
      "--muted":                "240 5% 96%",
      "--muted-foreground":     "240 4% 46%",
      "--accent":               "240 5% 96%",
      "--accent-foreground":    "240 6% 10%",
      "--border":               "240 6% 90%",
      "--input":                "240 6% 90%",
      "--ring":                 "240 6% 10%",
    },
    dark: {
      "--background":           "240 10% 4%",
      "--foreground":           "0 0% 98%",
      "--card":                 "240 10% 4%",
      "--card-foreground":      "0 0% 98%",
      "--primary":              "0 0% 98%",
      "--primary-foreground":   "240 6% 10%",
      "--secondary":            "240 4% 16%",
      "--secondary-foreground": "0 0% 98%",
      "--muted":                "240 4% 16%",
      "--muted-foreground":     "240 5% 65%",
      "--accent":               "240 4% 16%",
      "--accent-foreground":    "0 0% 98%",
      "--border":               "240 4% 16%",
      "--input":                "240 4% 16%",
      "--ring":                 "240 5% 84%",
    },
  },
];

const READING_WIDTHS: Record<ReadingWidth, string> = {
  compact: "520px",
  default: "680px",
  wide:    "820px",
};

// ── Pure DOM mutation — ZERO React state touched ──────────────────────────────
// Safe to call from event handlers during live preview without causing
// re-renders or feedback loops. Exported so SettingsPanel can call it directly.
export function applyPrefs(prefs: UserPrefs) {
  const root = document.documentElement;
  const theme = THEMES.find((t) => t.id === prefs.themeId) ?? THEMES[0];
  const vars = { ...theme.fonts, ...(prefs.colorMode === "dark" ? theme.dark : theme.light) };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.setProperty("--font-scale", String(prefs.fontScale));
  root.style.setProperty("--reading-pane-inner-max-width", READING_WIDTHS[prefs.readingWidth]);
  root.setAttribute("data-theme", prefs.colorMode);
  root.classList.toggle("dark", prefs.colorMode === "dark");
}

// ── Context ───────────────────────────────────────────────────────────────────

interface ThemeCtxValue {
  /** Last-committed (saved) prefs — used to seed the settings panel draft */
  prefs: UserPrefs;
  /** Apply to DOM + commit to React state + persist to DB */
  savePrefs: (p: UserPrefs) => Promise<void>;
  toggle: () => void;
  theme: ColorMode;
  themes: ThemeDef[];
}

const ThemeCtx = createContext<ThemeCtxValue>({
  prefs: DEFAULT_PREFS,
  savePrefs: async () => {},
  toggle: () => {},
  theme: DEFAULT_PREFS.colorMode,
  themes: THEMES,
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS);

  // Load persisted prefs on mount
  useEffect(() => {
    apiRequest("GET", "/api/preferences")
      .then((r) => (r as Response).json())
      .then((data) => {
        if (data && !data.error) {
          const merged: UserPrefs = { ...DEFAULT_PREFS, ...data };
          setPrefs(merged);
          applyPrefs(merged);
        } else {
          applyPrefs(DEFAULT_PREFS);
        }
      })
      .catch(() => applyPrefs(DEFAULT_PREFS));
  }, []);

  const savePrefs = useCallback(async (p: UserPrefs) => {
    applyPrefs(p);   // instant DOM — no re-render
    setPrefs(p);     // commit to React state
    await apiRequest("POST", "/api/preferences", p);
  }, []);

  const toggle = useCallback(() => {
    savePrefs({ ...prefs, colorMode: prefs.colorMode === "dark" ? "light" : "dark" });
  }, [prefs, savePrefs]);

  return (
    <ThemeCtx.Provider value={{ prefs, savePrefs, toggle, theme: prefs.colorMode, themes: THEMES }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}

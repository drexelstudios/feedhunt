/**
 * ThemeProvider — dark/light mode + named theme presets + per-user customisation
 *
 * Key design principle: applyPrefs() writes directly to the DOM and never
 * triggers a React re-render. React state only changes on explicit save.
 * This prevents the flicker loop caused by live-preview ↔ state-sync fighting.
 *
 * Each theme defines its own:
 *   • Color palette (light + dark)
 *   • Typography (font-display, font-body, letter-spacing, line-height)
 *   • Geometry (border-radius at all sizes)
 *   • Density (button height/padding, item padding, spacing feel)
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
  /** Reading pane width in pixels — set by drag resize, persisted to DB */
  paneWidth: number;
}

const DEFAULT_PREFS: UserPrefs = {
  colorMode: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  themeId: "default",
  fontScale: 1,
  readingWidth: "default",
  paneWidth: 480,
};

// ── Font injection ─────────────────────────────────────────────────────────────
// Dynamically insert <link> tags so fonts load only when needed.
// index.html already includes Fontshare (Cabinet Grotesk + Satoshi).
// We inject Inter (Google Fonts) for the Perplexity theme on demand.

const FONT_LINKS: Record<ThemeId, { id: string; href: string } | null> = {
  default:    null, // Fontshare already in <head>
  perplexity: {
    id: "theme-font-inter",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  },
  shadcn: null, // system-ui — no external load needed
};

function ensureFontLoaded(themeId: ThemeId) {
  const spec = FONT_LINKS[themeId];
  if (!spec) return;
  if (document.getElementById(spec.id)) return;
  const link = document.createElement("link");
  link.id = spec.id;
  link.rel = "stylesheet";
  link.href = spec.href;
  document.head.appendChild(link);
}

// ── Theme definitions ─────────────────────────────────────────────────────────

export interface ThemeDef {
  id: ThemeId;
  label: string;
  description: string;
  /** CSS vars written unconditionally (fonts, geometry, density) */
  base: Record<string, string>;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export const THEMES: ThemeDef[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // DEFAULT — Blue-accented, Cabinet Grotesk display, Satoshi body.
  // Rounded corners, balanced density, comfortable reading line-height.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "default",
    label: "Default",
    description: "Blue accent · Cabinet Grotesk · rounded, balanced",
    base: {
      // Fonts
      "--font-display":            "'Cabinet Grotesk', 'Inter', sans-serif",
      "--font-body":               "'Satoshi', 'Inter', sans-serif",
      "--font-mono":               "'JetBrains Mono', 'Fira Code', monospace",
      // Heading style
      "--heading-letter-spacing":  "-0.02em",
      "--heading-line-height":     "1.25",
      // Body reading feel
      "--body-line-height":        "1.65",
      "--body-letter-spacing":     "0em",
      // Geometry
      "--radius":                  "0.5rem",
      "--radius-sm":               "0.375rem",
      "--radius-md":               "0.5rem",
      "--radius-lg":               "0.75rem",
      "--radius-xl":               "1rem",
      // Button / interactive geometry
      "--btn-height":              "36px",
      "--btn-height-sm":           "30px",
      "--btn-padding-x":           "1rem",
      "--btn-padding-x-sm":        "0.75rem",
      "--btn-font-weight":         "600",
      "--btn-letter-spacing":      "0em",
      "--btn-font-size":           "0.875rem",
      // Feed item / nav item density
      "--item-padding-y":          "0.625rem",
      "--item-padding-x":          "1rem",
      "--nav-item-height":         "34px",
      "--nav-item-padding-x":      "0.75rem",
      "--nav-item-font-weight":    "500",
      "--nav-item-letter-spacing": "0em",
    },
    light: {
      "--background":           "200 15% 97%",
      "--foreground":           "215 25% 12%",
      "--card":                 "0 0% 100%",
      "--card-foreground":      "215 25% 12%",
      "--popover":              "0 0% 100%",
      "--popover-foreground":   "215 25% 12%",
      "--primary":              "217 91% 48%",
      "--primary-foreground":   "0 0% 100%",
      "--secondary":            "215 14% 94%",
      "--secondary-foreground": "215 25% 20%",
      "--muted":                "215 14% 94%",
      "--muted-foreground":     "215 14% 48%",
      "--accent":               "217 91% 94%",
      "--accent-foreground":    "217 91% 30%",
      "--destructive":          "0 72% 51%",
      "--destructive-foreground": "0 0% 100%",
      "--border":               "215 14% 88%",
      "--input":                "215 14% 88%",
      "--ring":                 "217 91% 48%",
    },
    dark: {
      "--background":           "222 22% 10%",
      "--foreground":           "215 20% 86%",
      "--card":                 "222 22% 13%",
      "--card-foreground":      "215 20% 86%",
      "--popover":              "222 22% 13%",
      "--popover-foreground":   "215 20% 86%",
      "--primary":              "217 91% 60%",
      "--primary-foreground":   "222 22% 8%",
      "--secondary":            "222 15% 18%",
      "--secondary-foreground": "215 20% 70%",
      "--muted":                "222 15% 18%",
      "--muted-foreground":     "215 14% 52%",
      "--accent":               "217 30% 22%",
      "--accent-foreground":    "217 91% 70%",
      "--destructive":          "0 62% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border":               "222 15% 20%",
      "--input":                "222 15% 20%",
      "--ring":                 "217 91% 60%",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PERPLEXITY — Teal-accented, Inter throughout, generous airy spacing.
  // Slightly tighter radius than Default. Clean, confident, modern.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "perplexity",
    label: "Perplexity",
    description: "Teal accent · Inter · airy, confident spacing",
    base: {
      // Fonts — Inter everywhere, no decorative display contrast
      "--font-display":            "'Inter', system-ui, sans-serif",
      "--font-body":               "'Inter', system-ui, sans-serif",
      "--font-mono":               "'JetBrains Mono', ui-monospace, monospace",
      // Heading style — Inter tight tracking, short line-height
      "--heading-letter-spacing":  "-0.025em",
      "--heading-line-height":     "1.2",
      // Body reading — Inter at comfortable size, slightly airy
      "--body-line-height":        "1.7",
      "--body-letter-spacing":     "0em",
      // Geometry — slightly tighter corners than Default
      "--radius":                  "0.375rem",
      "--radius-sm":               "0.25rem",
      "--radius-md":               "0.375rem",
      "--radius-lg":               "0.5rem",
      "--radius-xl":               "0.75rem",
      // Button — taller, more air, medium-weight label (Inter style)
      "--btn-height":              "40px",
      "--btn-height-sm":           "32px",
      "--btn-padding-x":           "1.125rem",
      "--btn-padding-x-sm":        "0.875rem",
      "--btn-font-weight":         "500",
      "--btn-letter-spacing":      "0em",
      "--btn-font-size":           "0.875rem",
      // Feed item / nav — more vertical breathing room (Perplexity's generosity)
      "--item-padding-y":          "0.75rem",
      "--item-padding-x":          "1.125rem",
      "--nav-item-height":         "38px",
      "--nav-item-padding-x":      "0.875rem",
      "--nav-item-font-weight":    "500",
      "--nav-item-letter-spacing": "0em",
    },
    light: {
      "--background":           "0 0% 98%",
      "--foreground":           "240 10% 8%",
      "--card":                 "0 0% 100%",
      "--card-foreground":      "240 10% 8%",
      "--popover":              "0 0% 100%",
      "--popover-foreground":   "240 10% 8%",
      "--primary":              "174 72% 36%",
      "--primary-foreground":   "0 0% 100%",
      "--secondary":            "240 5% 94%",
      "--secondary-foreground": "240 10% 20%",
      "--muted":                "240 5% 94%",
      "--muted-foreground":     "240 5% 45%",
      "--accent":               "174 60% 92%",
      "--accent-foreground":    "174 72% 22%",
      "--destructive":          "0 72% 51%",
      "--destructive-foreground": "0 0% 100%",
      "--border":               "240 5% 88%",
      "--input":                "240 5% 88%",
      "--ring":                 "174 72% 36%",
    },
    dark: {
      "--background":           "240 10% 8%",
      "--foreground":           "240 5% 90%",
      "--card":                 "240 10% 11%",
      "--card-foreground":      "240 5% 90%",
      "--popover":              "240 10% 11%",
      "--popover-foreground":   "240 5% 90%",
      "--primary":              "174 72% 48%",
      "--primary-foreground":   "240 10% 6%",
      "--secondary":            "240 8% 16%",
      "--secondary-foreground": "240 5% 72%",
      "--muted":                "240 8% 16%",
      "--muted-foreground":     "240 5% 50%",
      "--accent":               "174 30% 18%",
      "--accent-foreground":    "174 72% 60%",
      "--destructive":          "0 62% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border":               "240 8% 18%",
      "--input":                "240 8% 18%",
      "--ring":                 "174 72% 48%",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SHADCN — Zinc neutral, near-black primary, system-ui stack.
  // Tightest geometry (near-square), compact density, precise weight.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "shadcn",
    label: "shadcn",
    description: "Zinc neutral · system-ui · sharp, compact geometry",
    base: {
      // Fonts — system-ui stack exactly as shadcn ships
      "--font-display":            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "--font-body":               "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "--font-mono":               "ui-monospace, 'SF Mono', 'Fira Code', monospace",
      // Heading style — system-ui, tight tracking
      "--heading-letter-spacing":  "-0.015em",
      "--heading-line-height":     "1.3",
      // Body reading — compact, tighter line-height
      "--body-line-height":        "1.6",
      "--body-letter-spacing":     "0em",
      // Geometry — shadcn's default: 0.5rem base but feels flatter due to palette
      // Use 0.25rem for tight square feel
      "--radius":                  "0.25rem",
      "--radius-sm":               "0.25rem",
      "--radius-md":               "0.375rem",
      "--radius-lg":               "0.5rem",
      "--radius-xl":               "0.75rem",
      // Button — shadcn's own defaults: h-9 (36px), px-4, font-medium
      "--btn-height":              "36px",
      "--btn-height-sm":           "28px",
      "--btn-padding-x":           "1rem",
      "--btn-padding-x-sm":        "0.75rem",
      "--btn-font-weight":         "500",
      "--btn-letter-spacing":      "0em",
      "--btn-font-size":           "0.875rem",
      // Feed item / nav — compact, dense
      "--item-padding-y":          "0.5rem",
      "--item-padding-x":          "0.875rem",
      "--nav-item-height":         "30px",
      "--nav-item-padding-x":      "0.625rem",
      "--nav-item-font-weight":    "400",
      "--nav-item-letter-spacing": "0em",
    },
    light: {
      "--background":           "0 0% 100%",
      "--foreground":           "240 10% 4%",
      "--card":                 "0 0% 100%",
      "--card-foreground":      "240 10% 4%",
      "--popover":              "0 0% 100%",
      "--popover-foreground":   "240 10% 4%",
      "--primary":              "240 6% 10%",
      "--primary-foreground":   "0 0% 98%",
      "--secondary":            "240 5% 96%",
      "--secondary-foreground": "240 6% 10%",
      "--muted":                "240 5% 96%",
      "--muted-foreground":     "240 4% 46%",
      "--accent":               "240 5% 96%",
      "--accent-foreground":    "240 6% 10%",
      "--destructive":          "0 84% 60%",
      "--destructive-foreground": "0 0% 98%",
      "--border":               "240 6% 90%",
      "--input":                "240 6% 90%",
      "--ring":                 "240 6% 10%",
    },
    dark: {
      "--background":           "240 10% 4%",
      "--foreground":           "0 0% 98%",
      "--card":                 "240 10% 4%",
      "--card-foreground":      "0 0% 98%",
      "--popover":              "240 10% 4%",
      "--popover-foreground":   "0 0% 98%",
      "--primary":              "0 0% 98%",
      "--primary-foreground":   "240 6% 10%",
      "--secondary":            "240 4% 16%",
      "--secondary-foreground": "0 0% 98%",
      "--muted":                "240 4% 16%",
      "--muted-foreground":     "240 5% 65%",
      "--accent":               "240 4% 16%",
      "--accent-foreground":    "0 0% 98%",
      "--destructive":          "0 62% 30%",
      "--destructive-foreground": "0 0% 98%",
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

  // Ensure font assets are loaded for this theme
  ensureFontLoaded(prefs.themeId);

  // Merge: base (fonts/geometry/density) + color palette for current mode
  const vars = {
    ...theme.base,
    ...(prefs.colorMode === "dark" ? theme.dark : theme.light),
  };

  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }

  root.style.setProperty("--font-scale", String(prefs.fontScale));
  root.style.setProperty("--reading-pane-inner-max-width", READING_WIDTHS[prefs.readingWidth]);
  root.style.setProperty("--reading-pane-width", `${prefs.paneWidth ?? 480}px`);
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

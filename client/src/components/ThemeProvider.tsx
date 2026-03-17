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

export type ColorMode = "dark" | "light" | "system";
export type ThemeId = "default" | "perplexity" | "shadcn" | "apple" | "material3";
export type ReadingWidth = "compact" | "default" | "wide";

export interface UserPrefs {
  colorMode: ColorMode;
  themeId: ThemeId;
  fontScale: number;
  readingWidth: ReadingWidth;
  /** Reading pane width in pixels — set by drag resize, persisted to DB */
  paneWidth: number;
  /** Container max-width: "default" = 1400px, "wide" = 1920px */
  containerWidth: "default" | "wide";
}

const DEFAULT_PREFS: UserPrefs = {
  colorMode: "system",
  themeId: "default",
  fontScale: 1,
  readingWidth: "default",
  paneWidth: 480,
  containerWidth: "default",
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
  shadcn:   null, // system-ui — no external load needed
  apple:    null, // -apple-system / SF Pro — system font, no load needed
  material3: {
    id: "theme-font-google-sans",
    href: "https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Google+Sans+Display:wght@400;700&family=Roboto:wght@400;500;700&display=swap",
  },
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
      "--btn-height":              "42px",
      "--btn-height-sm":           "36px",
      "--btn-padding-x":           "1.125rem",
      "--btn-padding-x-sm":        "1rem",
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

  // ─────────────────────────────────────────────────────────────────────────
  // APPLE — SF Pro system fonts, pill buttons, true-black dark mode.
  // Signature blue (#0071E3 light / #2997FF dark), very rounded, airy.
  // Uses -apple-system / BlinkMacSystemFont which resolves to SF Pro on
  // Apple devices and falls back to system-ui elsewhere.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "apple" as const,
    label: "Apple",
    description: "SF Pro · pill buttons · true-black dark · Apple HIG",
    base: {
      // Fonts — SF Pro via system font stack
      "--font-display":            "-apple-system, 'SF Pro Display', BlinkMacSystemFont, system-ui, sans-serif",
      "--font-body":               "-apple-system, 'SF Pro Text', BlinkMacSystemFont, system-ui, sans-serif",
      "--font-mono":               "'SF Mono', ui-monospace, monospace",
      // Heading — Apple's tight tracking, short line-height
      "--heading-letter-spacing":  "-0.025em",
      "--heading-line-height":     "1.2",
      // Body — Apple canonical: 17px / 1.47lh (scaled via font-scale)
      "--body-line-height":        "1.47",
      "--body-letter-spacing":     "0em",
      // Geometry — pill buttons, generous card radius
      "--radius":                  "980px",
      "--radius-sm":               "980px",
      "--radius-md":               "18px",
      "--radius-lg":               "22px",
      "--radius-xl":               "28px",
      // Buttons — Apple's 44px touch target, pill, generous padding
      "--btn-height":              "44px",
      "--btn-height-sm":           "36px",
      "--btn-padding-x":           "1.5rem",
      "--btn-padding-x-sm":        "1.125rem",
      "--btn-font-weight":         "500",
      "--btn-letter-spacing":      "0em",
      "--btn-font-size":           "0.9375rem",
      // Density — Apple's generous spacing
      "--item-padding-y":          "0.875rem",
      "--item-padding-x":          "1.25rem",
      "--nav-item-height":         "40px",
      "--nav-item-padding-x":      "1rem",
      "--nav-item-font-weight":    "400",
      "--nav-item-letter-spacing": "0em",
    },
    light: {
      "--background":           "0 0% 96%",      // #F5F5F7 Apple secondary surface
      "--foreground":           "0 0% 11%",       // #1D1D1F Apple near-black
      "--card":                 "0 0% 100%",
      "--card-foreground":      "0 0% 11%",
      "--popover":              "0 0% 100%",
      "--popover-foreground":   "0 0% 11%",
      "--primary":              "214 100% 44%",   // #0071E3 Apple blue
      "--primary-foreground":   "0 0% 100%",
      "--secondary":            "0 0% 94%",       // #F0F0F0
      "--secondary-foreground": "0 0% 11%",
      "--muted":                "0 0% 94%",
      "--muted-foreground":     "0 0% 42%",       // #6E6E73 Apple secondary text
      "--accent":               "214 100% 94%",   // light blue tint
      "--accent-foreground":    "214 100% 36%",
      "--destructive":          "4 84% 52%",      // #FF3B30 Apple red
      "--destructive-foreground": "0 0% 100%",
      "--border":               "0 0% 88%",       // #E0E0E0
      "--input":                "0 0% 88%",
      "--ring":                 "214 100% 44%",
    },
    dark: {
      "--background":           "0 0% 0%",        // #000000 true black
      "--foreground":           "0 0% 96%",        // #F5F5F7
      "--card":                 "0 0% 11%",        // #1C1C1E Apple dark card
      "--card-foreground":      "0 0% 96%",
      "--popover":              "0 0% 11%",
      "--popover-foreground":   "0 0% 96%",
      "--primary":              "211 100% 57%",    // #2997FF Apple dark blue
      "--primary-foreground":   "0 0% 0%",
      "--secondary":            "0 0% 16%",        // #2C2C2E
      "--secondary-foreground": "0 0% 88%",
      "--muted":                "0 0% 16%",
      "--muted-foreground":     "0 0% 55%",        // #8E8E93 Apple dark secondary
      "--accent":               "211 60% 18%",
      "--accent-foreground":    "211 100% 70%",
      "--destructive":          "4 100% 64%",      // #FF453A Apple dark red
      "--destructive-foreground": "0 0% 0%",
      "--border":               "0 0% 20%",        // #333333
      "--input":                "0 0% 20%",
      "--ring":                 "211 100% 57%",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MATERIAL 3 v2 — Google's M3 Expressive spec (2025).
  // Google Sans Display / Google Sans / Roboto.
  // Dynamic color: Violet-purple primary, M3's tonal surface system.
  // Rounded but not pill — M3 uses ExtraLarge (28px) shape for buttons.
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "material3" as const,
    label: "Material 3",
    description: "Google Sans · tonal surfaces · M3 Expressive shape",
    base: {
      // Fonts — Google Sans Display for headings, Roboto for body
      "--font-display":            "'Google Sans Display', 'Google Sans', Roboto, system-ui, sans-serif",
      "--font-body":               "'Google Sans', Roboto, system-ui, sans-serif",
      "--font-mono":               "'Roboto Mono', 'JetBrains Mono', monospace",
      // Heading — M3 display style, moderate tracking
      "--heading-letter-spacing":  "-0.01em",
      "--heading-line-height":     "1.3",
      // Body — Roboto/Google Sans at comfortable density
      "--body-line-height":        "1.6",
      "--body-letter-spacing":     "0.01em",
      // Geometry — M3 ExtraLarge shape token (28px) for components
      "--radius":                  "1.75rem",      // ExtraLarge
      "--radius-sm":               "0.5rem",       // Small
      "--radius-md":               "0.75rem",      // Medium
      "--radius-lg":               "1rem",         // Large
      "--radius-xl":               "1.75rem",      // ExtraLarge
      // Buttons — M3 Filled button: 40dp height, ExtraLarge shape, Label Large
      "--btn-height":              "40px",
      "--btn-height-sm":           "36px",
      "--btn-padding-x":           "1.5rem",
      "--btn-padding-x-sm":        "1.125rem",
      "--btn-font-weight":         "500",
      "--btn-letter-spacing":      "0.00625em",    // M3 Label Large
      "--btn-font-size":           "0.875rem",
      // Density — M3's comfortable, touch-optimised spacing
      "--item-padding-y":          "0.75rem",
      "--item-padding-x":          "1rem",
      "--nav-item-height":         "56px",         // M3 NavigationBar item height
      "--nav-item-padding-x":      "1rem",
      "--nav-item-font-weight":    "500",
      "--nav-item-letter-spacing": "0.00625em",
    },
    light: {
      // M3 Violet-Purple dynamic color scheme (Seed: #6750A4)
      "--background":           "300 17% 98%",    // Surface
      "--foreground":           "264 15% 18%",    // On Surface
      "--card":                 "300 17% 98%",    // Surface Container
      "--card-foreground":      "264 15% 18%",
      "--popover":              "270 25% 96%",    // Surface Container High
      "--popover-foreground":   "264 15% 18%",
      "--primary":              "264 47% 48%",    // #6750A4 Primary
      "--primary-foreground":   "0 0% 100%",      // On Primary
      "--secondary":            "264 12% 92%",    // Secondary Container
      "--secondary-foreground": "264 15% 25%",    // On Secondary Container
      "--muted":                "270 20% 94%",    // Surface Container
      "--muted-foreground":     "264 8% 45%",     // On Surface Variant
      "--accent":               "264 38% 91%",    // Primary Container
      "--accent-foreground":    "264 47% 25%",    // On Primary Container
      "--destructive":          "0 72% 45%",      // Error
      "--destructive-foreground": "0 0% 100%",
      "--border":               "264 12% 88%",    // Outline Variant
      "--input":                "264 12% 88%",
      "--ring":                 "264 47% 48%",
    },
    dark: {
      // M3 dark scheme — tonal surfaces, not just inverted
      "--background":           "264 18% 8%",     // Surface (dark)
      "--foreground":           "264 30% 90%",    // On Surface
      "--card":                 "264 16% 12%",    // Surface Container
      "--card-foreground":      "264 30% 90%",
      "--popover":              "264 16% 16%",    // Surface Container High
      "--popover-foreground":   "264 30% 90%",
      "--primary":              "264 68% 80%",    // #D0BCFF Primary (dark)
      "--primary-foreground":   "264 47% 20%",    // On Primary
      "--secondary":            "264 14% 22%",    // Secondary Container
      "--secondary-foreground": "264 25% 80%",
      "--muted":                "264 14% 18%",
      "--muted-foreground":     "264 18% 60%",    // On Surface Variant
      "--accent":               "264 35% 28%",    // Primary Container
      "--accent-foreground":    "264 68% 90%",    // On Primary Container
      "--destructive":          "0 80% 72%",      // Error (dark)
      "--destructive-foreground": "0 35% 12%",
      "--border":               "264 12% 28%",    // Outline Variant
      "--input":                "264 12% 28%",
      "--ring":                 "264 68% 80%",
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
    ...((prefs.colorMode === "dark" || (prefs.colorMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) ? theme.dark : theme.light),
  };

  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }

  root.style.setProperty("--font-scale", String(prefs.fontScale));
  root.style.setProperty("--reading-pane-inner-max-width", READING_WIDTHS[prefs.readingWidth]);
  root.style.setProperty("--reading-pane-width", `${prefs.paneWidth ?? 480}px`);
  root.style.setProperty("--content-wide", prefs.containerWidth === "wide" ? "1920px" : "1400px");
  const resolvedDark = prefs.colorMode === "dark" || (prefs.colorMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", resolvedDark ? "dark" : "light");
  root.classList.toggle("dark", resolvedDark);
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
    savePrefs({ ...prefs, colorMode: prefs.colorMode === "dark" ? "light" : "dark" }); // toggle ignores system
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

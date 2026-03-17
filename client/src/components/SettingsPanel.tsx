/**
 * SettingsPanel — slide-in panel for theme and display preferences
 *
 * Live preview works by calling applyPrefs() directly on the DOM (pure CSS var
 * mutation, zero React state change, zero re-render). Only hitting Save commits
 * to React state and persists to DB. This eliminates the flicker loop.
 *
 * On close without saving, we revert by re-applying the last saved prefs.
 */

import { useState, useEffect, useCallback } from "react";
import { X, Check } from "lucide-react";
import {
  useTheme,
  applyPrefs,
  THEMES,
  type UserPrefs,
  type ThemeId,
  type ReadingWidth,
  type ColorMode,
} from "@/components/ThemeProvider";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: "var(--text-xs)",
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const,
      color: "hsl(var(--muted-foreground))",
      marginBottom: "var(--space-2)",
    }}>
      {children}
    </p>
  );
}

function ThemeCard({
  theme,
  selected,
  colorMode,
  onSelect,
}: {
  theme: typeof THEMES[number];
  selected: boolean;
  colorMode: ColorMode;
  onSelect: () => void;
}) {
  const resolvedDark = colorMode === "dark" || (colorMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const vars = resolvedDark ? theme.dark : theme.light;
  const bg      = `hsl(${vars["--background"]})`;
  const card    = `hsl(${vars["--card"]})`;
  const primary = `hsl(${vars["--primary"]})`;
  const border  = `hsl(${vars["--border"]})`;
  const fg      = `hsl(${vars["--foreground"]})`;
  const muted   = `hsl(${vars["--muted-foreground"]})`;

  return (
    <button
      onClick={onSelect}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column" as const,
        gap: 6,
        padding: 10,
        borderRadius: "var(--radius-md)",
        border: `2px solid ${selected ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
        background: "hsl(var(--card))",
        cursor: "pointer",
        transition: "border-color 160ms ease",
        textAlign: "left" as const,
        width: "100%",
      }}
    >
      {/* Mini preview */}
      <div style={{
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        height: 52,
        background: bg,
        border: `1px solid ${border}`,
        display: "flex",
        flexDirection: "column" as const,
        gap: 4,
        padding: 6,
      }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: primary }} />
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: muted, opacity: 0.4 }} />
          <div style={{ width: 16, height: 4, borderRadius: 2, background: primary }} />
        </div>
        <div style={{
          flex: 1,
          borderRadius: 3,
          background: card,
          border: `1px solid ${border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 5px",
          gap: 4,
        }}>
          <div style={{ width: 4, height: 4, borderRadius: 1, background: primary }} />
          <div style={{ flex: 1, height: 3, borderRadius: 2, background: fg, opacity: 0.25 }} />
        </div>
      </div>
      <div>
        <p style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "hsl(var(--foreground))" }}>
          {theme.label}
        </p>
        <p style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))", marginTop: 1, lineHeight: 1.3 }}>
          {theme.description}
        </p>
      </div>
      {selected && (
        <div style={{
          position: "absolute",
          top: 6, right: 6,
          width: 16, height: 16,
          borderRadius: "50%",
          background: "hsl(var(--primary))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Check size={10} color="hsl(var(--primary-foreground))" />
        </div>
      )}
    </button>
  );
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { prefs, savePrefs } = useTheme();

  // Local draft — mutations go straight to the DOM via applyPrefs(),
  // NOT through setPrefs in context (that would trigger re-renders).
  const [draft, setDraft] = useState<UserPrefs>(prefs);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed draft from saved prefs each time panel opens
  useEffect(() => {
    if (isOpen) {
      setDraft(prefs);
      setSaved(false);
    }
  }, [isOpen]); // intentionally NOT including prefs — only re-seed on open

  // Update draft AND push to DOM immediately (no React re-render on the app)
  const updateDraft = useCallback((patch: Partial<UserPrefs>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      applyPrefs(next); // pure DOM mutation, zero re-render
      return next;
    });
    setSaved(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await savePrefs(draft); // commits to React state + DB
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    // Revert any unsaved preview changes back to last saved state
    applyPrefs(prefs);
    setDraft(prefs);
    onClose();
  };

  const FONT_SCALE_STEPS = [
    { value: 0.85, label: "XS" },
    { value: 0.92, label: "S"  },
    { value: 1,    label: "M"  },
    { value: 1.08, label: "L"  },
    { value: 1.16, label: "XL" },
  ];

  const READING_WIDTHS: { value: ReadingWidth; label: string }[] = [
    { value: "compact", label: "Compact" },
    { value: "default", label: "Default" },
    { value: "wide",    label: "Wide"    },
  ];

  return (
    <>
      {isOpen && (
        <div
          onClick={handleClose}
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 49,
            animation: "fadeIn 180ms ease",
          }}
        />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Display settings"
        style={{
          position: "fixed",
          top: 0, right: 0, bottom: 0,
          width: 340,
          background: "hsl(var(--card))",
          borderLeft: "1px solid hsl(var(--border))",
          zIndex: 50,
          display: "flex",
          flexDirection: "column" as const,
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: isOpen ? "var(--shadow-lg)" : "none",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-5)",
          height: 52,
          borderBottom: "1px solid hsl(var(--border))",
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "var(--text-sm)",
            color: "hsl(var(--foreground))",
          }}>
            Display Settings
          </span>
          <button
            onClick={handleClose}
            aria-label="Close settings"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28,
              borderRadius: "var(--radius-sm)",
              border: "none", background: "none",
              cursor: "pointer",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-5)" }}>

          {/* Mode */}
          <section style={{ marginBottom: "var(--space-6)" }}>
            <SectionLabel>Mode</SectionLabel>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              {(["light", "system", "dark"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updateDraft({ colorMode: mode })}
                  style={{
                    flex: 1,
                    padding: "var(--space-2) var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                    border: `2px solid ${draft.colorMode === mode ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                    background: draft.colorMode === mode ? "hsl(var(--accent))" : "hsl(var(--card))",
                    color: draft.colorMode === mode ? "hsl(var(--accent-foreground))" : "hsl(var(--muted-foreground))",
                    fontSize: "var(--text-xs)", fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 160ms ease",
                    textTransform: "capitalize" as const,
                  }}
                >
                  {mode === "light" ? "☀️ Light" : mode === "system" ? "💻 System" : "🌙 Dark"}
                </button>
              ))}
            </div>
          </section>

          {/* Theme */}
          <section style={{ marginBottom: "var(--space-6)" }}>
            <SectionLabel>Theme</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: "var(--space-2)" }}>
              {THEMES.map((t) => (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  selected={draft.themeId === t.id}
                  colorMode={draft.colorMode}
                  onSelect={() => updateDraft({ themeId: t.id as ThemeId })}
                />
              ))}
            </div>
          </section>

          {/* Text size */}
          <section style={{ marginBottom: "var(--space-6)" }}>
            <SectionLabel>Text Size</SectionLabel>
            <div style={{ display: "flex", gap: "var(--space-1)" }}>
              {FONT_SCALE_STEPS.map(({ value, label }) => {
                const active = Math.abs(draft.fontScale - value) < 0.01;
                return (
                  <button
                    key={value}
                    onClick={() => updateDraft({ fontScale: value })}
                    style={{
                      flex: 1, height: 32,
                      borderRadius: "var(--radius-sm)",
                      border: `2px solid ${active ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                      background: active ? "hsl(var(--accent))" : "hsl(var(--card))",
                      color: active ? "hsl(var(--accent-foreground))" : "hsl(var(--muted-foreground))",
                      fontSize: "11px", fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 160ms ease",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Reading width */}
          <section style={{ marginBottom: "var(--space-6)" }}>
            <SectionLabel>Reading Width</SectionLabel>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              {READING_WIDTHS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => updateDraft({ readingWidth: value })}
                  style={{
                    flex: 1,
                    padding: "var(--space-2) var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                    border: `2px solid ${draft.readingWidth === value ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                    background: draft.readingWidth === value ? "hsl(var(--accent))" : "hsl(var(--card))",
                    color: draft.readingWidth === value ? "hsl(var(--accent-foreground))" : "hsl(var(--muted-foreground))",
                    fontSize: "var(--text-xs)", fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 160ms ease",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Container width */}
          <section style={{ marginBottom: "var(--space-6)" }}>
            <SectionLabel>Container Width</SectionLabel>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              {(["default", "wide"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => updateDraft({ containerWidth: value })}
                  style={{
                    flex: 1,
                    padding: "var(--space-2) var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                    border: `2px solid ${
                      draft.containerWidth === value ? "hsl(var(--primary))" : "hsl(var(--border))"
                    }`,
                    background: draft.containerWidth === value ? "hsl(var(--accent))" : "hsl(var(--card))",
                    color: draft.containerWidth === value
                      ? "hsl(var(--accent-foreground))"
                      : "hsl(var(--muted-foreground))",
                    fontSize: "var(--text-xs)", fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 160ms ease",
                  }}
                >
                  {value === "default" ? "Default (1400px)" : "Large (1920px)"}
                </button>
              ))}
            </div>
          </section>

        </div>

        {/* Footer */}
        <div style={{
          padding: "var(--space-4) var(--space-5)",
          borderTop: "1px solid hsl(var(--border))",
          display: "flex",
          gap: "var(--space-2)",
          flexShrink: 0,
        }}>
          <button
            onClick={() => updateDraft({ themeId: "default", fontScale: 1, readingWidth: "default", containerWidth: "default" })}
            style={{
              flex: 1, height: 36,
              borderRadius: "var(--radius-sm)",
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--card))",
              color: "hsl(var(--muted-foreground))",
              fontSize: "var(--text-xs)", fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2, height: 36,
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: saved ? "hsl(142 72% 29%)" : "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              fontSize: "var(--text-xs)", fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
              transition: "background 200ms ease",
            }}
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}

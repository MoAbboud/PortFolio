/**
 * Design tokens — the single source of truth for the app's look.
 *
 * 👉 To rebrand whereyago, change the values here (especially `color.primary`)
 *    and the whole app updates. This is your "skin".
 */
export const tokens = {
  color: {
    background: "#f6f7fb",
    surface: "#ffffff",
    surfaceAlt: "#eef0f6",
    text: "#16181d",
    textMuted: "#6b7280",
    border: "#e5e7eb",
    primary: "#4f46e5", // ← the brand accent; change this first when reskinning
    primaryText: "#ffffff",
    danger: "#dc2626",
    success: "#16a34a",
  },
  /** 4-pt spacing scale: space(2) = 8px, space(4) = 16px, etc. */
  space: (n: number): number => n * 4,
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  font: { xs: 12, sm: 13, md: 15, lg: 18, xl: 22, xxl: 30 },
} as const;

export type Tokens = typeof tokens;

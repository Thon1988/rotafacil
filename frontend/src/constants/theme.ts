export const COLORS = {
  // Backgrounds
  bgBase: "#0A0A0A",
  bgSurface: "#171717",
  bgElevated: "#262626",

  // Brand
  primary: "#ea580c",
  primaryHover: "#c2410c",
  routeLine: "#3b82f6",

  // Status
  success: "#16a34a",
  successBg: "rgba(22,163,74,0.15)",
  error: "#dc2626",
  errorBg: "rgba(220,38,38,0.15)",
  pending: "#f59e0b",

  // Text
  textPrimary: "#F9FAFB",
  textSecondary: "#9CA3AF",
  textTertiary: "#6B7280",
  textInverse: "#0A0A0A",

  // Borders
  border: "#333333",
  borderStrong: "#525252",
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const RADIUS = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
};

export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
export const API = `${BACKEND_URL}/api`;

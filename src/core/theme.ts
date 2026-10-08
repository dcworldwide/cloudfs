import { DEFAULT_PRIMARY } from "./store";

export type ColorMode = "dark" | "light";

export interface AppTheme {
  mode: ColorMode;
  color: {
    primary: string;
    primaryText: string;
    bg: string;
    surface: string;
    surfaceRaised: string;
    border: string;
    text: string;
    muted: string;
    danger: string;
    ok: string;
  };
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: number;
  font: string;
  mono: string;
  backdrop: string;
}

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function mix(hex: string, toward: number, amount: number): string {
  const value = (index: number) => Math.round(channel(hex, index) + (toward - channel(hex, index)) * amount);
  return `#${[0, 1, 2].map((index) => value(index).toString(16).padStart(2, "0")).join("")}`;
}

function rgba(hex: string, alpha: number): string {
  return `rgba(${channel(hex, 0)}, ${channel(hex, 1)}, ${channel(hex, 2)}, ${alpha})`;
}

/** Soft top wash derived from the primary color, matching the reference light treatment. */
export function appBackdrop(primary: string, mode: ColorMode): string {
  const color = isHexColor(primary) ? primary : DEFAULT_PRIMARY;
  const left = mix(color, 255, mode === "light" ? 0.45 : 0.2);
  const mid = mix(color, mode === "light" ? 255 : 40, mode === "light" ? 0.25 : 0.35);
  const right = mix(color, mode === "light" ? 220 : 80, 0.35);
  const floor = mode === "light" ? "#f3f2f0" : "#0c1018";
  const strength = mode === "light" ? [0.55, 0.5, 0.42, 0.36, 0.28] : [0.42, 0.34, 0.28, 0.22, 0.16];
  return [
    `radial-gradient(120% 82% at 12% -8%, ${rgba(left, strength[0])} 0%, ${rgba(left, strength[0] * 0.72)} 28%, transparent 58%)`,
    `radial-gradient(100% 75% at 50% -10%, ${rgba(mid, strength[1])} 0%, ${rgba(mid, strength[1] * 0.7)} 32%, transparent 60%)`,
    `radial-gradient(80% 66% at 88% -6%, ${rgba(right, strength[2])} 0%, transparent 56%)`,
    `radial-gradient(70% 45% at 38% 14%, ${rgba(mix(color, 255, 0.55), strength[3])} 0%, transparent 52%)`,
    `radial-gradient(55% 38% at 70% 16%, ${rgba(color, strength[4])} 0%, transparent 51%)`,
    `linear-gradient(${rgba(floor, 0)} 0%, ${rgba(floor, 0.35)} 36%, ${floor} 69%)`,
    floor,
  ].join(", ");
}

export function readableOn(hex: string): string {
  const r = channel(hex, 0);
  const g = channel(hex, 1);
  const b = channel(hex, 2);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

const palettes: Record<ColorMode, Omit<AppTheme["color"], "primary" | "primaryText">> = {
  dark: {
    bg: "#0b1220",
    surface: "#121a2b",
    surfaceRaised: "#1b2740",
    border: "#2a3854",
    text: "#e7eefc",
    muted: "#93a4c4",
    danger: "#f07178",
    ok: "#7fd99a",
  },
  light: {
    bg: "#f4f7fb",
    surface: "#ffffff",
    surfaceRaised: "#e8eef8",
    border: "#d3dced",
    text: "#152033",
    muted: "#5c6b84",
    danger: "#c2414a",
    ok: "#1f7a45",
  },
};

export function isColorMode(value: unknown): value is ColorMode {
  return value === "dark" || value === "light";
}

export function buildTheme(primary = DEFAULT_PRIMARY, mode: ColorMode = "dark"): AppTheme {
  const color = isHexColor(primary) ? primary : DEFAULT_PRIMARY;
  const palette = palettes[isColorMode(mode) ? mode : "dark"];
  return {
    mode: isColorMode(mode) ? mode : "dark",
    color: {
      primary: color,
      primaryText: readableOn(color),
      ...palette,
    },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    radius: 8,
    font: '"IBM Plex Sans", "Segoe UI", sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, monospace',
    backdrop: appBackdrop(color, isColorMode(mode) ? mode : "dark"),
  };
}

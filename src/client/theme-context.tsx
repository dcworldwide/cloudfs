import { ThemeProvider } from "@emotion/react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { buildTheme, type ColorMode } from "../core/theme";
import { DEFAULT_PRIMARY } from "../core/store";

interface ThemeValue {
  primary: string;
  setPrimary: (color: string) => void;
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function AppThemeProvider({
  initial,
  initialMode,
  children,
}: {
  initial: string;
  initialMode: ColorMode;
  children: ReactNode;
}) {
  const [primary, setPrimary] = useState(initial || DEFAULT_PRIMARY);
  const [mode, setMode] = useState<ColorMode>(initialMode === "light" ? "light" : "dark");
  const theme = useMemo(() => buildTheme(primary, mode), [primary, mode]);
  const value = useMemo(() => ({ primary, setPrimary, mode, setMode }), [primary, mode]);
  return (
    <ThemeContext.Provider value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeColor(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeContext is missing.");
  return value;
}

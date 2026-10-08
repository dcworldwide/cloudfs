import { Global, css, useTheme } from "@emotion/react";
import { useEffect, useState } from "react";
import { HashRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import type { AppState } from "../../electron/preload";
import { api } from "./api";
import { AddStore } from "./screens/AddStore";
import { Explorer } from "./screens/Explorer";
import { Settings } from "./screens/Settings";
import { GearIcon } from "./ui/icons";
import { AppStateProvider } from "./state";
import { AppThemeProvider } from "./theme-context";
import { AppShell, Brand, Row, TopBar, Version, Wordmark } from "./ui/layout";
import { Button, IconButton, Toast } from "./ui/primitives";
import { Toaster } from "./ui/toast";


function OverlayRoutes() {
  const location = useLocation();
  if (location.pathname === "/stores/new") return <AddStore />;
  if (location.pathname === "/settings") return <Settings />;
  return null;
}

function Shell({ state }: { state: AppState }) {
  const theme = useTheme();
  return (
    <AppStateProvider initial={state}>
      <Global
        styles={css`
          html,
          body,
          #root {
            height: 100%;
            margin: 0;
          }
          body {
            background: ${theme.backdrop};
            background-attachment: fixed;
            color: ${theme.color.text};
          }
          * {
            box-sizing: border-box;
          }
        `}
      />
      <Toast.Provider timeout={4000}>
      <HashRouter>
        <AppShell>
          <TopBar>
            <Brand>
              <Wordmark>Cloudfs</Wordmark>
              <Version>{state.version}</Version>
            </Brand>
            <Row>
              <Button variant="action" nativeButton={false} render={<Link to="/stores/new" />}>
                Sources
              </Button>
              <IconButton title="Settings" aria-label="Settings" nativeButton={false} render={<Link to="/settings" />}>
                <GearIcon />
              </IconButton>
            </Row>
          </TopBar>
          <Routes>
            <Route path="/" element={<Explorer />} />
            <Route path="/stores/new" element={<Explorer />} />
            <Route path="/settings" element={<Explorer />} />
          </Routes>
          <OverlayRoutes />
          <Toaster />
        </AppShell>
      </HashRouter>
      </Toast.Provider>
    </AppStateProvider>
  );
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api()
      .getState()
      .then(setState)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load config."));
  }, []);

  if (error) return <p>{error}</p>;
  if (!state) return null;
  return (
    <AppThemeProvider initial={state.primaryColor} initialMode={state.colorMode}>
      <Shell state={state} />
    </AppThemeProvider>
  );
}

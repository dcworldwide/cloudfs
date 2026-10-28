import { Global, css, useTheme } from "@emotion/react";
import { useEffect, useState } from "react";
import { HashRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import type { AppState } from "../../electron/preload";
import { api } from "./api";
import { AddStore } from "./screens/AddStore";
import { Explorer, TabBar } from "./screens/Explorer";
import { Settings } from "./screens/Settings";
import { UpdateControl } from "./screens/UpdateControl";
import { GearIcon, TransfersIcon } from "./ui/icons";
import { AppStateProvider } from "./state";
import { AppThemeProvider } from "./theme-context";
import { AppShell, Brand, Row, TopBar, Version, Wordmark } from "./ui/layout";
import { Button, IconButton, IconToggle, Toast } from "./ui/primitives";
import { Toaster } from "./ui/toast";


function OverlayRoutes() {
  const location = useLocation();
  if (location.pathname === "/stores/new") return <AddStore />;
  if (location.pathname === "/settings") return <Settings />;
  return null;
}

function Shell({ state }: { state: AppState }) {
  const theme = useTheme();
  const [queuePinned, setQueuePinned] = useState(false);
  const [queueDismissed, setQueueDismissed] = useState(0);
  const closeQueue = () => {
    setQueuePinned(false);
    setQueueDismissed((count) => count + 1);
  };
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
            <Routes>
              <Route path="*" element={<TabBar />} />
            </Routes>
            <Row>
              <UpdateControl variant="header" />
              <IconToggle
                title={queuePinned ? "Close transfers" : "Show transfers"}
                aria-label={queuePinned ? "Close transfers" : "Show transfers"}
                pressed={queuePinned}
                onPressedChange={(pressed) => (pressed ? setQueuePinned(true) : closeQueue())}
              >
                <TransfersIcon />
              </IconToggle>
              <Button variant="action" nativeButton={false} render={<Link to="/stores/new" />}>
                Sources
              </Button>
              <IconButton title="Settings" aria-label="Settings" nativeButton={false} render={<Link to="/settings" />}>
                <GearIcon />
              </IconButton>
            </Row>
          </TopBar>
          <UpdateControl variant="banner" />
          <Routes>
            <Route path="/" element={<Explorer queuePinned={queuePinned} queueDismissed={queueDismissed} onCloseQueue={closeQueue} />} />
            <Route path="/stores/new" element={<Explorer queuePinned={queuePinned} queueDismissed={queueDismissed} onCloseQueue={closeQueue} />} />
            <Route path="/settings" element={<Explorer queuePinned={queuePinned} queueDismissed={queueDismissed} onCloseQueue={closeQueue} />} />
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

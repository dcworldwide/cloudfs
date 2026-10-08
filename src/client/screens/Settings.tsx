import styled from "@emotion/styled";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { isHexColor } from "../../core/theme";
import { useEffect } from "react";
import { api } from "../api";
import { useConfig } from "../state";
import { useThemeColor } from "../theme-context";
import { Muted, PathText, Stack } from "../ui/layout";
import { Modal } from "../ui/Modal";
import { Button, FieldLabel, FieldRoot, ModeButton, ModeGroup, TextInput } from "../ui/primitives";

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.lg}px;
`;

const Heading = styled.h2`
  margin: 0;
  font: 500 12px ${({ theme }) => theme.font};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.color.muted};
`;

const Swatch = styled.input`
  width: 64px;
  height: 40px;
  padding: 0;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: transparent;
`;

export function Settings() {
  const navigate = useNavigate();
  const { state, refresh } = useConfig();
  const theme = useThemeColor();
  const [color, setColor] = useState(theme.primary);
  const [concurrency, setConcurrency] = useState(String(state.concurrency));
  const [confirmImport, setConfirmImport] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [update, setUpdate] = useState(state.update);

  useEffect(() => api().onUpdate(setUpdate), []);

  function editColor(next: string) {
    setColor(next);
    if (isHexColor(next)) void commitColor(next);
  }

  async function commitColor(next: string) {
    if (!isHexColor(next)) return;
    theme.setPrimary(next);
    await api().setPrimaryColor(next);
  }

  return (
    <>
    <Modal
      open
      onClose={() => navigate("/")}
      title="Settings"
      description={`Cloudfs ${state.version}. Configuration is stored on this computer and is not encrypted.`}
    >
    <Page>
      <Stack>
        <Heading>Configuration file</Heading>
        <PathText>{state.configPath}</PathText>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="normal" onClick={() => void api().revealConfig()}>
            Reveal in {navigator.platform.includes("Win") ? "Explorer" : "Finder"}
          </Button>
          <Button
            variant="normal"
            onClick={async () => {
              const file = await api().exportConfig();
              setMessage(file ? `Exported to ${file}` : "Export cancelled.");
            }}
          >
            Export
          </Button>
          <Button variant="normal" onClick={() => setConfirmImport(true)}>
            Import
          </Button>
        </div>
      </Stack>
      <Stack>
        <Heading>Appearance</Heading>
        <ModeGroup
          value={[theme.mode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next !== "dark" && next !== "light") return;
            theme.setMode(next);
            void api().setColorMode(next);
          }}
        >
          <ModeButton value="dark">Dark</ModeButton>
          <ModeButton value="light">Light</ModeButton>
        </ModeGroup>
      </Stack>
      <Stack>
        <Heading>Primary color</Heading>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Swatch type="color" value={isHexColor(color) ? color : "#2563eb"} onChange={(event) => editColor(event.target.value)} />
          <TextInput value={color} onChange={(event) => editColor(event.target.value)} style={{ maxWidth: 140 }} />
        </div>
      </Stack>
      <FieldRoot>
        <FieldLabel>Transfer concurrency</FieldLabel>
        <TextInput
          type="number"
          min={1}
          max={8}
          value={concurrency}
          onChange={(event) => setConcurrency(event.target.value)}
          onBlur={() => void api().setConcurrency(Number(concurrency)).then(refresh)}
          style={{ maxWidth: 120 }}
        />
      </FieldRoot>
      <Stack>
        <Heading>Updates</Heading>
        <Muted>
          {update.status}
          {update.version ? ` · ${update.version}` : ""}
          {update.percent != null ? ` · ${Math.round(update.percent)}%` : ""}
          {update.message ? ` · ${update.message}` : ""}
        </Muted>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="normal" onClick={() => void api().checkForUpdates()}>
            Check for updates
          </Button>
          <Button
            variant="action"
            onClick={async () => {
              const result = await api().restartToUpdate();
              setUpdate((current) => ({ ...current, message: result === "deferred" ? "Waiting for transfers to finish." : current.message }));
            }}
          >
            Restart to update
          </Button>
        </div>
      </Stack>
      {message ? <Muted>{message}</Muted> : null}
    </Page>
    </Modal>
    <Modal
      open={confirmImport}
      onClose={() => setConfirmImport(false)}
      title="Replace saved stores?"
      description="Import overwrites the accounts and theme in the config file on this computer. Tabs stay as they are."
    >
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          variant="action"
          onClick={() => {
            setConfirmImport(false);
            void api().importConfig().then(refresh);
          }}
        >
          Import
        </Button>
        <Button variant="normal" onClick={() => setConfirmImport(false)}>
          Cancel
        </Button>
      </div>
    </Modal>
    </>
  );
}

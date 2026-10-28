import styled from "@emotion/styled";
import { useEffect, useState } from "react";
import type { UpdateView } from "../../../electron/preload";
import { updateDeferredMessage, updateStatusText } from "../../core/updater";
import { api } from "../api";
import { useConfig } from "../state";
import { Button } from "../ui/primitives";

export type UpdateControlVariant = "banner" | "header" | "settings";

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 ${({ theme }) => theme.space.lg}px ${({ theme }) => theme.space.sm}px;
  padding: 8px 12px;
  border-radius: 12px;
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  color: ${({ theme }) => theme.color.text};
  font-size: 13px;
  line-height: 1.4;
`;

const Note = styled.span`
  color: ${({ theme }) => theme.color.muted};
`;

const SettingsNote = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.color.muted};
  font-size: 13px;
  line-height: 1.5;
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const StatusChip = styled.span`
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  padding: 0 ${({ theme }) => theme.space.md}px;
  border-radius: ${({ theme }) => theme.radius}px;
  border: 1px solid ${({ theme }) => theme.color.primary};
  color: ${({ theme }) => theme.color.text};
  background: ${({ theme }) => theme.color.surface};
  font: 500 14px ${({ theme }) => theme.font};
  white-space: nowrap;
`;

function actionLabel(update: UpdateView): string | null {
  if (update.status === "ready") return "Restart to update";
  if (update.status === "checking" || update.status === "available" || update.status === "downloading") return null;
  if (update.status === "idle" && update.message) return null;
  return "Check for updates";
}

export function UpdateControl({ variant }: { variant: UpdateControlVariant }) {
  const { state } = useConfig();
  const [update, setUpdate] = useState<UpdateView>(state.update);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => api().onUpdate(setUpdate), []);

  const label = actionLabel(update);
  const busy = update.status === "checking";

  async function run() {
    if (update.status === "ready") {
      const result = await api().restartToUpdate();
      setNote(result === "deferred" ? updateDeferredMessage : null);
      return;
    }
    setNote(null);
    await api().checkForUpdates();
  }

  if (variant === "banner") {
    if (update.status !== "available" && update.status !== "downloading" && update.status !== "ready") return null;
    return (
      <Bar>
        <span>
          {updateStatusText(update)}
          {note ? <Note> {note}</Note> : null}
        </span>
        {label ? (
          <Button variant="action" disabled={busy} onClick={() => void run()}>
            {label}
          </Button>
        ) : null}
      </Bar>
    );
  }

  if (variant === "header") {
    if (update.status === "available" || update.status === "downloading") {
      const percent = update.percent == null ? "" : ` ${Math.round(update.percent)}%`;
      return <StatusChip title={updateStatusText(update)}>Downloading {update.version ?? "update"}{percent}</StatusChip>;
    }
    if (update.status !== "ready" && update.status !== "error") return null;
    if (!label) return null;
    return (
      <Button
        variant={update.status === "ready" ? "action" : "normal"}
        disabled={busy}
        title={note ?? updateStatusText(update)}
        onClick={() => void run()}
      >
        {label}
      </Button>
    );
  }

  return (
    <>
      <SettingsNote>{updateStatusText(update)}</SettingsNote>
      {note ? <SettingsNote>{note}</SettingsNote> : null}
      {label ? (
        <Actions>
          <Button variant={update.status === "ready" ? "action" : "normal"} disabled={busy} onClick={() => void run()}>
            {label}
          </Button>
        </Actions>
      ) : null}
    </>
  );
}

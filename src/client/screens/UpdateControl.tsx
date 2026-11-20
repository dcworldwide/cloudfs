import styled from "@emotion/styled";
import { useEffect, useState } from "react";
import type { UpdateView } from "../../../electron/preload";
import { updateDeferredMessage, updateStatusText } from "../../core/updater";
import { api } from "../api";
import { useConfig } from "../state";
import { Button } from "../ui/primitives";

export type UpdateControlVariant = "header" | "settings";

export interface HeaderUpdateModel {
  kind: "download" | "restart" | "retry";
  label: string;
  title: string;
}

/** Compact top-bar states. Idle and checking stay in Settings so the bar does not flicker. */
export function headerUpdateModel(update: UpdateView, note?: string | null): HeaderUpdateModel | null {
  if (update.status === "available" || update.status === "downloading") {
    const version = update.version ?? "update";
    const percent = update.percent == null ? "" : ` ${Math.round(update.percent)}%`;
    return { kind: "download", label: `Downloading ${version}${percent}`, title: updateStatusText(update) };
  }
  if (update.status === "ready") {
    const title = updateStatusText(update);
    return { kind: "restart", label: "Restart to update", title: note ? `${title} ${note}` : title };
  }
  if (update.status === "error") {
    return { kind: "retry", label: "Check for updates", title: note?.trim() || updateStatusText(update) };
  }
  return null;
}

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

  if (variant === "header") {
    const model = headerUpdateModel(update, note);
    if (!model) return null;
    if (model.kind === "download") return <StatusChip title={model.title}>{model.label}</StatusChip>;
    return (
      <Button
        variant={model.kind === "restart" ? "action" : "normal"}
        disabled={busy}
        title={model.title}
        onClick={() => void run()}
      >
        {model.label}
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

import styled from "@emotion/styled";
import { useEffect, useState } from "react";
import type { UpdateView } from "../../../electron/preload";
import { updateDeferredMessage, updateStatusText } from "../../core/updater";
import { api } from "../api";
import { useConfig } from "../state";
import { Button } from "../ui/primitives";

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

export function UpdateBanner() {
  const { state } = useConfig();
  const [update, setUpdate] = useState<UpdateView>(state.update);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => api().onUpdate(setUpdate), []);

  if (update.status !== "available" && update.status !== "downloading" && update.status !== "ready") return null;

  return (
    <Bar>
      <span>
        {updateStatusText(update)}
        {note ? <Note> {note}</Note> : null}
      </span>
      {update.status === "ready" ? (
        <Button
          variant="action"
          onClick={async () => {
            const result = await api().restartToUpdate();
            setNote(result === "deferred" ? updateDeferredMessage : null);
          }}
        >
          Restart to update
        </Button>
      ) : null}
    </Bar>
  );
}

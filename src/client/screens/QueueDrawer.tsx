import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";
import { useEffect, useState } from "react";
import type { TransferJob } from "../../core/store";
import { CopyIcon, MoveIcon, TrashIcon } from "../ui/icons";
import { useQueue } from "../state";
import { Button, Progress, ProgressIndicator, ProgressTrack } from "../ui/primitives";

const rise = keyframes`
  from { transform: translateY(24px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const settle = keyframes`
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(24px); opacity: 0; }
`;

const Sheet = styled.section<{ leaving?: boolean }>`
  animation: ${({ leaving }) => (leaving ? settle : rise)} 220ms ease;
  animation-fill-mode: both;
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 20;
  max-height: min(42vh, 320px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => (theme.mode === "light" ? "rgba(255,255,255,0.55)" : "rgba(16,20,34,0.5)")};
  backdrop-filter: blur(22px) saturate(1.4);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(16px);
  animation: ${rise} 180ms ease;
  @media (max-width: 900px) {
    left: 8px;
    right: 8px;
    bottom: 8px;
    max-height: 55vh;
  }
`;

const Summary = styled.button`
  width: 100%;
  min-height: 44px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 ${({ theme }) => theme.space.md}px;
  border: 0;
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  font: 500 13px ${({ theme }) => theme.font};
  cursor: pointer;
`;

const List = styled.div`
  overflow: auto;
  border-top: 1px solid ${({ theme }) => theme.color.border};
`;

const Job = styled.div`
  display: grid;
  grid-template-columns: 1fr 120px auto;
  gap: 8px;
  align-items: center;
  padding: 8px ${({ theme }) => theme.space.md}px;
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

function percent(job: TransferJob): number {
  if (!job.bytesTotal) return job.status === "done" ? 100 : 0;
  return Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100));
}

function label(job: TransferJob): string {
  if (job.kind === "move") return "Move";
  if (job.kind === "delete") return "Delete";
  return "Copy";
}

export function QueueDrawer() {
  const queue = useQueue();
  const pending = queue.jobs.filter((job) => job.status === "running" || job.status === "queued" || job.status === "paused");
  const done = queue.jobs.filter((job) => job.status === "done" || job.status === "error" || job.status === "cancelled");
  const [present, setPresent] = useState(pending.length > 0);
  const [leaving, setLeaving] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (pending.length > 0) {
      setLeaving(false);
      setPresent(true);
      setOpen(true);
      return;
    }
    if (!present || queue.jobs.length === 0) return;
    const timer = setTimeout(() => setLeaving(true), 3000);
    return () => clearTimeout(timer);
  }, [pending.length, present, queue.jobs.length]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setPresent(false);
      setLeaving(false);
    }, 220);
    return () => clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-queue]")) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!present || queue.jobs.length === 0) return null;
  const bytes = queue.jobs.reduce((sum, job) => sum + job.bytesDone, 0);

  return (
    <Sheet data-queue="" tabIndex={-1} leaving={leaving}>
      <Summary onClick={() => setOpen((value) => !value)}>
        <span>
          {[
            pending.length ? `${pending.length} in queue` : null,
            done.length ? `${done.length} finished` : null,
            `${Math.round(bytes / 1024)} KB moved`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span>{open ? "Hide" : "Show"}</span>
      </Summary>
      {open ? (
        <List>
          {queue.jobs.map((job) => {
            const live = job.status === "running" || job.status === "queued";
            const finished = job.status === "done" || job.status === "error" || job.status === "cancelled";
            return (
              <Job key={job.id}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {job.kind === "move" ? <MoveIcon /> : job.kind === "delete" ? <TrashIcon /> : <CopyIcon />}
                    <span>
                      {label(job)} · {job.name}
                    </span>
                  </div>
                  <Progress.Root value={percent(job)} style={{ marginTop: 6 }}>
                    <ProgressTrack>
                      <ProgressIndicator style={{ width: `${percent(job)}%` }} />
                    </ProgressTrack>
                  </Progress.Root>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    {job.status}
                    {job.error ? ` · ${job.error}` : ""} · {percent(job)}%
                  </span>
                </div>
                <span>{job.bytesTotal ? `${job.bytesDone} / ${job.bytesTotal}` : `${job.bytesDone} B`}</span>
                <span style={{ display: "flex", gap: 6, justifyContent: "end" }}>
                  {job.status === "paused" ? (
                    <Button variant="normal" onClick={() => void queue.resume(job.id)}>
                      Resume
                    </Button>
                  ) : null}
                  {live ? (
                    <Button variant="normal" onClick={() => void queue.pause(job.id)}>
                      Pause
                    </Button>
                  ) : null}
                  {live || job.status === "paused" ? (
                    <Button variant="normal" onClick={() => void queue.cancel(job.id)}>
                      Cancel
                    </Button>
                  ) : null}
                  {finished ? (
                    <Button variant="normal" onClick={() => void queue.dismiss(job.id)}>
                      Dismiss
                    </Button>
                  ) : null}
                </span>
              </Job>
            );
          })}
        </List>
      ) : null}
    </Sheet>
  );
}

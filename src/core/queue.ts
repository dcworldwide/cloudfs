import { EventEmitter } from "node:events";
import { dedupeKey, TransferJob } from "./store";

export interface QueueEvents {
  change: (jobs: TransferJob[]) => void;
  progress: (job: TransferJob) => void;
}

export interface QueueOptions {
  concurrency: number;
  run: (job: TransferJob, signal: AbortSignal) => Promise<void>;
  /** Called when a job reports a timeout so the caller can step the cap down. */
  onTimeout?: () => void;
}

const QUIET_MS = 20_000;

/**
 * Dedupes identical jobs and runs up to `concurrency` of them.
 * The cap steps down on repeated timeouts and back up after a quiet stretch.
 */
export class TransferQueue {
  private jobs = new Map<string, TransferJob>();
  private keys = new Map<string, string>();
  private running = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private paused = new Set<string>();
  private events = new EventEmitter();
  private cap: number;
  private readonly floor = 1;
  private ceiling: number;
  private timeoutStreak = 0;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: QueueOptions) {
    this.ceiling = Math.max(1, opts.concurrency);
    this.cap = this.ceiling;
  }

  on<K extends keyof QueueEvents>(event: K, listener: QueueEvents[K]): void {
    this.events.on(event, listener);
  }

  setConcurrency(value: number): void {
    this.ceiling = Math.max(1, value);
    if (this.cap > this.ceiling) this.cap = this.ceiling;
    this.pump();
  }

  list(): TransferJob[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  activeCount(): number {
    return this.running.size;
  }

  /** Enqueue, or join the in-flight job with the same kind and locators. */
  enqueue(job: TransferJob): TransferJob {
    const key = dedupeKey(job.kind, job.source, job.dest);
    const existingId = this.keys.get(key);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing && existing.status !== "done" && existing.status !== "error" && existing.status !== "cancelled") {
        return existing;
      }
    }
    this.jobs.set(job.id, job);
    this.keys.set(key, job.id);
    this.emit();
    this.pump();
    return job;
  }

  pause(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.status === "done" || job.status === "cancelled") return;
    this.paused.add(id);
    job.status = "paused";
    this.controllers.get(id)?.abort();
    this.running.delete(id);
    this.emit();
  }

  resume(id: string): void {
    const job = this.jobs.get(id);
    if (!job || !this.paused.has(id)) return;
    this.paused.delete(id);
    job.status = "queued";
    this.emit();
    this.pump();
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      this.dismiss(id);
      return;
    }
    this.paused.delete(id);
    job.status = "cancelled";
    this.controllers.get(id)?.abort();
    this.running.delete(id);
    this.emit();
    this.pump();
  }

  dismiss(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.status === "running" || job.status === "queued" || job.status === "paused") return;
    this.jobs.delete(id);
    for (const [key, value] of this.keys) {
      if (value === id) this.keys.delete(key);
    }
    this.emit();
  }

  update(id: string, patch: Partial<TransferJob>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
    this.events.emit("progress", job);
    this.emit();
  }

  noteTimeout(): void {
    this.timeoutStreak += 1;
    if (this.timeoutStreak >= 2 && this.cap > this.floor) {
      this.cap -= 1;
      this.timeoutStreak = 0;
      this.opts.onTimeout?.();
    }
    this.armQuiet();
  }

  noteSuccess(): void {
    this.timeoutStreak = 0;
    this.armQuiet();
  }

  getCap(): number {
    return this.cap;
  }

  private armQuiet(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      if (this.cap < this.ceiling) this.cap += 1;
      this.quietTimer = null;
      this.pump();
    }, QUIET_MS);
    this.quietTimer.unref?.();
  }

  private pump(): void {
    if (this.running.size >= this.cap) return;
    for (const job of this.jobs.values()) {
      if (this.running.size >= this.cap) return;
      if (job.status !== "queued" || this.paused.has(job.id) || this.running.has(job.id)) continue;
      this.running.add(job.id);
      job.status = "running";
      queueMicrotask(() => void this.start(job));
    }
  }

  private async start(job: TransferJob): Promise<void> {
    if (this.paused.has(job.id) || job.status !== "running") {
      this.running.delete(job.id);
      return;
    }
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.emit();
    try {
      await this.opts.run(job, controller.signal);
      if (this.paused.has(job.id) || job.status !== "running") return;
      job.status = "done";
      job.bytesDone = job.bytesTotal ?? job.bytesDone;
      this.noteSuccess();
    } catch (error) {
      if (controller.signal.aborted || job.status !== "running" || this.paused.has(job.id)) return;
      const message = error instanceof Error ? error.message : String(error);
      job.status = "error";
      job.error = message;
      if (/timeout|timed out|ECONNRESET|SlowDown/i.test(message)) this.noteTimeout();
    } finally {
      this.running.delete(job.id);
      this.controllers.delete(job.id);
      this.emit();
      this.pump();
    }
  }

  private emit(): void {
    this.events.emit("change", this.list());
  }
}

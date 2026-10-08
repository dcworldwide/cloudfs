import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LocalAdapter } from "../adapters/local";
import { loadJson, saveJson, transfersPathFor } from "./config";
import { AdapterRegistry } from "./registry";
import { TransferQueue } from "./queue";
import { Account, Locator, TransferJob } from "./store";

export interface TransferState {
  jobs: TransferJob[];
}

const LOCAL: Account = { id: "local", provider: "s3", displayName: "This Computer", settings: {} };

export interface CoordinatorOptions {
  dir: string;
  registry: AdapterRegistry;
  local: LocalAdapter;
  accounts: () => Account[];
  concurrency: number;
}

export class TransferCoordinator {
  readonly queue: TransferQueue;
  private file: string;

  constructor(private opts: CoordinatorOptions) {
    this.file = transfersPathFor(opts.dir);
    this.queue = new TransferQueue({
      concurrency: opts.concurrency,
      run: (job, signal) => this.run(job, signal),
    });
    this.queue.on("change", () => {
      void this.persist();
    });
  }

  async restore(): Promise<void> {
    const state = await loadJson<TransferState>(this.file, { jobs: [] });
    for (const job of state.jobs) {
      if (job.status === "done" || job.status === "cancelled") continue;
      job.status = "queued";
      this.queue.enqueue(job);
    }
  }

  account(id: string): Account {
    const found = this.opts.accounts().find((item) => item.id === id);
    if (!found) throw new Error("That store is no longer saved.");
    return found;
  }

  enqueue(job: TransferJob): TransferJob {
    return this.queue.enqueue(job);
  }

  private async persist(): Promise<void> {
    const jobs = this.queue.list().filter((job) => job.status !== "done" && job.status !== "cancelled");
    await saveJson(this.file, { jobs });
  }

  private async run(job: TransferJob, signal: AbortSignal): Promise<void> {
    if (job.kind === "delete") {
      await this.remove(job);
      return;
    }
    if (job.kind === "move" && job.source.provider === "local" && job.dest.provider === "local") {
      try {
        await this.opts.local.rename(job.source.key, job.dest.key);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      }
    }
    if (
      (job.kind === "copy" || job.kind === "move") &&
      job.source.provider === job.dest.provider &&
      job.source.provider === "s3" &&
      job.source.storeId === job.dest.storeId
    ) {
      const adapter = this.opts.registry.get("s3");
      await adapter.copy(this.account(job.source.storeId), {
        from: job.source,
        to: job.dest,
        size: job.bytesTotal,
        signal,
        onProgress: (bytesDone, bytesTotal) => this.queue.update(job.id, { bytesDone, bytesTotal }),
      });
      if (job.kind === "move") await this.remove(job);
      return;
    }
    await this.stream(job, signal);
    if (job.kind === "move") await this.remove(job);
  }

  private async remove(job: TransferJob): Promise<void> {
    if (job.source.provider === "local") {
      await this.opts.local.remove(LOCAL, "", [job.source.key]);
      return;
    }
    const adapter = this.opts.registry.get(job.source.provider);
    await adapter.remove(this.account(job.source.storeId), job.source.container, [job.source.key]);
  }

  private async stream(job: TransferJob, signal: AbortSignal): Promise<void> {
    const source = await this.openSource(job, signal);
    await this.writeDest(job, source, signal);
  }

  private async openSource(job: TransferJob, signal: AbortSignal): Promise<Readable> {
    if (job.source.provider === "local") {
      const info = await stat(job.source.key);
      this.queue.update(job.id, { bytesTotal: info.size });
      const start = job.kind === "download" ? undefined : job.resume?.bytesDone;
      return this.opts.local.get(LOCAL, "", job.source.key, { range: start ? { start } : undefined, signal });
    }
    const adapter = this.opts.registry.get(job.source.provider);
    const start = job.dest.provider === "local" ? job.resume?.bytesDone : undefined;
    return adapter.get(this.account(job.source.storeId), job.source.container, job.source.key, {
      range: start ? { start } : undefined,
      signal,
    });
  }

  private async writeDest(job: TransferJob, source: Readable, signal: AbortSignal): Promise<void> {
    const progress = (bytesDone: number, bytesTotal?: number) => {
      this.queue.update(job.id, { bytesDone, bytesTotal: bytesTotal ?? job.bytesTotal });
    };
    if (job.dest.provider === "local") {
      await this.opts.local.put(LOCAL, "", job.dest.key, source, {
        size: job.bytesTotal,
        signal,
        onProgress: progress,
        resume: job.resume,
      });
      return;
    }
    const adapter = this.opts.registry.get(job.dest.provider);
    await adapter.put(this.account(job.dest.storeId), job.dest.container, job.dest.key, source, {
      size: job.bytesTotal,
      signal,
      onProgress: (bytesDone, bytesTotal, resume) => {
        if (resume) job.resume = resume;
        progress(bytesDone, bytesTotal);
      },
      resume: job.resume,
    });
  }
}

export function jobName(locator: Locator): string {
  return path.basename(locator.key.replace(/\/$/, "")) || locator.container || "item";
}

export async function streamToFile(stream: Readable, file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await pipeline(stream, createWriteStream(file));
}

export function fileStream(file: string, start?: number): Readable {
  return createReadStream(file, { start });
}

/** Counts bytes as they pass, used by tests and by adapters that stream. */
export function progressTap(onBytes: (n: number) => void): PassThrough {
  const tap = new PassThrough();
  tap.on("data", (chunk: Buffer) => onBytes(chunk.length));
  return tap;
}

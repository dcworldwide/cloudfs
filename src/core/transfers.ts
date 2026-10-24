import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LocalAdapter } from "../adapters/local";
import { loadJson, saveJson, transfersPathFor } from "./config";
import { AdapterRegistry } from "./registry";
import { TransferQueue } from "./queue";
import { selectTransferStrategy } from "./transfer-strategy";
import { Account, EntryStat, Locator, ProviderId, TransferJob } from "./store";

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
  /** Directory for the rare spool file. Defaults to the OS temp directory. */
  tempDir?: string;
  /** Called with the spool path when a transfer has to touch local disk. */
  onTempFile?: (file: string) => void;
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
    try {
      await saveJson(this.file, { jobs });
    } catch (error) {
      // The queue emits after a test directory has already been removed.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private canStream(provider: ProviderId): boolean {
    if (provider === "local") return true;
    return this.opts.registry.get(provider).streaming !== false;
  }

  private async run(job: TransferJob, signal: AbortSignal): Promise<void> {
    if (job.kind === "delete") {
      await this.remove(job);
      return;
    }
    const strategy = selectTransferStrategy({
      kind: job.kind,
      source: job.source,
      dest: job.dest,
      size: job.bytesTotal,
      sourceStreams: this.canStream(job.source.provider),
      destStreams: this.canStream(job.dest.provider),
    });
    if (strategy.kind === "local-rename") {
      await this.renameLocal(job, signal);
      return;
    }
    if (strategy.kind === "ftp-rename") {
      await this.renameFtp(job, signal);
      return;
    }
    if (strategy.kind === "s3-server-copy") {
      await this.copyOnS3(job, signal, strategy.deleteSource);
      return;
    }
    const write =
      strategy.kind === "temp-file"
        ? () => this.transferSpool(job, signal)
        : () => this.transferStream(job, signal);
    await this.finishTransfer(job, signal, strategy.deleteSource, write);
  }

  /** Rename on one volume. A cross-device move copies, checks the copy, then deletes. */
  private async renameLocal(job: TransferJob, signal: AbortSignal): Promise<void> {
    const expected = await this.lookupSize(job.source, job.bytesTotal);
    if (expected != null) this.queue.update(job.id, { bytesTotal: expected });
    try {
      if (signal.aborted) throw new Error("aborted");
      await this.opts.local.rename(job.source.key, job.dest.key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await this.finishTransfer(job, signal, true, () => this.transferStream(job, signal));
      return;
    }
    await this.verifyDestination(job, expected);
  }

  /** RNFR/RNTO already removes the source. A failed rename leaves it in place. */
  private async renameFtp(job: TransferJob, signal: AbortSignal): Promise<void> {
    const expected = await this.lookupSize(job.source, job.bytesTotal);
    if (expected != null) this.queue.update(job.id, { bytesTotal: expected });
    if (signal.aborted) throw new Error("aborted");
    const adapter = this.opts.registry.get("ftp");
    await adapter.copy(this.account(job.source.storeId), {
      from: job.source,
      to: job.dest,
      size: expected,
      move: true,
      signal,
      onProgress: (bytesDone, bytesTotal) => this.queue.update(job.id, { bytesDone, bytesTotal: bytesTotal ?? expected }),
    });
    if (signal.aborted) throw new Error("aborted");
    await this.verifyDestination(job, expected);
  }

  /** Server-side copy. The source is deleted only after HeadObject confirms the copy. */
  private async copyOnS3(job: TransferJob, signal: AbortSignal, deleteSource: boolean): Promise<void> {
    const adapter = this.opts.registry.get("s3");
    await this.finishTransfer(job, signal, deleteSource, async () => {
      await adapter.copy(this.account(job.source.storeId), {
        from: job.source,
        to: job.dest,
        size: job.bytesTotal,
        signal,
        onProgress: (bytesDone, bytesTotal) =>
          this.queue.update(job.id, { bytesDone, bytesTotal: bytesTotal ?? job.bytesTotal }),
      });
    });
  }

  /**
   * Write, confirm the destination, then delete the source for a move.
   * A failure before that confirmation leaves the source untouched.
   */
  private async finishTransfer(
    job: TransferJob,
    signal: AbortSignal,
    deleteSource: boolean,
    write: () => Promise<void>,
  ): Promise<void> {
    const expected = await this.lookupSize(job.source, job.bytesTotal);
    if (expected != null) this.queue.update(job.id, { bytesTotal: expected });
    try {
      if (signal.aborted) throw new Error("aborted");
      await write();
      if (signal.aborted) throw new Error("aborted");
      await this.verifyDestination(job, expected);
    } catch (error) {
      await this.abortIncomplete(job);
      throw error;
    }
    if (!deleteSource) return;
    if (signal.aborted) throw new Error("aborted");
    await this.remove(job);
  }

  private async transferStream(job: TransferJob, signal: AbortSignal): Promise<void> {
    const source = await this.openSource(job, signal);
    await this.writeDest(job, source, signal);
  }

  /** Used only when an adapter cannot accept a stream. The spool is removed on every exit. */
  private async transferSpool(job: TransferJob, signal: AbortSignal): Promise<void> {
    const dir = this.opts.tempDir ?? path.join(os.tmpdir(), "cloudfs-transfers");
    await mkdir(dir, { recursive: true });
    const safeId = job.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const file = path.join(dir, `${safeId}-${randomBytes(4).toString("hex")}.part`);
    try {
      const source = await this.openSource(job, signal);
      await streamToFile(source, file, signal);
      this.opts.onTempFile?.(file);
      if (signal.aborted) throw new Error("aborted");
      await this.writeDest(job, createReadStream(file), signal);
    } finally {
      await rm(file, { force: true });
    }
  }

  private async lookupSize(locator: Locator, known?: number): Promise<number | undefined> {
    if (known != null) return known;
    try {
      const info = await this.statLocator(locator);
      return info.size;
    } catch {
      return undefined;
    }
  }

  private async verifyDestination(job: TransferJob, expected?: number): Promise<void> {
    const info = await this.statLocator(job.dest);
    if (!info.exists || info.kind === "folder") {
      throw new Error("Destination write could not be verified.");
    }
    if (expected != null && info.size != null && info.size !== expected) {
      throw new Error(`Destination size ${info.size} does not match source size ${expected}.`);
    }
  }

  private async statLocator(locator: Locator): Promise<EntryStat> {
    if (locator.provider === "local") return this.opts.local.stat(LOCAL, "", locator.key);
    const adapter = this.opts.registry.get(locator.provider);
    return adapter.stat(this.account(locator.storeId), locator.container, locator.key);
  }

  /** Drop an unfinished multipart upload. A completed object is left alone so a retry can overwrite it. */
  private async abortIncomplete(job: TransferJob): Promise<void> {
    const uploadId = job.resume?.uploadId;
    if (!uploadId || job.dest.provider === "local") return;
    try {
      await this.opts.registry.get(job.dest.provider).abortMultipart?.(
        this.account(job.dest.storeId),
        job.dest.container,
        job.dest.key,
        uploadId,
      );
    } catch {
      // The source has not been removed.
    }
  }

  private async remove(job: TransferJob): Promise<void> {
    if (job.source.provider === "local") {
      await this.opts.local.remove(LOCAL, "", [job.source.key]);
      return;
    }
    const adapter = this.opts.registry.get(job.source.provider);
    await adapter.remove(this.account(job.source.storeId), job.source.container, [job.source.key]);
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

export async function streamToFile(stream: Readable, file: string, signal?: AbortSignal): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await pipeline(stream, createWriteStream(file), { signal });
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

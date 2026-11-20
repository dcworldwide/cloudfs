import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDriveList, LocalAdapter } from "../adapters/local";
import { loadJson, saveJson, transfersPathFor } from "./config";
import { folderContains, walkFolder, type WalkNode } from "./folder-walk";
import { asFolderKey, capabilities, destinationKey, parentPrefix } from "./paths";
import { AdapterRegistry } from "./registry";
import { TransferQueue } from "./queue";
import { selectTransferStrategy } from "./transfer-strategy";
import { Account, Entry, EntryStat, JobKind, Locator, ProviderId, TransferJob } from "./store";

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
  /** Byte offset for the file currently being copied inside a folder job. */
  private folderTotals = new Map<string, { offset: number; total: number }>();

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
      await this.deleteEntry(job);
      return;
    }
    if (await this.isFolderJob(job)) {
      await this.transferFolder(job, signal);
      return;
    }
    await this.transferFile(job, signal);
  }

  /** One file. Folder copies call this once per nested file and delete the source themselves. */
  private async transferFile(job: TransferJob, signal: AbortSignal): Promise<void> {
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
    if (expected != null) this.noteProgress(job, { bytesTotal: expected });
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
      onProgress: (bytesDone, bytesTotal) => this.noteProgress(job, { bytesDone, bytesTotal: bytesTotal ?? expected }),
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
          this.noteProgress(job, { bytesDone, bytesTotal: bytesTotal ?? job.bytesTotal }),
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
    if (expected != null) this.noteProgress(job, { bytesTotal: expected });
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

  /**
   * Delete one queue item. A folder removes the directory and every child.
   * A file removes that key only, so a prefix that shares the file's name stays.
   */
  private async deleteEntry(job: TransferJob): Promise<void> {
    if (await this.isFolderJob(job)) {
      await this.deleteFolder(job.source);
      return;
    }
    await this.remove(job);
  }

  /**
   * Local `rm` and FTP `removeDir` delete a tree themselves.
   * Every other store uses the same listing walk as a folder copy, then deletes those keys.
   */
  private async deleteFolder(root: Locator): Promise<void> {
    const recursive = root.provider === "local" || Boolean(this.opts.registry.get(root.provider).removeDir);
    await this.removeSourceTree(root, recursive ? [] : await this.listTree(root));
  }

  private listTree(root: Locator): Promise<WalkNode[]> {
    return walkFolder(
      root,
      (locator) => this.listLocator(locator),
      (locator) => this.folderIdentity(locator),
    );
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
      this.noteProgress(job, { bytesTotal: info.size });
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
      this.noteProgress(job, { bytesDone, bytesTotal: bytesTotal ?? job.bytesTotal });
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

  /**
   * Copy every file under a folder with the single-file path, then delete the
   * source only when this job is a move and every file has been verified.
   * A same-disk local move and a same-server FTP move rename the directory.
   */
  private async transferFolder(job: TransferJob, signal: AbortSignal): Promise<void> {
    if (folderContains(job.source, job.dest)) throw new Error("Cannot transfer a folder into itself.");
    await this.assertFolder(job.source);
    if (signal.aborted) throw new Error("aborted");
    if (job.kind === "move" && job.source.provider === "local" && job.dest.provider === "local") {
      await this.moveLocalFolder(job, signal);
      return;
    }
    if (
      job.kind === "move" &&
      job.source.provider === "ftp" &&
      job.dest.provider === "ftp" &&
      job.source.storeId === job.dest.storeId
    ) {
      await this.moveFtpFolder(job, signal);
      return;
    }
    await this.copyFolderFiles(job, signal, job.kind === "move");
  }

  private async moveLocalFolder(job: TransferJob, signal: AbortSignal): Promise<void> {
    await this.ensureParent(job.dest);
    try {
      if (signal.aborted) throw new Error("aborted");
      await this.opts.local.rename(job.source.key, job.dest.key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await this.copyFolderFiles(job, signal, true);
      return;
    }
    await this.verifyFolder(job.dest);
  }

  private async moveFtpFolder(job: TransferJob, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error("aborted");
    await this.ensureParent(job.dest);
    const adapter = this.opts.registry.get("ftp");
    await adapter.copy(this.account(job.source.storeId), {
      from: job.source,
      to: job.dest,
      move: true,
      signal,
    });
    if (signal.aborted) throw new Error("aborted");
    await this.verifyFolder(job.dest);
  }

  private async copyFolderFiles(job: TransferJob, signal: AbortSignal, removeSource: boolean): Promise<void> {
    const nodes = await this.listTree(job.source);
    const files = nodes.filter((node) => node.kind === "file");
    for (const file of files) {
      if (file.size != null) continue;
      const info = await this.statLocator(file.locator);
      file.size = info.size ?? 0;
    }
    const total = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
    const scope = { offset: 0, total };
    this.folderTotals.set(job.id, scope);
    this.queue.update(job.id, { bytesDone: 0, bytesTotal: total });
    try {
      await this.mkdirLocator(job.dest);
      for (const folder of nodes) {
        if (folder.kind !== "folder") continue;
        if (signal.aborted) throw new Error("aborted");
        await this.mkdirLocator({ ...job.dest, key: destinationKey(job.dest.provider, job.dest.key, folder.relative) });
      }
      let offset = 0;
      for (const file of files) {
        if (signal.aborted) throw new Error("aborted");
        scope.offset = offset;
        try {
          await this.transferFile(this.fileJob(job, file), signal);
        } catch (error) {
          if (signal.aborted) throw new Error("aborted");
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`${file.relative}: ${message}`);
        }
        offset += file.size ?? 0;
        scope.offset = offset;
        this.queue.update(job.id, { bytesDone: offset, bytesTotal: total });
      }
      if (signal.aborted) throw new Error("aborted");
      await this.verifyFolder(job.dest);
    } finally {
      this.folderTotals.delete(job.id);
    }
    if (!removeSource) return;
    if (signal.aborted) throw new Error("aborted");
    await this.removeSourceTree(job.source, nodes);
  }

  private fileJob(job: TransferJob, file: WalkNode): TransferJob {
    return {
      ...job,
      kind: fileKind(job),
      sourceKind: "file",
      source: file.locator,
      dest: { ...job.dest, key: destinationKey(job.dest.provider, job.dest.key, file.relative) },
      name: file.relative,
      bytesTotal: file.size,
      bytesDone: 0,
      resume: undefined,
      error: undefined,
    };
  }

  private async isFolderJob(job: TransferJob): Promise<boolean> {
    if (job.sourceKind === "folder") return true;
    if (job.sourceKind === "file") return false;
    const info = await this.statLocator(job.source);
    if (info.kind === "folder") return true;
    if (info.exists) return false;
    if (!capabilities(job.source.provider).slashFolders || !job.source.key.endsWith("/")) return false;
    const children = await this.listLocator(job.source);
    return children.length > 0;
  }

  private async assertFolder(locator: Locator): Promise<void> {
    const info = await this.statLocator(locator);
    if (info.kind === "folder") return;
    if (info.exists) throw new Error("Source is a file, not a folder.");
    if (capabilities(locator.provider).slashFolders) {
      const key = asFolderKey(locator.provider, locator.key);
      if (key !== locator.key) {
        const marked = await this.statLocator({ ...locator, key });
        if (marked.kind === "folder") return;
      }
      const children = await this.listLocator({ ...locator, key });
      if (children.length > 0) return;
    }
    throw new Error("Source folder was not found.");
  }

  private async verifyFolder(locator: Locator): Promise<void> {
    const key = asFolderKey(locator.provider, locator.key);
    const info = await this.statLocator({ ...locator, key });
    if (info.exists && info.kind === "folder") return;
    if (capabilities(locator.provider).slashFolders) {
      const children = await this.listLocator({ ...locator, key });
      if (children.length > 0) return;
    }
    throw new Error("Destination folder could not be verified.");
  }

  private async listLocator(locator: Locator): Promise<Entry[]> {
    const opts = { includeHidden: true };
    if (locator.provider === "local") {
      if (isDriveList(locator.key)) return this.opts.local.listContainers();
      return this.opts.local.list(LOCAL, "", locator.key, opts);
    }
    const account = this.account(locator.storeId);
    const adapter = this.opts.registry.get(locator.provider);
    if (capabilities(locator.provider).containers && !locator.container) return adapter.listContainers(account);
    return adapter.list(account, locator.container, locator.key, opts);
  }

  private async mkdirLocator(locator: Locator): Promise<void> {
    if (!locator.key) return;
    if (locator.provider === "local") {
      await this.opts.local.mkdir(LOCAL, "", locator.key);
      return;
    }
    await this.opts.registry
      .get(locator.provider)
      .mkdir(this.account(locator.storeId), locator.container, asFolderKey(locator.provider, locator.key));
  }

  private async ensureParent(locator: Locator): Promise<void> {
    const parent = locator.provider === "local" ? path.dirname(locator.key) : parentPrefix(locator.provider, locator.key);
    if (!parent || parent === "." || parent === locator.key) return;
    await this.mkdirLocator({ ...locator, key: parent });
  }

  private async folderIdentity(locator: Locator): Promise<string> {
    if (locator.provider !== "local") return [locator.provider, locator.storeId, locator.container, locator.key].join("|");
    const info = await stat(locator.key);
    return `local:${info.dev}:${info.ino}`;
  }

  /** Drop the source tree after a move. Local removes the directory. S3 deletes every key. */
  private async removeSourceTree(root: Locator, nodes: WalkNode[]): Promise<void> {
    if (root.provider === "local") {
      await this.opts.local.remove(LOCAL, "", [root.key]);
      return;
    }
    const adapter = this.opts.registry.get(root.provider);
    const account = this.account(root.storeId);
    if (adapter.removeDir) {
      await adapter.removeDir(account, root.container, root.key);
      return;
    }
    const keys = new Set<string>();
    const rootKey = asFolderKey(root.provider, root.key);
    if (rootKey) keys.add(rootKey);
    for (const node of nodes) {
      const key = node.kind === "folder" ? asFolderKey(node.locator.provider, node.locator.key) : node.locator.key;
      if (key) keys.add(key);
    }
    if (keys.size) await adapter.remove(account, root.container, [...keys]);
  }

  /** Keep a folder total in place while each nested file reports its own bytes. */
  private noteProgress(job: TransferJob, patch: { bytesDone?: number; bytesTotal?: number }): void {
    const scope = this.folderTotals.get(job.id);
    if (!scope) {
      this.queue.update(job.id, patch);
      return;
    }
    this.queue.update(job.id, {
      ...(patch.bytesDone == null ? {} : { bytesDone: scope.offset + patch.bytesDone }),
      bytesTotal: scope.total,
    });
  }
}

function fileKind(job: TransferJob): JobKind {
  if (job.source.provider === "local" && job.dest.provider !== "local") return "upload";
  if (job.source.provider !== "local" && job.dest.provider === "local") return "download";
  return "copy";
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

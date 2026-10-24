import { S3_COPY_MAX_SINGLE, type JobKind, type Locator } from "./store";

/**
 * How a copy or move should move bytes.
 *
 * - local-rename: same filesystem rename. The caller falls back to copy+delete on EXDEV.
 * - local-copy: read and write on this computer, no third file.
 * - s3-server-copy: CopyObject, or multipart copy above 5 GiB. No local disk.
 * - ftp-rename: RNFR/RNTO on one FTP server. The source is already gone after success.
 * - stream: pipe the source stream into the destination. No full-file temp.
 * - temp-file: spool only when a side cannot stream, then delete the spool.
 */
export type TransferStrategy =
  | { kind: "local-rename" }
  | { kind: "local-copy"; deleteSource: boolean }
  | { kind: "s3-server-copy"; multipart: boolean; deleteSource: boolean }
  | { kind: "ftp-rename" }
  | { kind: "stream"; deleteSource: boolean }
  | { kind: "temp-file"; deleteSource: boolean };

export interface StrategyInput {
  kind: JobKind;
  source: Locator;
  dest: Locator;
  size?: number;
  sourceStreams: boolean;
  destStreams: boolean;
}

function deleteSource(kind: JobKind): boolean {
  return kind === "move";
}

/** Pick the cheapest safe path for this pair. Delete-after-write is only for moves. */
export function selectTransferStrategy(input: StrategyInput): TransferStrategy {
  const removing = deleteSource(input.kind);
  const { source, dest } = input;
  if (source.provider === "local" && dest.provider === "local") {
    if (removing) return { kind: "local-rename" };
    return { kind: "local-copy", deleteSource: false };
  }
  if (source.provider === "s3" && dest.provider === "s3" && source.storeId === dest.storeId) {
    return {
      kind: "s3-server-copy",
      multipart: (input.size ?? 0) > S3_COPY_MAX_SINGLE,
      deleteSource: removing,
    };
  }
  if (source.provider === "ftp" && dest.provider === "ftp" && source.storeId === dest.storeId && removing) {
    return { kind: "ftp-rename" };
  }
  if (!input.sourceStreams || !input.destStreams) {
    return { kind: "temp-file", deleteSource: removing };
  }
  return { kind: "stream", deleteSource: removing };
}

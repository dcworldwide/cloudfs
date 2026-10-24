import { describe, expect, it } from "vitest";
import { S3_COPY_MAX_SINGLE, type JobKind, type Locator, type ProviderId } from "./store";
import { selectTransferStrategy, type TransferStrategy } from "./transfer-strategy";

function locator(provider: ProviderId, storeId: string, key = "a.txt"): Locator {
  return { provider, storeId, container: provider === "s3" ? "box" : "", key };
}

function strategy(
  kind: JobKind,
  source: Locator,
  dest: Locator,
  extra: { size?: number; sourceStreams?: boolean; destStreams?: boolean } = {},
): TransferStrategy {
  return selectTransferStrategy({
    kind,
    source,
    dest,
    size: extra.size,
    sourceStreams: extra.sourceStreams ?? true,
    destStreams: extra.destStreams ?? true,
  });
}

const local = locator("local", "local", "/tmp/a.txt");
const localDest = locator("local", "local", "/tmp/b.txt");
const s3 = locator("s3", "s3-a");
const s3other = locator("s3", "s3-b", "b.txt");
const ftp = locator("ftp", "ftp-a");
const ftpOther = locator("ftp", "ftp-b", "b.txt");

describe("selectTransferStrategy", () => {
  it("renames a local move and copies a local copy", () => {
    expect(strategy("move", local, localDest)).toEqual({ kind: "local-rename" });
    expect(strategy("copy", local, localDest)).toEqual({ kind: "local-copy", deleteSource: false });
  });

  it("uses server-side copy for the same S3 account and streams between accounts", () => {
    expect(strategy("copy", s3, { ...s3, key: "b.txt" })).toEqual({
      kind: "s3-server-copy",
      multipart: false,
      deleteSource: false,
    });
    expect(strategy("move", s3, { ...s3, key: "b.txt" }, { size: S3_COPY_MAX_SINGLE + 1 })).toEqual({
      kind: "s3-server-copy",
      multipart: true,
      deleteSource: true,
    });
    expect(strategy("copy", s3, s3other).kind).toBe("stream");
  });

  it("renames a same-server FTP move and streams a same-server copy", () => {
    expect(strategy("move", ftp, { ...ftp, key: "b.txt" })).toEqual({ kind: "ftp-rename" });
    expect(strategy("copy", ftp, { ...ftp, key: "b.txt" })).toEqual({ kind: "stream", deleteSource: false });
    expect(strategy("move", ftp, ftpOther)).toEqual({ kind: "stream", deleteSource: true });
  });

  it("streams every cross-provider pair and deletes the source only for a move", () => {
    const pairs: [Locator, Locator][] = [
      [local, s3],
      [local, ftp],
      [s3, local],
      [s3, ftp],
      [ftp, local],
      [ftp, s3],
    ];
    for (const [source, dest] of pairs) {
      expect(strategy("upload", source, dest)).toEqual({ kind: "stream", deleteSource: false });
      expect(strategy("move", source, dest)).toEqual({ kind: "stream", deleteSource: true });
    }
  });

  it("spools to a temp file only when a side cannot stream", () => {
    expect(strategy("move", s3, ftp, { destStreams: false })).toEqual({ kind: "temp-file", deleteSource: true });
    expect(strategy("copy", ftp, s3, { sourceStreams: false })).toEqual({ kind: "temp-file", deleteSource: false });
    expect(strategy("copy", s3, ftp).kind).toBe("stream");
  });
});

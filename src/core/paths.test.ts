import { describe, expect, it } from "vitest";
import { folderKey, joinKey, parentPrefix } from "./paths";

describe("path policy", () => {
  it("keeps a trailing slash on S3 folders and omits it on FTP", () => {
    expect(joinKey("s3", "production/", "notes.txt")).toBe("production/notes.txt");
    expect(joinKey("s3", "", "notes.txt")).toBe("notes.txt");
    expect(folderKey("s3", "", "production")).toBe("production/");
    expect(parentPrefix("s3", "production/notes.txt")).toBe("production/");
    expect(joinKey("ftp", "/incoming", "notes.txt")).toBe("/incoming/notes.txt");
    expect(folderKey("ftp", "/incoming", "archive")).toBe("/incoming/archive");
    expect(parentPrefix("ftp", "/incoming/notes.txt")).toBe("/incoming");
  });

  it("joins local paths without a double slash", () => {
    expect(joinKey("local", "/Users/preview", "notes.txt")).toBe("/Users/preview/notes.txt");
    expect(parentPrefix("local", "/Users/preview/notes.txt")).toBe("/Users/preview");
  });
});

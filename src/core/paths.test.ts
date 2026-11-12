import { describe, expect, it } from "vitest";
import { folderKey, joinKey, parentPrefix, parsePathText, pathSegments, pathText } from "./paths";

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
    expect(joinKey("local", "/Users/preview", "notes.txt", "darwin")).toBe("/Users/preview/notes.txt");
    expect(parentPrefix("local", "/Users/preview/notes.txt", "darwin")).toBe("/Users/preview");
  });

  it("treats each Windows drive as a parent the location bar can open", () => {
    expect(joinKey("local", "C:\\", "Windows", "win32")).toBe("C:\\Windows");
    expect(parentPrefix("local", "C:\\Users\\notes.txt", "win32")).toBe("C:\\Users");
    expect(parentPrefix("local", "C:\\", "win32")).toBe("");
    expect(pathSegments("local", "C:\\Users\\Public", "", "win32").map((part) => part.label)).toEqual([
      "This PC",
      "C:",
      "Users",
      "Public",
    ]);
    expect(pathText("local", "C:\\Users", "", "win32")).toBe("C:\\Users");
    expect(parsePathText("local", "D:/Games", "win32")).toEqual({ container: "", prefix: "D:\\Games" });
    expect(parsePathText("local", "", "win32")).toEqual({ container: "", prefix: "" });
  });

  it("keeps an edited S3 location on the same bucket", () => {
    expect(pathText("s3", "2024/", "photos")).toBe("photos/2024/");
    expect(parsePathText("s3", "photos/2024/trips")).toEqual({ container: "photos", prefix: "2024/trips/" });
    expect(pathSegments("s3", "2024/", "photos").map((part) => part.label)).toEqual(["Buckets", "photos", "2024"]);
  });
});

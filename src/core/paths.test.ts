import { describe, expect, it } from "vitest";
import {
  asFolderKey,
  destinationKey,
  folderKey,
  joinKey,
  parentPrefix,
  parentSegment,
  parsePathText,
  pathSegments,
  pathText,
  sameParsedLocation,
} from "./paths";

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

  it("joins a Windows drop with no platform and no node:path", () => {
    expect(joinKey("local", "C:\\Users\\Public", "setup.zip")).toBe("C:\\Users\\Public\\setup.zip");
    expect(joinKey("local", "C:/Users/Public", "setup.zip")).toBe("C:\\Users\\Public\\setup.zip");
    expect(parentPrefix("local", "C:\\Users\\Public\\setup.zip")).toBe("C:\\Users\\Public");
    expect(parentPrefix("local", "C:\\")).toBe("");
  });

  it("joins local paths without a double slash", () => {
    expect(joinKey("local", "/Users/preview", "notes.txt", "darwin")).toBe("/Users/preview/notes.txt");
    expect(parentPrefix("local", "/Users/preview/notes.txt", "darwin")).toBe("/Users/preview");
  });

  it("treats each Windows drive as a parent the location bar can open", () => {
    expect(joinKey("local", "C:\\", "Windows")).toBe("C:\\Windows");
    expect(parentPrefix("local", "C:\\Users\\notes.txt")).toBe("C:\\Users");
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
    expect(parsePathText("local", "C:\\projects\\agsadmin\\", "win32")).toEqual({
      container: "",
      prefix: "C:\\projects\\agsadmin",
    });
    expect(parsePathText("local", "C:\\", "win32")).toEqual({ container: "", prefix: "C:\\" });
    expect(parsePathText("local", "C:", "win32")).toEqual({ container: "", prefix: "C:\\" });
    expect(sameParsedLocation("local", { container: "", prefix: "C:\\projects\\agsadmin" }, "C:\\projects\\agsadmin\\", "win32")).toBe(
      true,
    );
  });

  it("joins a folder copy onto S3, FTP, and a Windows drive", () => {
    expect(destinationKey("s3", "inbox/docs", "src/main.txt")).toBe("inbox/docs/src/main.txt");
    expect(destinationKey("s3", "inbox/docs/", "src/main.txt")).toBe("inbox/docs/src/main.txt");
    expect(destinationKey("ftp", "/incoming/docs", "src/main.txt")).toBe("/incoming/docs/src/main.txt");
    expect(destinationKey("local", "C:\\Users\\Public\\docs", "src/main.txt")).toBe("C:\\Users\\Public\\docs\\src\\main.txt");
    expect(destinationKey("s3", "inbox/docs", "../escape.txt")).toBe("inbox/docs/escape.txt");
    expect(asFolderKey("s3", "inbox/docs")).toBe("inbox/docs/");
    expect(asFolderKey("s3", "inbox/docs/")).toBe("inbox/docs/");
    expect(asFolderKey("ftp", "/incoming/docs")).toBe("/incoming/docs");
    expect(asFolderKey("local", "C:\\")).toBe("C:\\");
  });

  it("keeps an edited S3 location on the same bucket", () => {
    expect(pathText("s3", "2024/", "photos")).toBe("photos/2024/");
    expect(parsePathText("s3", "photos/2024/trips")).toEqual({ container: "photos", prefix: "2024/trips/" });
    expect(parsePathText("s3", "photos/2024/")).toEqual({ container: "photos", prefix: "2024/" });
    expect(parsePathText("ftp", "/incoming/drop/")).toEqual({ container: "", prefix: "/incoming/drop" });
    expect(parsePathText("ftp", "/")).toEqual({ container: "", prefix: "" });
    expect(sameParsedLocation("s3", { container: "photos", prefix: "2024/" }, "photos/2024")).toBe(true);
    expect(sameParsedLocation("ftp", { container: "", prefix: "/incoming" }, "/incoming/")).toBe(true);
    expect(sameParsedLocation("s3", { container: "photos", prefix: "2024/" }, "other/2024")).toBe(false);
    expect(pathSegments("s3", "2024/", "photos").map((part) => part.label)).toEqual(["Buckets", "photos", "2024"]);
  });

  it("steps to the parent breadcrumb and stops at the root", () => {
    const bucket = pathSegments("s3", "file-transfer/more/", "dnrmmrrd-k8s-poc");
    expect(parentSegment(bucket)).toMatchObject({ label: "file-transfer", prefix: "file-transfer/", container: "dnrmmrrd-k8s-poc" });
    expect(parentSegment(pathSegments("s3", "", "photos"))).toMatchObject({ label: "Buckets", prefix: "", container: "" });
    expect(parentSegment(pathSegments("s3", "", ""))).toBeNull();

    const ftp = pathSegments("ftp", "/incoming/docs", "");
    expect(ftp.map((part) => part.label)).toEqual(["Root", "incoming", "docs"]);
    expect(parentSegment(ftp)).toEqual(ftp[1]);
    expect(parentSegment(pathSegments("ftp", "", ""))).toBeNull();

    expect(parentSegment(pathSegments("local", "/", "", "linux"))).toBeNull();
    expect(pathSegments("local", "/Users/preview", "", "linux").map((part) => part.prefix)).toEqual(["/", "/Users", "/Users/preview"]);
    expect(pathSegments("local", "relative/docs", "", "linux").map((part) => part.prefix)).toEqual(["", "relative", "relative/docs"]);
    expect(parentSegment(pathSegments("local", "/Users/preview", "", "linux"))).toMatchObject({ label: "Users", prefix: "/Users" });
    expect(parentSegment(pathSegments("local", "C:\\", "", "win32"))).toMatchObject({ label: "This PC", prefix: "" });
    expect(parentSegment(pathSegments("local", "C:\\Users\\Public", "", "win32"))).toMatchObject({ label: "Users", prefix: "C:\\Users" });
  });
});

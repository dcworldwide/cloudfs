import { describe, expect, it } from "vitest";
import { applicationMenuTemplate, hidesWindowMenuBar, menuRoles } from "./app-menu";

const shortcuts = ["copy", "paste", "selectAll", "reload", "toggleDevTools", "cut", "undo"];

describe("application menu", () => {
  it("keeps edit and view shortcuts while the Windows menu bar stays hidden", () => {
    const template = applicationMenuTemplate("win32", "Cloudfs");
    expect(hidesWindowMenuBar("win32")).toBe(true);
    expect(template.map((item) => item.label)).toEqual(["File", "Edit", "View", "Window"]);
    const roles = menuRoles(template);
    for (const role of shortcuts) expect(roles).toContain(role);
    expect(roles).toContain("quit");
    expect(roles).toContain("close");
  });

  it("hides the Linux menu bar the same way and keeps a normal macOS menu", () => {
    expect(hidesWindowMenuBar("linux")).toBe(true);
    expect(hidesWindowMenuBar("darwin")).toBe(false);
    const mac = applicationMenuTemplate("darwin", "Cloudfs");
    expect(mac[0]?.label).toBe("Cloudfs");
    const roles = menuRoles(mac);
    for (const role of shortcuts) expect(roles).toContain(role);
    expect(roles).toContain("about");
    expect(roles).toContain("hide");
    expect(roles).toContain("front");
    expect(roles).not.toContain("close");
  });
});

import type { MenuItemConstructorOptions } from "electron";

const editMenu: MenuItemConstructorOptions = {
  label: "Edit",
  submenu: [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "selectAll" },
  ],
};

const viewMenu: MenuItemConstructorOptions = {
  label: "View",
  submenu: [
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ],
};

/**
 * Accelerators live on this menu. Windows and Linux hide the bar; macOS shows it
 * in the system menu, where copy and paste are implemented.
 */
export function applicationMenuTemplate(platform: string, appName: string): MenuItemConstructorOptions[] {
  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu:
      platform === "darwin"
        ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
        : [{ role: "minimize" }, { role: "close" }],
  };
  const template: MenuItemConstructorOptions[] = [];
  if (platform === "darwin") {
    template.push({
      label: appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  } else {
    template.push({
      label: "File",
      submenu: [{ role: "quit" }],
    });
  }
  template.push(editMenu, viewMenu, windowMenu);
  return template;
}

/** The in-window menu bar wastes a row on Windows and Linux. macOS uses the system menu. */
export function hidesWindowMenuBar(platform: string): boolean {
  return platform !== "darwin";
}

export function menuRoles(template: MenuItemConstructorOptions[]): string[] {
  const roles: string[] = [];
  const walk = (items: MenuItemConstructorOptions[]) => {
    for (const item of items) {
      if (item.role) roles.push(item.role);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return roles;
}

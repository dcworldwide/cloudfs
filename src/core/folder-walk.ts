import path from "node:path";
import { locatorKey, type Entry, type Locator } from "./store";

export interface WalkNode {
  /** Path under the folder being copied, with `/` separators. */
  relative: string;
  kind: "file" | "folder";
  size?: number;
  locator: Locator;
}

/**
 * List every file and subdirectory under `root`.
 * A repeated identity (a symlink back to an ancestor) is skipped.
 * The root itself is not included; an empty folder yields an empty list.
 */
export async function walkFolder(
  root: Locator,
  list: (locator: Locator) => Promise<Entry[]>,
  identity: (locator: Locator) => Promise<string> = async (locator) => locatorKey(locator),
): Promise<WalkNode[]> {
  const nodes: WalkNode[] = [];
  const seen = new Set<string>();

  async function visit(locator: Locator, relative: string): Promise<void> {
    let id = locatorKey(locator);
    try {
      id = await identity(locator);
    } catch {
      // A stat failure still has to stop a cycle on this key.
    }
    if (seen.has(id)) return;
    seen.add(id);
    if (relative) nodes.push({ relative, kind: "folder", locator });
    const children = await list(locator);
    for (const child of children) {
      const name = child.name.replace(/[\\/]/g, "");
      if (!name || name === "." || name === "..") continue;
      const childRelative = relative ? `${relative}/${name}` : name;
      const childLocator: Locator = {
        storeId: locator.storeId,
        provider: locator.provider,
        container: locator.container,
        key: child.key,
      };
      if (child.kind === "folder") await visit(childLocator, childRelative);
      else nodes.push({ relative: childRelative, kind: "file", size: child.size, locator: childLocator });
    }
  }

  await visit(root, "");
  return nodes;
}

/** True when `child` is `parent` or a path inside it on the same store. */
export function folderContains(parent: Locator, child: Locator): boolean {
  if (parent.provider !== child.provider || parent.storeId !== child.storeId || parent.container !== child.container) {
    return false;
  }
  if (parent.provider === "local") {
    const left = path.resolve(parent.key);
    const right = path.resolve(child.key);
    const prefix = left.endsWith(path.sep) ? left : left + path.sep;
    return right === left || right.startsWith(prefix);
  }
  const left = parent.key.replace(/\/+$/, "");
  const right = child.key.replace(/\/+$/, "");
  if (!left) return true;
  return right === left || right.startsWith(`${left}/`);
}

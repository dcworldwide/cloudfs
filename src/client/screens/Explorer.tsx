import styled from "@emotion/styled";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ListedEntry, PaneLocator, TransferInput } from "../../../electron/preload";
import type { PaneState, PublicAccount, WorkspaceTab } from "../../core/store";
import { api } from "../api";
import { useConfig, useQueue, useWorkspace } from "../state";
import { CloudIcon, ComputerIcon, CopyIcon, FileIcon, FolderIcon, MoveIcon, PlusIcon, TrashIcon } from "../ui/icons";
import { Muted, Pane, Panes } from "../ui/layout";
import {
  Button,
  CrumbButton,
  ContextMenu,
  IconButton,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  RowButton,
  ScrollArea,
  ScrollViewport,
  Tab,
  TabIndicator,
  TabList,
  Tabs,
  TextInput,
  Toast,
} from "../ui/primitives";
import { notify } from "../ui/toast";
import { QueueDrawer } from "./QueueDrawer";

const Body = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const Crumbs = styled.nav`
  display: flex;
  gap: 2px;
  align-items: center;
  min-height: 40px;
  padding: 0 ${({ theme }) => theme.space.md}px;
  overflow: auto;
  white-space: nowrap;
`;

const Filter = styled(TextInput)`
  margin: 0 ${({ theme }) => theme.space.md}px ${({ theme }) => theme.space.sm}px;
  min-height: 36px;
`;

const Table = styled.div`
  display: flex;
  flex-direction: column;
`;

const Meta = styled.span`
  color: inherit;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  @media (max-width: 900px) {
    &:last-of-type {
      display: none;
    }
  }
`;

const Actions = styled.div`
  margin-left: auto;
  display: flex;
  gap: 4px;
  align-items: center;
`;

const DropHint = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 99px;
  background: ${({ theme }) => theme.color.primary};
  color: ${({ theme }) => theme.color.primaryText};
  font: 500 12px ${({ theme }) => theme.font};
`;

const Bar = styled.div`
  display: flex;
  align-items: end;
  gap: 4px;
  padding: ${({ theme }) => theme.space.sm}px ${({ theme }) => theme.space.md}px 0;
  overflow: auto;
`;

function formatSize(size?: number): string {
  if (size == null) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function sourceName(pane: PaneState, accounts: PublicAccount[]): string {
  if (pane.provider === "local") return "This Computer";
  return accounts.find((account) => account.id === pane.storeId)?.displayName ?? "Store";
}

interface ClipItem {
  key: string;
  name: string;
}

interface Clipboard {
  source: PaneState;
  items: ClipItem[];
  mode: "copy" | "move";
}

/** One place that turns a source item into a copy or move job. */
export function transferItems(
  source: PaneState,
  dest: PaneState,
  items: ClipItem[],
  move: boolean,
): TransferInput[] {
  if (dest.provider !== "local" && !dest.container) return [];
  return items
    .filter((item) => !(source.storeId === dest.storeId && source.prefix === dest.prefix && source.container === dest.container))
    .map((item) => {
      const destKey = dest.provider === "local" ? `${dest.prefix.replace(/\/$/, "")}/${item.name}` : `${dest.prefix}${item.name}`;
      const kind = move
        ? "move"
        : source.provider === "local" && dest.provider !== "local"
          ? "upload"
          : source.provider !== "local" && dest.provider === "local"
            ? "download"
            : "copy";
      return {
        kind,
        name: item.name,
        source: { ...source, key: item.key },
        dest: { ...dest, key: destKey },
      } satisfies TransferInput;
    });
}

function tabTitle(tab: WorkspaceTab, accounts: PublicAccount[]): string {
  return `${sourceName(tab.left, accounts)} → ${sourceName(tab.right, accounts)}`;
}

const TAB_SLIDE_MS = 220;

export function Explorer() {
  const { accounts } = useConfig();
  const workspace = useWorkspace();
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const reveal = useRef(workspace.setDisplayed);
  reveal.current = workspace.setDisplayed;
  const shownId = workspace.displayed.id;

  useEffect(() => {
    if (shownId === workspace.active.id) return;
    const next = workspace.active.id;
    const handle = window.setTimeout(() => reveal.current(next), TAB_SLIDE_MS);
    return () => window.clearTimeout(handle);
  }, [workspace.active.id, shownId]);

  return (
    <Body>
      <Bar>
        <Tabs.Root
          value={workspace.active.id}
          onValueChange={(value) => {
            const next = String(value);
            if (next === workspace.active.id) return;
            workspace.setActive(next);
          }}
        >
          <TabList>
            {workspace.tabs.map((tab) => (
              <Tab key={tab.id} value={tab.id}>
                <span>{tabTitle(tab, accounts)}</span>
                {workspace.tabs.length > 1 ? (
                  <IconButton
                    title="Close tab"
                    aria-label={`Close ${tabTitle(tab, accounts)}`}
                    variant="normal"
                    onClick={(event) => {
                      event.stopPropagation();
                      workspace.closeTab(tab.id);
                    }}
                    style={{ width: 22, height: 22, minHeight: 22, marginLeft: 8, borderColor: "transparent" }}
                  >
                    ×
                  </IconButton>
                ) : null}
              </Tab>
            ))}
            <TabIndicator />
          </TabList>
        </Tabs.Root>
        <IconButton title="New tab" aria-label="New tab" onClick={workspace.addTab}>
          +
        </IconButton>
      </Bar>
      <Panes>
        <FilePane side="left" clipboard={clipboard} setClipboard={setClipboard} />
        <FilePane side="right" clipboard={clipboard} setClipboard={setClipboard} />
      </Panes>
      <QueueDrawer />
    </Body>
  );
}

function FilePane({
  side,
  clipboard,
  setClipboard,
}: {
  side: "left" | "right";
  clipboard: Clipboard | null;
  setClipboard: (value: Clipboard | null) => void;
}) {
  const { state, accounts } = useConfig();
  const workspace = useWorkspace();
  const tab = workspace.displayed;
  const pane = tab[side];
  const [entries, setEntries] = useState<ListedEntry[]>([]);
  const filter = workspace.filters[`${tab.id}:${side}`] ?? "";
  const filterValue = useRef(filter);
  filterValue.current = filter;
  const tabId = tab.id;
  const setFilter = (value: string | ((current: string) => string)) => {
    const next = typeof value === "function" ? value(filterValue.current) : value;
    workspace.setFilter(tabId, side, next);
  };
  const filterRef = useRef<HTMLInputElement>(null);
  const toasts = Toast.useToastManager();
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dropMode, setDropMode] = useState<"copy" | "move" | null>(null);
  const paneId = `${tab.id}:${side}`;
  const selected = workspace.selection[paneId] ?? [];
  const savedScroll = workspace.scrollOf(tab.id, side);
  const scrollRef = useRef<HTMLDivElement>(null);

  const locator = useMemo<PaneLocator>(
    () => ({ storeId: pane.storeId, provider: pane.provider, container: pane.container, prefix: pane.prefix }),
    [pane],
  );

  const reload = useMemo(
    () => () => {
      api()
        .list(locator)
        .then((rows) => {
          setEntries(rows);
          setDenied(false);
          setError(null);
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : "Could not list this location.";
          if (/EPERM|EACCES|operation not permitted/i.test(message)) {
            setDenied(true);
            setError(null);
            return;
          }
          setDenied(false);
          setError(message.replace(/^Error invoking remote method '[^']+': /, ""));
        });
    },
    [locator],
  );

  useEffect(() => {
    let live = true;
    setError(null);
    setDenied(false);
    api()
      .list(locator)
      .then((rows) => {
        if (!live) return;
        setEntries(rows);
        setDenied(false);
      })
      .catch((reason: unknown) => {
        if (!live) return;
        const message = reason instanceof Error ? reason.message : "Could not list this location.";
        if (/EPERM|EACCES|operation not permitted/i.test(message)) {
          setDenied(true);
          setEntries([]);
          return;
        }
        setError(message.replace(/^Error invoking remote method '[^']+': /, ""));
      });
    return () => {
      live = false;
    };
  }, [locator]);

  const restoreScroll = useRef<number | null>(savedScroll);
  useEffect(() => {
    restoreScroll.current = savedScroll;
    const node = scrollRef.current;
    if (node) node.scrollTop = savedScroll;
  }, [tab.id, side]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || restoreScroll.current === null || entries.length === 0) return;
    node.scrollTop = restoreScroll.current;
    restoreScroll.current = null;
  }, [entries]);

  const setScroll = workspace.setScroll;
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    let frame = 0;
    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setScroll(tabId, side, node.scrollTop));
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      node.removeEventListener("scroll", onScroll);
    };
  }, [tabId, side, setScroll]);

  useEffect(() => {
    if (pane.provider !== "local" || !pane.prefix) return;
    const dir = pane.prefix;
    void api().watch(dir);
    const stop = api().onFsChange((changed) => {
      if (changed === dir) reload();
    });
    return () => {
      stop();
      void api().unwatch(dir);
    };
  }, [pane.provider, pane.prefix, reload]);

  const visible = entries.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === "c" || event.key === "x")) {
        const hovered = document.querySelector(`[data-pane="${side}"]:hover`);
        if (!hovered || selected.length === 0) return;
        event.preventDefault();
        copyItems(selected, event.key === "x" ? "move" : "copy");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "v") {
        const hovered = document.querySelector(`[data-pane="${side}"]:hover`);
        if (!hovered || !clipboard) return;
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "Escape") {
        const hovered = document.querySelector(`[data-pane="${side}"]:hover`);
        if (hovered && selected.length > 0) {
          event.preventDefault();
          setAnchor(null);
          workspace.setSelection(paneId, []);
          return;
        }
        setFilter("");
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const hovered = document.querySelector(`[data-pane="${side}"]:hover`);
        const keys = visible.map((item) => item.key);
        if (!hovered || keys.length === 0) return;
        event.preventDefault();
        const current = keys.indexOf(anchor ?? selected.at(-1) ?? "");
        const nextIndex = event.key === "ArrowDown" ? Math.min(keys.length - 1, Math.max(0, current) + (current < 0 ? 0 : 1)) : Math.max(0, current - 1);
        const next = keys[nextIndex];
        if (!anchor) setAnchor(next);
        if (event.shiftKey && anchor) {
          const start = keys.indexOf(anchor);
          const [from, to] = start < nextIndex ? [start, nextIndex] : [nextIndex, start];
          workspace.setSelection(paneId, keys.slice(from, to + 1));
        } else {
          setAnchor(next);
          workspace.setSelection(paneId, [next]);
        }
        document.querySelector(`[data-pane="${side}"] [data-key="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "Enter" && selected.length === 1) {
        const hovered = document.querySelector(`[data-pane="${side}"]:hover`);
        if (!hovered) return;
        const entry = entries.find((item) => item.key === selected[0]);
        if (!entry) return;
        event.preventDefault();
        setRenaming(entry.key);
        setRenameValue(entry.name);
        return;
      }
      if (event.key.length !== 1) return;
      const hovered = document.querySelector(`[data-pane="${side}"]:hover`);
      if (!hovered) return;
      event.preventDefault();
      const scroller = document.querySelector(`[data-pane="${side}"] [data-scroll]`) as HTMLElement | null;
      const top = scroller?.scrollTop ?? 0;
      filterRef.current?.focus({ preventScroll: true });
      if (scroller) scroller.scrollTop = top;
      setFilter((current) => current + event.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side, selected, entries, pane, clipboard, setClipboard, visible, anchor, paneId, workspace]);

  function copyItems(keys: string[], mode: "copy" | "move") {
    const items = entries.filter((entry) => keys.includes(entry.key)).map((entry) => ({ key: entry.key, name: entry.name }));
    if (!items.length) return;
    setClipboard({ source: pane, items, mode });
  }

  function pasteClipboard() {
    if (!clipboard) return;
    for (const job of transferItems(clipboard.source, pane, clipboard.items, clipboard.mode === "move")) {
      void api().transfer(job);
    }
    if (clipboard.mode === "move") setClipboard(null);
  }

  function deleteKeys(keys: string[]) {
    for (const key of keys) {
      const name = key.split("/").filter(Boolean).at(-1) ?? "item";
      void api().transfer({ kind: "delete", name, source: { ...pane, key }, dest: { ...pane, key } });
    }
    workspace.setSelection(paneId, []);
  }


  function open(entry: ListedEntry) {
    if (entry.kind !== "folder") return;
    if (pane.provider !== "local" && !pane.container) {
      workspace.updatePane(side, { container: entry.key, prefix: "" });
      return;
    }
    workspace.updatePane(side, { prefix: entry.key });
  }

  return (
    <Pane
      data-pane={side}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("application/cloudfs")) setDropMode(event.shiftKey ? "move" : "copy");
      }}
      onDragLeave={() => setDropMode(null)}
      onDrop={(event) => {
        event.preventDefault();
        setDropMode(null);
        const raw = event.dataTransfer.getData("application/cloudfs");
        if (!raw) return;
        const payload = JSON.parse(raw) as { side: "left" | "right"; keys: ClipItem[] };
        if (payload.side === side) return;
        const source = workspace.displayed[payload.side];
        for (const job of transferItems(source, pane, payload.keys, event.shiftKey)) {
          void api().transfer(job);
        }
      }}
    >
      <Crumbs aria-label="Location">
        <SourceMenu
          pane={pane}
          accounts={accounts}
          home={state.home}
          onSelect={(next) => workspace.updatePane(side, next)}
        />
        <CrumbsPath pane={pane} home={state.home} onSelect={(patch) => workspace.updatePane(side, patch)} />
        {dropMode ? (
          <DropHint>
            {dropMode === "move" ? <MoveIcon /> : <CopyIcon />}
            {dropMode === "move" ? "Move" : "Copy"}
          </DropHint>
        ) : null}
        <Actions>
          {creating ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!folderName.trim()) return;
                void api().mkdir(locator, folderName).then(() => {
                  setFolderName("");
                  setCreating(false);
                  reload();
                });
              }}
            >
              <Filter
                autoFocus
                value={folderName}
                placeholder="Folder name"
                onChange={(event) => setFolderName(event.target.value)}
                onBlur={() => setCreating(false)}
                style={{ margin: 0, width: 140 }}
              />
            </form>
          ) : null}
          <IconButton title="New folder" aria-label="New folder" onClick={() => setCreating(true)}>
            <PlusIcon />
          </IconButton>
          <IconButton
            title="Delete"
            aria-label="Delete"
            variant="danger"
            disabled={selected.length === 0}
            onClick={() => deleteKeys(selected)}
          >
            <TrashIcon />
          </IconButton>
        </Actions>
      </Crumbs>
      <Filter
        ref={filterRef}
        value={filter}
        placeholder="Type to filter"
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setFilter("");
            event.currentTarget.blur();
          }
        }}
      />
      <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
      <ScrollArea.Root style={{ flex: 1, minHeight: 0 }}>
        <ScrollViewport ref={scrollRef} data-scroll="">
          <Table>
            {denied ? (
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <Muted>macOS has not allowed Cloudfs to read this folder.</Muted>
                <Button
                  variant="action"
                  onClick={() => {
                    void api().grant(pane.prefix).then((granted) => {
                      if (granted) workspace.updatePane(side, { prefix: granted });
                      reload();
                    });
                  }}
                >
                  Allow access
                </Button>
              </div>
            ) : null}
            {error ? <Muted style={{ padding: 12 }}>{error}</Muted> : null}
            {visible.map((entry) => renaming === entry.key ? (
              <RowButton key={entry.key} data-key={entry.key} selected render={<div />}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {entry.kind === "folder" ? <FolderIcon /> : <FileIcon />}
                  <Filter
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Escape") setRenaming(null);
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      const next = renameValue.trim();
                      if (!next || next === entry.name) {
                        setRenaming(null);
                        return;
                      }
                      const taken = entries.some(
                        (item) => item.key !== entry.key && item.name.localeCompare(next, undefined, { sensitivity: "accent" }) === 0,
                      );
                      if (taken) {
                        notify(toasts, "error", `"${next}" already exists.`);
                        return;
                      }
                      void api()
                        .rename(locator, entry.key, next)
                        .then(() => {
                          setRenaming(null);
                          reload();
                        })
                        .catch((reason: unknown) => {
                          notify(toasts, "error", reason instanceof Error ? reason.message : "Could not rename.");
                        });
                    }}
                    style={{ margin: 0, minHeight: 28 }}
                  />
                </span>
                <Meta>{formatSize(entry.size)}</Meta>
                <Meta>{entry.modified ? entry.modified.slice(0, 16).replace("T", " ") : ""}</Meta>
              </RowButton>
            ) : (
              <ContextMenu.Root key={entry.key}>
              <ContextMenu.Trigger
                render={
              <RowButton
                data-key={entry.key}
                selected={selected.includes(entry.key)}
                draggable
                onDragStart={(event) => {
                  const keys = selected.includes(entry.key)
                    ? entries.filter((item) => selected.includes(item.key)).map((item) => ({ key: item.key, name: item.name }))
                    : [{ key: entry.key, name: entry.name }];
                  event.dataTransfer.setData("application/cloudfs", JSON.stringify({ side, keys }));
                  event.dataTransfer.effectAllowed = "copyMove";
                }}
                onClick={(event) => {
                  if (event.shiftKey && anchor) {
                    const keys = visible.map((item) => item.key);
                    const start = keys.indexOf(anchor);
                    const end = keys.indexOf(entry.key);
                    if (start >= 0 && end >= 0) {
                      const [from, to] = start < end ? [start, end] : [end, start];
                      const range = keys.slice(from, to + 1);
                      workspace.setSelection(paneId, event.metaKey || event.ctrlKey ? [...new Set([...selected, ...range])] : range);
                      return;
                    }
                  }
                  const next = event.metaKey || event.ctrlKey
                    ? selected.includes(entry.key)
                      ? selected.filter((key) => key !== entry.key)
                      : [...selected, entry.key]
                    : [entry.key];
                  setAnchor(entry.key);
                  workspace.setSelection(paneId, next);
                }}
                onDoubleClick={() => open(entry)}
                onContextMenu={() => {
                  if (!selected.includes(entry.key)) workspace.setSelection(paneId, [entry.key]);
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {entry.kind === "folder" ? <FolderIcon /> : <FileIcon />}
                  <span>{entry.kind === "folder" ? `${entry.name}/` : entry.name}</span>
                </span>
                <Meta>{formatSize(entry.size)}</Meta>
                <Meta>{entry.modified ? entry.modified.slice(0, 16).replace("T", " ") : ""}</Meta>
              </RowButton>
                }
              />
              <ContextMenu.Portal>
                <ContextMenu.Positioner>
                  <MenuPopup>
                    <MenuItem onClick={() => copyItems(selected.includes(entry.key) ? selected : [entry.key], "copy")}>
                      Copy
                    </MenuItem>
                    <MenuItem onClick={() => copyItems(selected.includes(entry.key) ? selected : [entry.key], "move")}>
                      Cut
                    </MenuItem>
                    <MenuItem disabled={!clipboard} onClick={pasteClipboard}>
                      Paste
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setRenaming(entry.key);
                        setRenameValue(entry.name);
                      }}
                    >
                      Rename
                    </MenuItem>
                    <MenuItem onClick={() => deleteKeys(selected.includes(entry.key) ? selected : [entry.key])}>
                      Delete
                    </MenuItem>
                  </MenuPopup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
              </ContextMenu.Root>
            ))}
            {!error && visible.length === 0 ? <Muted style={{ padding: 12 }}>Nothing here.</Muted> : null}
          </Table>
        </ScrollViewport>
      </ScrollArea.Root>
        }
      />
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <MenuPopup>
            <MenuItem disabled={!clipboard} onClick={pasteClipboard}>
              Paste
            </MenuItem>
          </MenuPopup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
      </ContextMenu.Root>
    </Pane>
  );
}

function SourceMenu({
  pane,
  accounts,
  home,
  onSelect,
}: {
  pane: PaneState;
  accounts: PublicAccount[];
  home: string;
  onSelect: (patch: Partial<PaneState>) => void;
}) {
  return (
    <Menu.Root>
      <MenuTrigger>{sourceName(pane, accounts)}</MenuTrigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6}>
          <MenuPopup>
            <MenuItem onClick={() => onSelect({ storeId: "local", provider: "local", container: "", prefix: home })}>
              <ComputerIcon /> This Computer
            </MenuItem>
            {accounts.map((account) => (
              <MenuItem
                key={account.id}
                onClick={() => onSelect({ storeId: account.id, provider: account.provider, container: "", prefix: "" })}
              >
                <CloudIcon /> {account.displayName}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

interface Crumb {
  label: string;
  patch: Partial<PaneState>;
}

function crumbsFor(pane: PaneState, home: string): Crumb[] {
  if (pane.provider === "local") {
    const path = pane.prefix || home;
    const relative = path.startsWith(home) ? path.slice(home.length) : path;
    const parts = relative.split("/").filter(Boolean);
    const crumbs: Crumb[] = [{ label: "Home", patch: { prefix: home } }];
    let cursor = home.replace(/\/$/, "");
    for (const part of parts) {
      cursor = `${cursor}/${part}`;
      crumbs.push({ label: part, patch: { prefix: cursor } });
    }
    return crumbs;
  }
  const crumbs: Crumb[] = [{ label: "Buckets", patch: { container: "", prefix: "" } }];
  if (pane.container) crumbs.push({ label: pane.container, patch: { container: pane.container, prefix: "" } });
  const parts = pane.prefix.split("/").filter(Boolean);
  let prefix = "";
  for (const part of parts) {
    prefix = `${prefix}${part}/`;
    crumbs.push({ label: part, patch: { container: pane.container, prefix } });
  }
  return crumbs;
}

function CrumbsPath({
  pane,
  home,
  onSelect,
}: {
  pane: PaneState;
  home: string;
  onSelect: (patch: Partial<PaneState>) => void;
}) {
  const crumbs = crumbsFor(pane, home);
  return (
    <>
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <span aria-hidden="true">/</span>
          <CrumbButton
            aria-current={index === crumbs.length - 1 ? "page" : undefined}
            onClick={() => onSelect(crumb.patch)}
          >
            {crumb.label}
          </CrumbButton>
        </span>
      ))}
    </>
  );
}

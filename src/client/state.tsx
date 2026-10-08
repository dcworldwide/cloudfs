import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppState, ListedEntry, PaneLocator, TransferInput } from "../../electron/preload";
import type { PaneState, PaneView, PublicAccount, TransferJob, WorkspaceTab } from "../core/store";
import { paneView } from "../core/store";
import { api } from "./api";

interface ConfigValue {
  state: AppState;
  refresh: () => Promise<void>;
  accounts: PublicAccount[];
}

interface WorkspaceValue {
  tabs: WorkspaceTab[];
  active: WorkspaceTab;
  setActive: (id: string) => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  updatePane: (side: "left" | "right", patch: Partial<WorkspaceTab["left"]>) => void;
  selection: Record<string, string[]>;
  setSelection: (paneId: string, keys: string[]) => void;
  filters: Record<string, string>;
  setFilter: (tabId: string, side: "left" | "right", value: string) => void;
  setScroll: (tabId: string, side: "left" | "right", value: number) => void;
  scrollOf: (tabId: string, side: "left" | "right") => number;
  /** Tab whose panes are on screen. Trails `active` by the tab-pill animation. */
  displayed: WorkspaceTab;
  setDisplayed: (id: string) => void;
}

interface QueueValue {
  jobs: TransferJob[];
  enqueue: (input: TransferInput) => Promise<void>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

const ConfigContext = createContext<ConfigValue | null>(null);
const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const QueueContext = createContext<QueueValue | null>(null);

function freshTab(home: string, storeId: string): WorkspaceTab {
  return {
    id: `tab-${Date.now()}`,
    left: { storeId: "local", provider: "local", container: "", prefix: home, view: emptyView() },
    right: { storeId, provider: storeId === "local" ? "local" : "s3", container: "", prefix: storeId === "local" ? home : "", view: emptyView() },
  };
}

function emptyView(): PaneView {
  return { filter: "", selected: [], scroll: 0 };
}

function withView(pane: PaneState, patch: Partial<PaneView>): PaneState {
  return { ...pane, view: { ...paneView(pane), ...patch } };
}

function paneKey(tabId: string, side: "left" | "right"): string {
  return `${tabId}:${side}`;
}

function splitPaneId(paneId: string): [string, string] {
  const index = paneId.lastIndexOf(":");
  return [paneId.slice(0, index), paneId.slice(index + 1)];
}

function readLiveScroll(scrolls: Record<string, number>, tabId: string): Record<string, number> {
  const next = { ...scrolls };
  for (const node of document.querySelectorAll<HTMLElement>("[data-pane] [data-scroll]")) {
    const pane = node.closest("[data-pane]")?.getAttribute("data-pane");
    if ((pane === "left" || pane === "right") && tabId) next[paneKey(tabId, pane)] = node.scrollTop;
  }
  return next;
}

function stampScroll(tabs: WorkspaceTab[], scrolls: Record<string, number>): WorkspaceTab[] {
  return tabs.map((tab) => ({
    ...tab,
    left: withView(tab.left, { scroll: scrolls[paneKey(tab.id, "left")] ?? paneView(tab.left).scroll }),
    right: withView(tab.right, { scroll: scrolls[paneKey(tab.id, "right")] ?? paneView(tab.right).scroll }),
  }));
}

function viewsFrom(tabs: WorkspaceTab[]): {
  filters: Record<string, string>;
  selection: Record<string, string[]>;
  scrolls: Record<string, number>;
} {
  const filters: Record<string, string> = {};
  const selection: Record<string, string[]> = {};
  const scrolls: Record<string, number> = {};
  for (const tab of tabs) {
    for (const side of ["left", "right"] as const) {
      const view = paneView(tab[side]);
      const key = paneKey(tab.id, side);
      filters[key] = view.filter;
      selection[key] = view.selected;
      scrolls[key] = view.scroll;
    }
  }
  return { filters, selection, scrolls };
}

export function AppStateProvider({ initial, children }: { initial: AppState; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() =>
    (initial.tabs as WorkspaceTab[] | undefined)?.length
      ? (initial.tabs as WorkspaceTab[])
      : [freshTab(initial.home, "local")],
  );
  const [activeId, setActiveId] = useState(initial.activeTabId ?? tabs[0]?.id ?? "");
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [selection, setSelectionState] = useState<Record<string, string[]>>(() => viewsFrom(tabs).selection);
  const [filters, setFilters] = useState<Record<string, string>>(() => viewsFrom(tabs).filters);
  const [scrolls, setScrolls] = useState<Record<string, number>>(() => viewsFrom(tabs).scrolls);
  const scrollsRef = useRef(scrolls);
  scrollsRef.current = scrolls;
  const [displayedId, setDisplayedId] = useState(initial.activeTabId ?? tabs[0]?.id ?? "");

  const refresh = useCallback(async () => {
    setState(await api().getState());
  }, []);

  useEffect(() => api().onJobs(setJobs), []);
  useEffect(() => api().onState(() => void refresh()), [refresh]);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const displayedRefId = useRef(displayedId);
  displayedRefId.current = tabs.find((tab) => tab.id === displayedId)?.id ?? displayedId;

  useEffect(() => {
    const handle = setTimeout(() => {
      const live = readLiveScroll(scrollsRef.current, displayedRefId.current);
      scrollsRef.current = live;
      setScrolls(live);
      void api().saveTabs(stampScroll(tabs, live), activeId);
    }, 300);
    return () => clearTimeout(handle);
  }, [tabs, activeId]);

  useEffect(() => {
    const flush = () => {
      const live = readLiveScroll(scrollsRef.current, displayedRefId.current);
      scrollsRef.current = live;
      void api().saveTabs(stampScroll(tabsRef.current, live), activeRef.current);
    };
    window.addEventListener("pagehide", flush);
    const stop = api().onFlushTabs(flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      stop();
    };
  }, []);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const displayedRef = useRef(active);
  const shown = tabs.find((tab) => tab.id === displayedId);
  const displayed = shown ?? displayedRef.current;
  displayedRef.current = displayed;

  const workspace = useMemo<WorkspaceValue>(
    () => ({
      tabs,
      active,
      setActive: setActiveId,
      addTab: () => {
        const last = state.accounts.at(-1)?.id ?? "local";
        const tab = freshTab(state.home, last);
        setTabs((current) => [...current, tab]);
        setActiveId(tab.id);
      },
      closeTab: (id) => {
        setTabs((current) => {
          const next = current.filter((tab) => tab.id !== id);
          return next.length ? next : [freshTab(state.home, "local")];
        });
        if (activeId === id) setActiveId(tabs.find((tab) => tab.id !== id)?.id ?? "");
      },
      updatePane: (side, patch) => {
        const id = displayed.id;
        setTabs((current) =>
          current.map((tab) =>
            tab.id === id ? { ...tab, [side]: withView({ ...tab[side], ...patch }, { selected: [], scroll: 0 }) } : tab,
          ),
        );
        setSelectionState((current) => ({ ...current, [paneKey(id, side)]: [] }));
        setScrolls((current) => ({ ...current, [paneKey(id, side)]: 0 }));
      },
      selection,
      setSelection: (paneId, keys) => {
        setSelectionState((current) => ({ ...current, [paneId]: keys }));
        const [tabId, side] = splitPaneId(paneId);
        if (!tabId || (side !== "left" && side !== "right")) return;
        setTabs((current) =>
          current.map((tab) => (tab.id === tabId ? { ...tab, [side]: withView(tab[side], { selected: keys }) } : tab)),
        );
      },
      filters,
      setFilter: (tabId, side, value) => {
        setFilters((current) => ({ ...current, [paneKey(tabId, side)]: value }));
        setTabs((current) =>
          current.map((tab) => (tab.id === tabId ? { ...tab, [side]: withView(tab[side], { filter: value, scroll: 0 }) } : tab)),
        );
        setScrolls((current) => ({ ...current, [paneKey(tabId, side)]: 0 }));
      },
      setScroll: (tabId, side, value) => {
        setScrolls((current) => ({ ...current, [paneKey(tabId, side)]: value }));
      },
      scrollOf: (tabId, side) => scrolls[paneKey(tabId, side)] ?? 0,
      displayed,
      setDisplayed: setDisplayedId,
    }),
    [tabs, active, activeId, state.accounts, state.home, selection, filters, scrolls, displayed],
  );

  const queue = useMemo<QueueValue>(
    () => ({
      jobs,
      enqueue: async (input) => {
        await api().transfer(input);
      },
      pause: (id) => api().pause(id),
      resume: (id) => api().resume(id),
      cancel: (id) => api().cancel(id),
      dismiss: (id) => api().dismiss(id),
    }),
    [jobs],
  );

  return (
    <ConfigContext.Provider value={{ state, refresh, accounts: state.accounts }}>
      <WorkspaceContext.Provider value={workspace}>
        <QueueContext.Provider value={queue}>{children}</QueueContext.Provider>
      </WorkspaceContext.Provider>
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error("ConfigContext is missing.");
  return value;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceContext is missing.");
  return value;
}

export function useQueue(): QueueValue {
  const value = useContext(QueueContext);
  if (!value) throw new Error("QueueContext is missing.");
  return value;
}

export type { ListedEntry, PaneLocator };

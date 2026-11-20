import styled from "@emotion/styled";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PaneLocator } from "../../electron/preload";
import { parsePathText, pathSegments, pathText, sameParsedLocation, type PathSegment } from "../core/paths";
import type { PaneState } from "../core/store";
import { api } from "./api";
import { PathField } from "./ui/primitives";

/** A segment longer than this is drawn with an ellipsis in the middle. */
export const CRUMB_LABEL_MAX = 28;

/**
 * Single clicks navigate. The wait lets a double-click edit the path instead of
 * opening the segment the first click landed on.
 */
export const CRUMB_NAV_DELAY_MS = 300;

/** Keep the tail of a horizontal scroller in view. */
export function endScroll(scrollWidth: number, clientWidth: number): number {
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth)) return 0;
  return Math.max(0, scrollWidth - clientWidth);
}

/** Shorten a breadcrumb label, keeping the start and the end. */
export function abbreviateMiddle(label: string, max = CRUMB_LABEL_MAX): string {
  const chars = Array.from(label);
  if (max < 1 || chars.length <= max) return label;
  if (max === 1) return "…";
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/** Shown under the path field when Enter cannot open what was typed. */
export function locationFailureMessage(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  const message = raw.replace(/^Error invoking remote method '[^']+': /, "").trim();
  if (/ENOTDIR/i.test(message)) return "That location isn't a folder.";
  if (/ENOENT|no such file|not found|does not exist|NoSuchBucket|NoSuchKey|\b550\b/i.test(message)) {
    return "That location doesn't exist.";
  }
  if (/EPERM|EACCES|AccessDenied|operation not permitted|permission denied|forbidden/i.test(message)) {
    return "That location isn't reachable.";
  }
  return message || "Could not open that location.";
}

const PathWrap = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Track = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: thin;
  scrollbar-color: ${({ theme }) => theme.color.muted} transparent;
  &::-webkit-scrollbar {
    height: 8px;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.color.muted};
    border-radius: 99px;
  }
`;

const CrumbButton = styled.button`
  flex: none;
  margin: 0;
  padding: 0 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: ${({ theme }) => theme.color.muted};
  font: 500 13px ${({ theme }) => theme.font};
  line-height: 28px;
  cursor: pointer;
  &:hover {
    color: ${({ theme }) => theme.color.text};
    background: ${({ theme }) => theme.color.bg};
  }
  &[aria-current="page"] {
    color: ${({ theme }) => theme.color.text};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: 1px;
  }
`;

const CrumbSep = styled.span`
  flex: none;
  color: ${({ theme }) => theme.color.muted};
  font: 500 13px ${({ theme }) => theme.font};
  user-select: none;
`;

const EditField = styled(PathField, {
  shouldForwardProp: (prop) => prop !== "$invalid",
})<{ $invalid?: boolean }>`
  width: 100%;
  min-width: 0;
  ${({ $invalid, theme }) => ($invalid ? `border-color: ${theme.color.danger};` : "")}
`;

const PathError = styled.div`
  color: ${({ theme }) => theme.color.danger};
  font: 500 12px ${({ theme }) => theme.font};
  line-height: 1.3;
  padding: 0 4px 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

type CommitResult = void | boolean | Promise<boolean | void>;

export function Breadcrumb({
  segments,
  separator,
  editing,
  draft,
  error,
  onDraft,
  onBeginEdit,
  onCommit,
  onCancel,
  onNavigate,
  isUnchanged,
}: {
  segments: PathSegment[];
  separator: string;
  editing: boolean;
  draft: string;
  error?: string | null;
  onDraft: (value: string) => void;
  onBeginEdit: () => void;
  /** Return true to keep the field open (the path could not be opened). */
  onCommit: (text: string) => CommitResult;
  onCancel: () => void;
  onNavigate: (segment: PathSegment) => void;
  isUnchanged?: (text: string) => boolean;
}) {
  const errorId = useId();
  const track = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);
  const commitLock = useRef(false);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedWith = useRef(draft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const signature = segments.map((segment) => `${segment.label}\0${segment.prefix}\0${segment.container ?? ""}`).join("\n");
  const unchanged = isUnchanged ?? ((text: string) => text === openedWith.current);

  useEffect(() => {
    return () => {
      if (navTimer.current != null) clearTimeout(navTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const node = track.current;
    if (!node || editing) return;
    node.scrollLeft = endScroll(node.scrollWidth, node.clientWidth);
  }, [signature, editing]);

  useEffect(() => {
    if (!editing) return;
    openedWith.current = draftRef.current;
    skipBlur.current = false;
    field.current?.focus();
    field.current?.select();
  }, [editing]);

  function clearNav() {
    if (navTimer.current == null) return;
    clearTimeout(navTimer.current);
    navTimer.current = null;
  }

  function beginCommit(text: string) {
    commitLock.current = true;
    void Promise.resolve(onCommit(text)).then((stay) => {
      commitLock.current = false;
      if (stay === true) field.current?.focus();
    });
  }

  function scheduleNavigate(segment: PathSegment) {
    clearNav();
    navTimer.current = setTimeout(() => {
      navTimer.current = null;
      onNavigate(segment);
    }, CRUMB_NAV_DELAY_MS);
  }

  return (
    <PathWrap>
      <Track
        ref={track}
        data-testid="breadcrumb"
        aria-label="Path"
        onDoubleClick={(event) => {
          if (editing || event.button !== 0) return;
          clearNav();
          event.preventDefault();
          onBeginEdit();
        }}
      >
        {editing ? (
          <EditField
            ref={field}
            aria-label="Location"
            aria-invalid={error ? true : undefined}
            aria-errormessage={error ? errorId : undefined}
            spellCheck={false}
            $invalid={Boolean(error)}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onBlur={(event) => {
              if (skipBlur.current) {
                skipBlur.current = false;
                return;
              }
              if (commitLock.current) return;
              const text = event.currentTarget.value;
              if (unchanged(text)) {
                onCancel();
                return;
              }
              beginCommit(text);
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && !event.altKey) {
                const key = event.key.toLowerCase();
                if (key === "a" || key === "c" || key === "v" || key === "x") {
                  event.stopPropagation();
                  return;
                }
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                skipBlur.current = true;
                onCancel();
                event.currentTarget.blur();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              event.stopPropagation();
              beginCommit(event.currentTarget.value);
            }}
          />
        ) : (
          segments.map((segment, index) => {
            const current = index === segments.length - 1;
            const full = segment.label;
            const shown = abbreviateMiddle(full);
            const shortened = shown !== full;
            return (
              <Fragment key={`${segment.container ?? ""}\0${segment.prefix}\0${index}`}>
                {index > 0 && segments[index - 1]?.label !== "/" ? <CrumbSep aria-hidden="true">{separator}</CrumbSep> : null}
                <CrumbButton
                  type="button"
                  aria-current={current ? "page" : undefined}
                  aria-label={shortened ? full : undefined}
                  title={shortened ? full : undefined}
                  onClick={(event) => {
                    if (event.detail > 1 || current) return;
                    scheduleNavigate(segment);
                  }}
                >
                  {shown}
                </CrumbButton>
              </Fragment>
            );
          })
        )}
      </Track>
      {editing && error ? (
        <PathError id={errorId} role="alert" title={error}>
          {error}
        </PathError>
      ) : null}
    </PathWrap>
  );
}

function defaultProbe(locator: PaneLocator): Promise<unknown> {
  return api().list(locator);
}

export function LocationEditor({
  pane,
  platform,
  onSelect,
  probe = defaultProbe,
}: {
  pane: PaneState;
  platform: string;
  onSelect: (patch: Partial<PaneState>) => void;
  probe?: (locator: PaneLocator) => Promise<unknown>;
}) {
  const host = platform === "win32" ? "win32" : "linux";
  const shown = pathText(pane.provider, pane.prefix, pane.container, host);
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);

  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);

  function unchanged(text: string): boolean {
    return sameParsedLocation(pane.provider, pane, text, host);
  }

  function cancel() {
    attempt.current += 1;
    setError(null);
    setDraft(shown);
    setEditing(false);
  }

  async function commit(text: string): Promise<boolean> {
    const id = ++attempt.current;
    if (unchanged(text)) {
      setError(null);
      setEditing(false);
      return false;
    }
    const parsed = parsePathText(pane.provider, text, host);
    try {
      await probe({
        storeId: pane.storeId,
        provider: pane.provider,
        container: parsed.container,
        prefix: parsed.prefix,
      });
    } catch (reason) {
      if (attempt.current !== id) return false;
      setError(locationFailureMessage(reason));
      return true;
    }
    if (attempt.current !== id) return false;
    setError(null);
    setEditing(false);
    onSelect({ container: parsed.container, prefix: parsed.prefix });
    return false;
  }

  const segments = pathSegments(pane.provider, pane.prefix, pane.container, host);
  return (
    <Breadcrumb
      segments={segments}
      separator={pane.provider === "local" && host === "win32" ? "\\" : "/"}
      editing={editing}
      draft={draft}
      error={error}
      onDraft={setDraft}
      onBeginEdit={() => {
        setDraft(shown);
        setError(null);
        setEditing(true);
      }}
      onCommit={commit}
      onCancel={cancel}
      isUnchanged={unchanged}
      onNavigate={(segment) => onSelect({ container: segment.container ?? pane.container, prefix: segment.prefix })}
    />
  );
}

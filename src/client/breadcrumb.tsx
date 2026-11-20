import styled from "@emotion/styled";
import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import type { PathSegment } from "../core/paths";
import { PathField } from "./ui/primitives";

/** A segment longer than this is drawn with an ellipsis in the middle. */
export const CRUMB_LABEL_MAX = 28;

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

export function Breadcrumb({
  segments,
  separator,
  editing,
  draft,
  onDraft,
  onBeginEdit,
  onCommit,
  onCancel,
  onNavigate,
}: {
  segments: PathSegment[];
  separator: string;
  editing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onBeginEdit: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onNavigate: (segment: PathSegment) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);
  const signature = segments.map((segment) => `${segment.label}\0${segment.prefix}\0${segment.container ?? ""}`).join("\n");

  useLayoutEffect(() => {
    const node = track.current;
    if (!node || editing) return;
    node.scrollLeft = endScroll(node.scrollWidth, node.clientWidth);
  }, [signature, editing]);

  useEffect(() => {
    if (!editing) return;
    skipBlur.current = false;
    field.current?.focus();
    field.current?.select();
  }, [editing]);

  return (
    <Track
      ref={track}
      data-testid="breadcrumb"
      aria-label="Path"
      onMouseDown={(event) => {
        if (editing || event.button !== 0) return;
        if (event.target === event.currentTarget) onBeginEdit();
      }}
    >
      {editing ? (
        <PathField
          ref={field}
          aria-label="Location"
          spellCheck={false}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            onCommit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              skipBlur.current = true;
              onCancel();
              event.currentTarget.blur();
              return;
            }
            if (event.key !== "Enter") return;
            event.preventDefault();
            onCommit(event.currentTarget.value);
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
                onClick={() => (current ? onBeginEdit() : onNavigate(segment))}
              >
                {shown}
              </CrumbButton>
            </Fragment>
          );
        })
      )}
    </Track>
  );
}

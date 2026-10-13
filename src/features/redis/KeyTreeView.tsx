import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { visibleRows, type KeyNode } from "@/features/redis/keyTree";
import { cn } from "@/lib/utils";

type KeyTreeViewProps = {
  nodes: KeyNode[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** the scrolling container the list sits in, shared with the messages around it */
  scrollRef: RefObject<HTMLDivElement | null>;
};

/** 28px rows like every other table; the open key gets the "where you are" marker. */
const ROW_HEIGHT = 28;
/** each level steps in by this much, with a guide rule like the connection tree's */
const INDENT = 16;

const KEY_ROW =
  "relative flex h-7 w-full items-center pr-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/**
 * Flat, virtualized list of the open part of the tree: a flat namespace of
 * thousands of SCAN keys renders only the rows in view. One tab stop for the whole
 * list (the open key, else the first row); ↑↓ Home End move, → opens a folder, ← closes it.
 */
export function KeyTreeView({ nodes, selected, onSelect, scrollRef }: KeyTreeViewProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useMemo(() => visibleRows(nodes, open), [nodes, open]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    // the list starts below the scan status lines in the same scroller
    scrollMargin: listRef.current?.offsetTop ?? 0,
    // jsdom (tests) has no layout; real windows measure the element
    initialRect: { width: 320, height: 600 }
  });

  const [cursor, setCursor] = useState<number | null>(null);
  /** the row to focus once the virtualizer has rendered it */
  const pendingFocus = useRef<number | null>(null);
  const selectedIndex = rows.findIndex(
    ({ node }) => node.kind === "key" && node.entry.name === selected
  );
  const current = Math.min(cursor ?? Math.max(selectedIndex, 0), rows.length - 1);

  useEffect(() => {
    if (pendingFocus.current === null) {
      return;
    }
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row='${pendingFocus.current}']`);
    if (row) {
      row.focus();
      pendingFocus.current = null;
    }
  });

  function moveTo(index: number) {
    const next = Math.max(0, Math.min(index, rows.length - 1));
    setCursor(next);
    pendingFocus.current = next;
    virtualizer.scrollToIndex(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (rows.length === 0) {
      return;
    }
    const { node } = rows[current];
    if (event.key === "ArrowDown") {
      moveTo(current + 1);
    } else if (event.key === "ArrowUp") {
      moveTo(current - 1);
    } else if (event.key === "Home") {
      moveTo(0);
    } else if (event.key === "End") {
      moveTo(rows.length - 1);
    } else if (event.key === "ArrowRight" && node?.kind === "folder" && !open.has(node.id)) {
      toggle(node.id);
    } else if (event.key === "ArrowLeft" && node?.kind === "folder" && open.has(node.id)) {
      toggle(node.id);
    } else {
      return;
    }
    event.preventDefault();
  }

  function toggle(id: string) {
    setOpen(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <ul
      ref={listRef}
      aria-label="Chaves"
      onKeyDown={handleKeyDown}
      className="relative text-sm"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map(item => {
        const { node, depth, position, setSize } = rows[item.index];
        const isFolder = node.kind === "folder";
        const isSelected = !isFolder && node.entry.name === selected;
        return (
          <li
            key={isFolder ? `folder:${node.id}` : `key:${node.entry.name}`}
            // flattened for the virtualizer: level and position keep the hierarchy readable
            aria-level={depth + 1}
            aria-posinset={position}
            aria-setsize={setSize}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            <button
              type="button"
              data-row={item.index}
              tabIndex={item.index === current ? 0 : -1}
              onFocus={() => setCursor(item.index)}
              title={isFolder ? undefined : node.entry.name}
              aria-expanded={isFolder ? open.has(node.id) : undefined}
              aria-current={isSelected || undefined}
              onClick={() => (isFolder ? toggle(node.id) : onSelect(node.entry.name))}
              className={cn(
                KEY_ROW,
                isFolder ? "gap-1" : "gap-2",
                isSelected &&
                  "bg-select font-semibold text-select-foreground hover:bg-select [&_.legend]:text-select-foreground"
              )}
              style={{ paddingLeft: 6 + depth * INDENT }}
            >
              {depth > 0 && (
                // one guide rule per level, in the indent only, never behind the name
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: depth * INDENT,
                    backgroundImage:
                      "linear-gradient(to right, var(--border) 1px, transparent 1px)",
                    backgroundSize: `${INDENT}px 100%`,
                    backgroundPosition: "11px 0"
                  }}
                />
              )}
              {isFolder ? (
                <>
                  {open.has(node.id) ? (
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs">{node.name || "(vazio)"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{node.count}</span>
                </>
              ) : (
                <>
                  <span className="w-11 shrink-0 legend text-muted-foreground">
                    {node.entry.kind}
                  </span>
                  <span className="truncate font-mono text-xs">{node.name || "(vazio)"}</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

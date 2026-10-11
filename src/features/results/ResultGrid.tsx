import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Cell, ResultColumn, Sort } from "@/bindings";
import { gridText, isNumeric } from "@/features/results/format";
import { cn } from "@/lib/utils";

export type SelectedCell = { row: number; column: number };

/** Inline editing hooks; without them the grid is read-only. */
export type GridEditing = {
  canEdit: (row: number, column: number) => boolean;
  /** initial text of the inline input */
  textFor: (row: number, column: number) => string;
  onCommit: (row: number, column: number, value: string) => void;
  rowStatus: (row: number) => "new" | "deleted" | null;
  isEdited: (row: number, column: number) => boolean;
};

type CellEditor = SelectedCell & { text: string };

type ResultGridProps = {
  columns: ResultColumn[];
  rows: Cell[][];
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore?: () => void;
  sort?: Sort | null;
  onSortChange?: (column: string) => void;
  selected: SelectedCell | null;
  onSelect: (cell: SelectedCell) => void;
  editing?: GridEditing;
};

const COLUMN_WIDTH = 180;
const ROW_HEIGHT = 28;
/** start fetching the next batch when this close to the end */
const LOAD_MORE_THRESHOLD = 50;

export function ResultGrid({
  columns,
  rows,
  hasMore,
  isLoadingMore,
  onLoadMore,
  sort,
  onSortChange,
  selected,
  onSelect,
  editing
}: ResultGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<CellEditor | null>(null);

  function startEditing(row: number, column: number) {
    if (editing?.canEdit(row, column)) {
      setEditor({ row, column, text: editing.textFor(row, column) });
    }
  }

  function commit() {
    if (editor && editing) {
      editing.onCommit(editor.row, editor.column, editor.text);
    }
    setEditor(null);
  }
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    // jsdom (tests) has no layout; real windows measure the element
    initialRect: { width: 1024, height: 600 }
  });
  const items = virtualizer.getVirtualItems();
  const lastVisible = items.at(-1)?.index ?? -1;

  useEffect(() => {
    if (
      onLoadMore &&
      hasMore &&
      !isLoadingMore &&
      lastVisible >= rows.length - LOAD_MORE_THRESHOLD
    ) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, isLoadingMore, lastVisible, rows.length]);

  const width = columns.length * COLUMN_WIDTH;

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-rowcount={rows.length}
      className="relative h-full overflow-auto font-mono text-xs"
    >
      <div role="row" className="sticky top-0 z-10 flex border-b bg-muted" style={{ width }}>
        {columns.map((column, index) => {
          const sortedHere = sort?.column === column.name ? sort.direction : null;
          const label = (
            <>
              <span className="truncate font-semibold">{column.name}</span>
              <span className="truncate text-muted-foreground">{column.typeName}</span>
              {sortedHere === "asc" && (
                <ArrowUp className="size-3 shrink-0" aria-label="crescente" />
              )}
              {sortedHere === "desc" && (
                <ArrowDown className="size-3 shrink-0" aria-label="decrescente" />
              )}
            </>
          );
          return (
            // columns are fixed for a result and names may repeat (SELECT 1, 1)
            <div
              key={`${index}:${column.name}`}
              role="columnheader"
              style={{ width: COLUMN_WIDTH }}
              className="shrink-0 border-r"
            >
              {onSortChange ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-background"
                  onClick={() => onSortChange(column.name)}
                >
                  {label}
                </button>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-1.5">{label}</div>
              )}
            </div>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="p-3 font-sans text-sm text-muted-foreground">Nenhuma linha.</p>
      ) : (
        <div className="relative" style={{ height: virtualizer.getTotalSize(), width }}>
          {items.map(item => {
            const status = editing?.rowStatus(item.index) ?? null;
            return (
              // result rows are append-only and immutable: their position is their identity
              <div
                key={item.key}
                role="row"
                aria-rowindex={item.index + 1}
                data-status={status ?? undefined}
                className={cn(
                  "absolute top-0 left-0 flex border-b",
                  status === "new" && "bg-emerald-50 dark:bg-emerald-950/40",
                  status === "deleted" &&
                    "bg-red-50 text-muted-foreground line-through dark:bg-red-950/40"
                )}
                style={{ height: ROW_HEIGHT, width, transform: `translateY(${item.start}px)` }}
              >
                {rows[item.index].map((cell, columnIndex) => {
                  const isSelected =
                    selected?.row === item.index && selected.column === columnIndex;
                  const isEditing = editor?.row === item.index && editor.column === columnIndex;
                  const isEdited = editing?.isEdited(item.index, columnIndex) ?? false;
                  return (
                    <div
                      key={`${columnIndex}:${columns[columnIndex]?.name}`}
                      role="gridcell"
                      aria-selected={isSelected}
                      data-edited={isEdited || undefined}
                      onClick={() => onSelect({ row: item.index, column: columnIndex })}
                      onDoubleClick={() => startEditing(item.index, columnIndex)}
                      style={{ width: COLUMN_WIDTH }}
                      className={cn(
                        "shrink-0 cursor-default truncate border-r px-2 leading-7",
                        isNumeric(cell) && "text-right",
                        cell.t === "null" && "text-muted-foreground italic",
                        cell.t === "unknown" && "text-muted-foreground",
                        isEdited && "bg-amber-100 dark:bg-amber-900/40",
                        isSelected &&
                          "bg-primary/10 outline outline-1 -outline-offset-1 outline-primary"
                      )}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          aria-label={`Editar ${columns[columnIndex]?.name}`}
                          className="h-full w-full bg-background font-mono outline-none"
                          value={editor.text}
                          onChange={event => setEditor({ ...editor, text: event.target.value })}
                          onBlur={commit}
                          onKeyDown={event => {
                            if (event.key === "Enter") {
                              commit();
                            } else if (event.key === "Escape") {
                              setEditor(null);
                            }
                          }}
                        />
                      ) : (
                        gridText(cell)
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {isLoadingMore && (
        <p className="p-2 font-sans text-muted-foreground">Carregando mais linhas…</p>
      )}
    </div>
  );
}

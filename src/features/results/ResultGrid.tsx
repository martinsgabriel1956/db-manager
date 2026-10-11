import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
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

/** Where a navigation key moves the selection; null = the key is not a grid move. */
function moveSelection(
  key: string,
  ctrlKey: boolean,
  from: SelectedCell,
  rowCount: number,
  columnCount: number,
  pageRows: number
): SelectedCell | null {
  const lastRow = rowCount - 1;
  const lastColumn = columnCount - 1;
  const clampRow = (row: number) => Math.min(lastRow, Math.max(0, row));
  switch (key) {
    case "ArrowUp":
      return { ...from, row: clampRow(from.row - 1) };
    case "ArrowDown":
      return { ...from, row: clampRow(from.row + 1) };
    case "ArrowLeft":
      return { ...from, column: Math.max(0, from.column - 1) };
    case "ArrowRight":
      return { ...from, column: Math.min(lastColumn, from.column + 1) };
    case "PageUp":
      return { ...from, row: clampRow(from.row - pageRows) };
    case "PageDown":
      return { ...from, row: clampRow(from.row + pageRows) };
    case "Home":
      return ctrlKey ? { row: 0, column: 0 } : { ...from, column: 0 };
    case "End":
      return ctrlKey ? { row: lastRow, column: lastColumn } : { ...from, column: lastColumn };
    default:
      return null;
  }
}

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
  const headerRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<CellEditor | null>(null);
  /** Escape closes the inline input without the blur that follows committing it */
  const cancelEdit = useRef(false);
  const cellIdPrefix = useId();
  const cellId = (cell: SelectedCell) => `${cellIdPrefix}-${cell.row}-${cell.column}`;

  function startEditing(row: number, column: number) {
    if (editing?.canEdit(row, column)) {
      setEditor({ row, column, text: editing.textFor(row, column) });
    }
  }

  function commit() {
    if (cancelEdit.current) {
      cancelEdit.current = false;
    } else if (editor && editing) {
      editing.onCommit(editor.row, editor.column, editor.text);
    }
    setEditor(null);
  }

  /** Scrolls just enough to show the cell below the sticky header. */
  function reveal({ row, column }: SelectedCell) {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const header = headerRef.current?.offsetHeight ?? 0;
    const top = row * ROW_HEIGHT;
    const visibleRows = element.clientHeight - header;
    if (top < element.scrollTop) {
      element.scrollTop = top;
    } else if (top + ROW_HEIGHT > element.scrollTop + visibleRows) {
      element.scrollTop = top + ROW_HEIGHT - visibleRows;
    }
    const left = column * COLUMN_WIDTH;
    if (left < element.scrollLeft) {
      element.scrollLeft = left;
    } else if (left + COLUMN_WIDTH > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = left + COLUMN_WIDTH - element.clientWidth;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // keys typed into the inline input belong to the input
    if (event.target !== event.currentTarget || rows.length === 0 || columns.length === 0) {
      return;
    }
    if (selected && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      startEditing(selected.row, selected.column);
      return;
    }
    const pageRows = Math.max(
      1,
      Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1
    );
    const next = selected
      ? moveSelection(
          event.key,
          event.ctrlKey || event.metaKey,
          selected,
          rows.length,
          columns.length,
          pageRows
        )
      : event.key.startsWith("Arrow")
        ? { row: 0, column: 0 }
        : null;
    if (next) {
      event.preventDefault();
      onSelect(next);
      reveal(next);
    }
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
      aria-label="Resultado"
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length}
      aria-activedescendant={selected && !editor ? cellId(selected) : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="relative h-full overflow-auto font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div
        ref={headerRef}
        role="row"
        aria-rowindex={1}
        className="sticky top-0 z-10 flex border-b bg-muted"
        style={{ width }}
      >
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
              aria-sort={
                sortedHere === "asc"
                  ? "ascending"
                  : sortedHere === "desc"
                    ? "descending"
                    : onSortChange
                      ? "none"
                      : undefined
              }
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
                aria-rowindex={item.index + 2}
                data-status={status ?? undefined}
                className={cn(
                  "absolute top-0 left-0 flex border-b",
                  status === "new" && "bg-success/10",
                  status === "deleted" && "bg-destructive/10 text-muted-foreground line-through"
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
                      id={cellId({ row: item.index, column: columnIndex })}
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
                        isEdited && "opened-hatch",
                        isSelected &&
                          "bg-select/10 outline outline-2 -outline-offset-2 outline-select"
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
                            // handing focus back to the grid blurs the input, which commits
                            if (event.key === "Enter") {
                              event.preventDefault();
                              scrollRef.current?.focus();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelEdit.current = true;
                              scrollRef.current?.focus();
                            }
                          }}
                        />
                      ) : (
                        <>
                          {gridText(cell)}
                          {columnIndex === 0 && status === "new" && (
                            <span className="sr-only"> (linha nova, não salva)</span>
                          )}
                          {columnIndex === 0 && status === "deleted" && (
                            <span className="sr-only"> (linha marcada para exclusão)</span>
                          )}
                          {isEdited && <span className="sr-only"> (alteração pendente)</span>}
                        </>
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

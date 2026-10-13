import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
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
  /** just saved: the hatch develops away */
  isDeveloping?: (row: number, column: number) => boolean;
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
  /** null clears the selection (and closes the cell detail) */
  onSelect: (cell: SelectedCell | null) => void;
  editing?: GridEditing;
  /** said when Enter, F2 or a double click meets a cell that cannot be edited */
  readOnlyHint?: string;
};

const COLUMN_WIDTH = 180;
const ROW_HEIGHT = 28;
/** start fetching the next batch when this close to the end */
const LOAD_MORE_THRESHOLD = 50;

/**
 * The visible range plus the selected and edited cells' row or column: the
 * active descendant must exist, and an open inline input must not unmount.
 */
function keepMounted(range: Range, extras: (number | undefined)[]): number[] {
  const indexes = defaultRangeExtractor(range);
  const missing = extras.filter(
    (index): index is number =>
      index !== undefined && index < range.count && !indexes.includes(index)
  );
  return missing.length === 0
    ? indexes
    : [...new Set([...indexes, ...missing])].sort((a, b) => a - b);
}

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
  editing,
  readOnlyHint = "Esta célula não pode ser editada"
}: ResultGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<CellEditor | null>(null);
  /** Escape closes the inline input without the blur that follows committing it */
  const cancelEdit = useRef(false);
  const cellIdPrefix = useId();
  const cellId = (cell: SelectedCell) => `${cellIdPrefix}-${cell.row}-${cell.column}`;

  const [refusal, setRefusal] = useState("");

  function startEditing(row: number, column: number) {
    if (editing?.canEdit(row, column)) {
      setRefusal("");
      setEditor({ row, column, text: editing.textFor(row, column) });
    } else {
      // an edit attempt that does nothing must still say why
      setRefusal(readOnlyHint);
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
    if (selected && event.key === "Escape") {
      event.preventDefault();
      onSelect(null);
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
    rangeExtractor: range => keepMounted(range, [selected?.row, editor?.row]),
    // jsdom (tests) has no layout; real windows measure the element
    initialRect: { width: 1024, height: 600 }
  });
  // wide tables (100+ columns) render only the columns in view, like the rows
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COLUMN_WIDTH,
    overscan: 3,
    rangeExtractor: range => keepMounted(range, [selected?.column, editor?.column]),
    initialRect: { width: 1024, height: 600 }
  });
  const items = virtualizer.getVirtualItems();
  const visibleColumns = columnVirtualizer.getVirtualItems();
  const firstColumn = visibleColumns[0]?.index ?? 0;
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
    <>
      {/* a polite live region, not a status landmark: the results bar owns that role */}
      <p aria-live="polite" className="sr-only">
        {refusal}
      </p>
      <div
        ref={scrollRef}
        role="grid"
        aria-label="Resultado"
        // -1: the total is unknown while more rows can still load
        aria-rowcount={hasMore ? -1 : rows.length + 1}
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
          className="sticky top-0 z-10 h-7 border-b border-foreground bg-muted"
          style={{ width }}
        >
          {visibleColumns.map(({ index, start }) => {
            const column = columns[index];
            const sortedHere = sort?.column === column.name ? sort.direction : null;
            const label = (
              <>
                <span className="truncate font-semibold">{column.name}</span>
                <span className="truncate text-muted-foreground">{column.typeName}</span>
                {sortedHere === "asc" && (
                  <ArrowUp className="size-3 shrink-0 text-filter" aria-label="crescente" />
                )}
                {sortedHere === "desc" && (
                  <ArrowDown className="size-3 shrink-0 text-filter" aria-label="decrescente" />
                )}
              </>
            );
            return (
              // columns are fixed for a result and names may repeat (SELECT 1, 1)
              <div
                key={`${index}:${column.name}`}
                role="columnheader"
                aria-colindex={index + 1}
                aria-sort={
                  sortedHere === "asc"
                    ? "ascending"
                    : sortedHere === "desc"
                      ? "descending"
                      : onSortChange
                        ? "none"
                        : undefined
                }
                style={{ width: COLUMN_WIDTH, left: start }}
                // sorting is filtration: magenta rule under the sorted column
                className={cn(
                  "absolute top-0 h-full border-r",
                  sortedHere && "shadow-[inset_0_-2px_0_var(--filter)]"
                )}
              >
                {onSortChange ? (
                  <button
                    type="button"
                    className="flex h-full w-full items-center gap-1.5 px-2 text-left outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    // the cycle is otherwise invisible until tried
                    title="Ordenar: crescente → decrescente → sem ordenação"
                    onClick={() => onSortChange(column.name)}
                  >
                    {label}
                  </button>
                ) : (
                  <div className="flex h-full items-center gap-1.5 px-2">{label}</div>
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
                    "absolute top-0 left-0 border-b",
                    // the hatch alone is under 3:1: a solid rule carries the "new" state
                    status === "new" &&
                      "hatch-band bg-success/10 shadow-[inset_0_-2px_0_var(--success)]",
                    status === "deleted" &&
                      "cross-hatch-band text-muted-foreground line-through decoration-foreground/70 decoration-[1.5px]"
                  )}
                  style={{ height: ROW_HEIGHT, width, transform: `translateY(${item.start}px)` }}
                >
                  {visibleColumns.map(({ index: columnIndex, start }) => {
                    const cell = rows[item.index][columnIndex];
                    const isSelected =
                      selected?.row === item.index && selected.column === columnIndex;
                    const isEditing = editor?.row === item.index && editor.column === columnIndex;
                    const isEdited = editing?.isEdited(item.index, columnIndex) ?? false;
                    const isDeveloping = editing?.isDeveloping?.(item.index, columnIndex) ?? false;
                    return (
                      <div
                        key={`${columnIndex}:${columns[columnIndex]?.name}`}
                        id={cellId({ row: item.index, column: columnIndex })}
                        role="gridcell"
                        aria-colindex={columnIndex + 1}
                        aria-selected={isSelected}
                        data-edited={isEdited || undefined}
                        onClick={() => onSelect({ row: item.index, column: columnIndex })}
                        onDoubleClick={() => startEditing(item.index, columnIndex)}
                        style={{ width: COLUMN_WIDTH, left: start }}
                        className={cn(
                          "absolute top-0 h-full cursor-default truncate border-r px-2 leading-7",
                          isNumeric(cell) && "text-right",
                          cell.t === "null" && "text-muted-foreground italic",
                          cell.t === "unknown" && "text-muted-foreground",
                          isEdited && "hatch-band shadow-[inset_0_-2px_0_var(--foreground)]",
                          isDeveloping && "developed",
                          isSelected && "bg-select/10 outline-2 -outline-offset-2 outline-select"
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
                            {/* the row's state is read once, on its first cell in view */}
                            {columnIndex === firstColumn && status === "new" && (
                              <span className="sr-only"> (linha nova, não salva)</span>
                            )}
                            {columnIndex === firstColumn && status === "deleted" && (
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
    </>
  );
}

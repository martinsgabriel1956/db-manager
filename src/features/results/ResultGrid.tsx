import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Cell, ResultColumn, Sort } from "@/bindings";
import { formatCell, gridText, isNumeric } from "@/features/results/format";
import { cn } from "@/lib/utils";

export type SelectedCell = { row: number; column: number };

/** Inline editing hooks; without them the grid is read-only. */
export type GridEditing = {
  canEdit: (row: number, column: number) => boolean;
  /** value the inline input starts from; null is NULL, shown as a placeholder */
  textFor: (row: number, column: number) => string | null;
  /** null writes NULL */
  onCommit: (row: number, column: number, value: string | null) => void;
  rowStatus: (row: number) => "new" | "deleted" | null;
  isEdited: (row: number, column: number) => boolean;
  /** just saved: the hatch develops away */
  isDeveloping?: (row: number, column: number) => boolean;
};

/** `value` is null while the cell holds NULL; `initial` is what editing started from. */
type CellEditor = SelectedCell & { value: string | null; initial: string | null };

type ResultGridProps = {
  columns: ResultColumn[];
  rows: Cell[][];
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore?: () => void;
  sort?: Sort | null;
  onSortChange?: (column: string) => void;
  /** id of the text saying why sorting is locked right now (staged edits) */
  sortLockedBy?: string;
  selected: SelectedCell | null;
  /** null clears the selection (and closes the cell detail) */
  onSelect: (cell: SelectedCell | null) => void;
  editing?: GridEditing;
  /** said when Enter, F2 or a double click meets a cell that cannot be edited */
  readOnlyHint?: string;
  /** what the grid shows, e.g. the table name */
  label?: string;
  /** Space toggles the full-value panel; Escape closes it before clearing the selection */
  detailOpen?: boolean;
  onToggleDetail?: () => void;
};

const ROW_HEIGHT = 28;
/** column widths snap to the construction grid's 14px cell */
const GRID_CELL = 14;
const MIN_COLUMN_WIDTH = 4 * GRID_CELL;
/** fitting stops here so one long JSON cannot push the rest out of view... */
const MAX_FITTED_WIDTH = 26 * GRID_CELL;
/** ...but a column you widen yourself may go further */
const MAX_COLUMN_WIDTH = 100 * GRID_CELL;
/** Spline Sans Mono advances 0.6em: 7.2px at the grid's 12px */
const CHAR_WIDTH = 7.2;
/** px-2 on both sides, the 1px rule, and the header's sort arrow with its gap */
const CELL_CHROME = 16 + 1 + 18;
/** enough rows to see the shape of a column without measuring a whole page */
const FIT_SAMPLE_ROWS = 50;
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

function clampWidth(width: number, max = MAX_COLUMN_WIDTH): number {
  const snapped = Math.ceil(width / GRID_CELL) * GRID_CELL;
  return Math.min(max, Math.max(MIN_COLUMN_WIDTH, snapped));
}

/**
 * Each column as wide as its header or its longest value among the first rows,
 * snapped to the 14px grid and capped: a short id stays narrow, a long JSON shows
 * what fits and the detail panel holds the rest.
 */
export function fitColumnWidths(columns: ResultColumn[], rows: Cell[][]): number[] {
  const sample = rows.slice(0, FIT_SAMPLE_ROWS);
  return columns.map((column, index) => {
    const header = column.name.length + 1 + column.typeName.length;
    const longest = sample.reduce(
      (max, row) => Math.max(max, row[index] ? formatCell(row[index]).length : 0),
      header
    );
    return clampWidth(longest * CHAR_WIDTH + CELL_CHROME, MAX_FITTED_WIDTH);
  });
}

/** Where a navigation key moves the selection; null = the key is not a grid move. */
/** Ctrl+Shift+N: the cell becomes NULL, from the grid or inside the inline input. */
function isSetNull(event: KeyboardEvent<HTMLElement>): boolean {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n";
}

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
  sortLockedBy,
  selected,
  onSelect,
  editing,
  readOnlyHint = "Esta célula não pode ser editada",
  label = "Resultado",
  detailOpen = false,
  onToggleDetail
}: ResultGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // fitted once per column set: paging or loading more rows keeps the widths you dragged
  const signature = columns.map(column => `${column.name}:${column.typeName}`).join("\u0000");
  const [fitted, setFitted] = useState(() => ({
    signature,
    widths: fitColumnWidths(columns, rows)
  }));
  let widths = fitted.widths;
  if (fitted.signature !== signature) {
    widths = fitColumnWidths(columns, rows);
    setFitted({ signature, widths });
  }
  const resizeFrom = useRef<{ column: number; x: number; width: number } | null>(null);

  function setWidth(column: number, width: number) {
    setFitted(prev => ({
      ...prev,
      widths: prev.widths.map((current, index) => (index === column ? clampWidth(width) : current))
    }));
  }
  const headerRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<CellEditor | null>(null);
  /** Escape closes the inline input without the blur that follows committing it */
  const cancelEdit = useRef(false);
  const cellIdPrefix = useId();
  const cellId = (cell: SelectedCell) => `${cellIdPrefix}-${cell.row}-${cell.column}`;

  const [refusal, setRefusal] = useState("");
  /** said aloud only: the value panel opening or closing from the keyboard */
  const [announcement, setAnnouncement] = useState("");
  // the refusal speaks of the cell it was asked of: moving on clears it
  useEffect(() => {
    setRefusal("");
    setAnnouncement("");
  }, [selected?.row, selected?.column]);
  // what the keys do here, read with the grid's name: otherwise only the Legenda says it
  const keysId = `${cellIdPrefix}-keys`;
  const keys = [
    editing ? "Enter ou F2 edita a célula, Ctrl+Shift+N define NULL" : null,
    onToggleDetail ? "Espaço mostra o valor inteiro" : null,
    "Alt+← → ajusta a largura da coluna"
  ].filter(Boolean);

  function toggleDetail() {
    onToggleDetail?.();
    setAnnouncement(
      detailOpen ? "Painel do valor fechado" : "Painel do valor aberto ao lado da grade"
    );
  }

  function startEditing(row: number, column: number) {
    if (editing?.canEdit(row, column)) {
      setRefusal("");
      const initial = editing.textFor(row, column);
      setEditor({ row, column, value: initial, initial });
    } else {
      // an edit attempt that does nothing must still say why, every time: a repeat
      // changes the text by a space so the live region speaks again
      setRefusal(prev => (prev === readOnlyHint ? `${readOnlyHint}\u00a0` : readOnlyHint));
    }
  }

  /** NULL straight from the keyboard, without opening the value panel. */
  function setNull(row: number, column: number) {
    if (editing?.canEdit(row, column)) {
      editing.onCommit(row, column, null);
    } else {
      startEditing(row, column);
    }
  }

  function commit() {
    if (cancelEdit.current) {
      cancelEdit.current = false;
    } else if (editor && editing && editor.value !== editor.initial) {
      // Enter on an untouched cell stages nothing: opening a NULL must not write ''
      editing.onCommit(editor.row, editor.column, editor.value);
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
    const left = widths.slice(0, column).reduce((sum, width) => sum + width, 0);
    const columnWidth = widths[column] ?? 0;
    if (left < element.scrollLeft) {
      element.scrollLeft = left;
    } else if (left + columnWidth > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = left + columnWidth - element.clientWidth;
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
    if (selected && isSetNull(event)) {
      event.preventDefault();
      setNull(selected.row, selected.column);
      return;
    }
    if (selected && event.key === " " && onToggleDetail) {
      event.preventDefault();
      toggleDetail();
      return;
    }
    if (selected && event.key === "Escape") {
      event.preventDefault();
      if (detailOpen && onToggleDetail) {
        toggleDetail();
      } else {
        onSelect(null);
      }
      return;
    }
    // Alt+← → narrows or widens the selected column by one grid cell
    if (selected && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -GRID_CELL : GRID_CELL;
      setWidth(selected.column, (widths[selected.column] ?? MIN_COLUMN_WIDTH) + step);
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
    estimateSize: index => widths[index] ?? MIN_COLUMN_WIDTH,
    overscan: 3,
    rangeExtractor: range => keepMounted(range, [selected?.column, editor?.column]),
    initialRect: { width: 1024, height: 600 }
  });
  // the virtualizer caches sizes: a fitted or dragged width must be measured again
  useEffect(() => columnVirtualizer.measure(), [columnVirtualizer, widths]);
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

  const width = widths.reduce((sum, columnWidth) => sum + columnWidth, 0);

  return (
    <div className="relative h-full">
      {/* a polite live region, not a status landmark: the results bar owns that role. Shown
          too, over the grid's corner in the "retido" dotted outline, until the selection moves */}
      <p
        aria-live="polite"
        className={
          refusal
            ? "pointer-events-none absolute bottom-2 left-2 z-20 max-w-[calc(100%-1rem)] border border-dotted border-foreground bg-background px-2 py-1 text-xs"
            : "sr-only"
        }
      >
        {refusal}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p id={keysId} hidden>
        {keys.join("; ")}.
      </p>
      <div
        ref={scrollRef}
        role="grid"
        aria-label={label}
        aria-describedby={keysId}
        aria-keyshortcuts={[
          editing ? "Enter F2" : null,
          onToggleDetail ? "Space" : null,
          "Alt+ArrowLeft Alt+ArrowRight"
        ]
          .filter(Boolean)
          .join(" ")}
        // -1: the total is unknown while more rows can still load
        aria-rowcount={hasMore ? -1 : rows.length + 1}
        aria-colcount={columns.length}
        aria-activedescendant={selected && !editor ? cellId(selected) : undefined}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative h-full overflow-auto font-mono text-xs outline-none select-none",
          // with a cell selected, its blue outline is where focus is: one mark, not two
          !selected && "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        )}
      >
        <div
          ref={headerRef}
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-10 h-7 border-b border-foreground bg-muted"
          style={{ width }}
        >
          {visibleColumns.map(({ index, start, size }) => {
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
                style={{ width: size, left: start }}
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
                ) : sortLockedBy ? (
                  // still reachable, so the reason is read where the sort was tried
                  <button
                    type="button"
                    aria-disabled
                    aria-describedby={sortLockedBy}
                    className="flex h-full w-full cursor-not-allowed items-center gap-1.5 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    {label}
                  </button>
                ) : (
                  <div className="flex h-full items-center gap-1.5 px-2">{label}</div>
                )}
                {/* drag the rule to resize, double click to fit again; the keyboard has Alt+← → */}
                <span
                  aria-hidden
                  title="Arraste para ajustar a largura; duplo clique reajusta ao conteúdo"
                  className="absolute inset-y-0 -right-[3px] z-10 w-[5px] cursor-col-resize touch-none hover:bg-foreground active:bg-foreground"
                  onDoubleClick={() =>
                    setWidth(
                      index,
                      fitColumnWidths(
                        [column],
                        rows.map(row => [row[index]])
                      )[0]
                    )
                  }
                  onPointerDown={event => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    resizeFrom.current = { column: index, x: event.clientX, width: size };
                  }}
                  onPointerMove={event => {
                    const from = resizeFrom.current;
                    if (from) {
                      setWidth(from.column, from.width + event.clientX - from.x);
                    }
                  }}
                  // a drag ends however the pointer goes: released, cancelled or captured away
                  onPointerUp={() => {
                    resizeFrom.current = null;
                  }}
                  onPointerCancel={() => {
                    resizeFrom.current = null;
                  }}
                  onLostPointerCapture={() => {
                    resizeFrom.current = null;
                  }}
                />
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
                  {visibleColumns.map(({ index: columnIndex, start, size }) => {
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
                        style={{ width: size, left: start }}
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
                            className="h-full w-full bg-background font-mono outline-none placeholder:text-muted-foreground placeholder:italic"
                            value={editor.value ?? ""}
                            placeholder={editor.value === null ? "NULL" : undefined}
                            onChange={event => setEditor({ ...editor, value: event.target.value })}
                            onBlur={commit}
                            onKeyDown={event => {
                              // handing focus back to the grid blurs the input, which commits
                              if (event.key === "Enter") {
                                event.preventDefault();
                                scrollRef.current?.focus();
                              } else if (isSetNull(event)) {
                                event.preventDefault();
                                setEditor({ ...editor, value: null });
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
    </div>
  );
}

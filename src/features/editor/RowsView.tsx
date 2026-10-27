import { useRef, useState, type ReactNode } from "react";
import { commands, type Cell, type ResultColumn } from "@/bindings";
import { ExportButton } from "@/features/export/ExportButton";
import { connected } from "@/features/explorer/queries";
import {
  CellDetail,
  DetailSplit,
  DetailToggle,
  useCellDetail
} from "@/features/results/CellDetail";
import { CopyRowsMenu } from "@/features/results/CopyRowsMenu";
import { ResultGrid, type SelectedCell } from "@/features/results/ResultGrid";

type RowsViewProps = {
  connectionId: string;
  /** the script behind the rows, re-run by the export */
  sql: string;
  columns: ResultColumn[];
  rows: Cell[][];
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  onLoadMore: () => void;
  /** said above the grid, e.g. that an earlier result kept only its first batch */
  notice: string | null;
  /** the statement the export re-runs up to; null for the last one */
  exportStatement: number | null;
  /** the run's receipt, at the start of the bar */
  receipt: ReactNode;
  /** dims the receipt: it does not belong to a confirmed run */
  muted: boolean;
};

/** One result of the editor: the grid, its value panel, copy and export. */
export function RowsView({
  connectionId,
  sql,
  columns,
  rows,
  hasMore,
  loadingMore,
  loadError,
  onLoadMore,
  notice,
  exportStatement,
  receipt,
  muted
}: RowsViewProps) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  // opens by itself on JSON and long text, otherwise on demand (Space or Valor)
  const detail = useCellDetail();
  const detailOpen = detail.open;
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const selectedCell = selected && rows[selected.row]?.[selected.column];

  return (
    <div className="flex h-full flex-col">
      <div className="@container flex items-center gap-2 border-b bg-muted px-3 py-1">
        <div
          role="status"
          className={`flex min-w-0 items-center gap-2 text-xs ${muted ? "text-muted-foreground" : ""}`}
        >
          {receipt}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <DetailToggle open={detailOpen} onToggle={detail.toggle} />
          <CopyRowsMenu columns={columns} rows={rows} selectedRow={selected?.row ?? null} />
          <ExportButton
            baseName="resultado"
            formats={[
              {
                id: "csv",
                label: "CSV",
                extension: "csv",
                run: (path, runId) =>
                  connected(connectionId, () =>
                    commands.exportQuery(connectionId, runId, sql, path, exportStatement)
                  )
              }
            ]}
          />
        </div>
      </div>
      {notice && <p className="border-b px-3 py-1 text-sm text-muted-foreground">{notice}</p>}
      {loadError && (
        <p role="alert" className="border-b px-3 py-1 text-sm text-destructive">
          {loadError}
        </p>
      )}
      <div ref={gridAreaRef} className="flex min-h-0 flex-1">
        <DetailSplit
          detail={
            detailOpen && (
              <CellDetail
                column={selected ? (columns[selected.column] ?? null) : null}
                cell={selectedCell ?? null}
                onClose={() => {
                  detail.close();
                  gridAreaRef.current?.querySelector<HTMLElement>("[role='grid']")?.focus();
                }}
              />
            )
          }
        >
          <ResultGrid
            columns={columns}
            rows={rows}
            hasMore={hasMore}
            isLoadingMore={loadingMore}
            onLoadMore={onLoadMore}
            selected={selected}
            onSelect={next => {
              setSelected(next);
              if (next) {
                detail.reveal(columns[next.column], rows[next.row]?.[next.column]);
              }
            }}
            label="Resultado da query"
            detailOpen={detailOpen}
            onToggleDetail={detail.toggle}
            readOnlyHint="Resultado de query: somente leitura; para editar, abra a tabela"
          />
        </DetailSplit>
      </div>
    </div>
  );
}

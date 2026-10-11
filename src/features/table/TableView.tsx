import { useState } from "react";
import type { BrowseRequest, Filter, Sort } from "@/bindings";
import { Button } from "@/components/ui/button";
import { useBrowse, useStructure } from "@/features/explorer/queries";
import { CellDetail } from "@/features/results/CellDetail";
import { ResultGrid, type SelectedCell } from "@/features/results/ResultGrid";
import { BrowseToolbar } from "@/features/table/BrowseToolbar";
import { StructureView } from "@/features/table/StructureView";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type TableViewProps = { connectionId: string; schema: string; table: string };

type Tab = "data" | "structure";

export const PAGE_SIZE = 100;

/** asc → desc → no sort */
export function nextSort(current: Sort | null, column: string): Sort | null {
  if (current?.column !== column) {
    return { column, direction: "asc" };
  }
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

export function TableView({ connectionId, schema, table }: TableViewProps) {
  const [tab, setTab] = useState<Tab>("data");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b px-3">
        <h2 className="py-2 font-mono text-sm font-semibold">
          {schema}.{table}
        </h2>
        <div role="tablist" className="flex gap-1">
          {(["data", "structure"] as const).map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "border-b-2 px-2 py-2 text-sm",
                tab === id
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground"
              )}
            >
              {id === "data" ? "Dados" : "Estrutura"}
            </button>
          ))}
        </div>
      </div>
      {tab === "data" ? (
        <TableData connectionId={connectionId} schema={schema} table={table} />
      ) : (
        <StructureView connectionId={connectionId} schema={schema} table={table} />
      )}
    </div>
  );
}

function TableData({ connectionId, schema, table }: TableViewProps) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<Sort | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const structure = useStructure(connectionId, schema, table);

  const request: BrowseRequest = {
    schema,
    table,
    filters: filter ? [filter] : [],
    sort,
    page,
    pageSize: PAGE_SIZE
  };
  const browse = useBrowse(connectionId, request);
  const batch = browse.data;
  const selectedCell = selected && batch?.rows[selected.row]?.[selected.column];

  function restart(update: () => void) {
    update();
    setPage(0);
    setSelected(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BrowseToolbar
        columns={structure.data?.columns.map(column => column.name) ?? []}
        active={filter}
        onApply={next => restart(() => setFilter(next))}
        onClear={() => restart(() => setFilter(null))}
      />
      {browse.isError && (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {errorMessage(browse.error)}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {batch && (
            <ResultGrid
              columns={batch.columns}
              rows={batch.rows}
              hasMore={false}
              isLoadingMore={false}
              sort={sort}
              onSortChange={column => restart(() => setSort(prev => nextSort(prev, column)))}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {browse.isPending && <p className="p-3 text-sm text-muted-foreground">Carregando…</p>}
        </div>
        {selected && selectedCell && batch && (
          <CellDetail
            column={batch.columns[selected.column]}
            cell={selectedCell}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-sm">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0 || browse.isFetching}
          onClick={() => {
            setPage(prev => prev - 1);
            setSelected(null);
          }}
        >
          Anterior
        </Button>
        <span className="text-muted-foreground">Página {page + 1}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!batch?.hasMore || browse.isFetching}
          onClick={() => {
            setPage(prev => prev + 1);
            setSelected(null);
          }}
        >
          Próxima
        </Button>
        {browse.isFetching && <span className="text-xs text-muted-foreground">atualizando…</span>}
      </div>
    </div>
  );
}

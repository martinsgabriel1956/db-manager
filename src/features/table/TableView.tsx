import { useEffect, useState } from "react";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { commands, type BrowseRequest, type Filter, type Sort } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportButton } from "@/features/export/ExportButton";
import { connected, useBrowse, useStructure } from "@/features/explorer/queries";
import { CellDetail } from "@/features/results/CellDetail";
import { ResultGrid, type SelectedCell } from "@/features/results/ResultGrid";
import { BrowseToolbar } from "@/features/table/BrowseToolbar";
import { StructureView } from "@/features/table/StructureView";
import { useTableEditing } from "@/features/table/useTableEditing";
import { tableKey, useTabs } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";

type TableViewProps = { connectionId: string; schema: string; table: string; readOnly: boolean };

type TableDataProps = TableViewProps & {
  sort: Sort | null;
  filter: Filter | null;
  onSortChange: (update: (prev: Sort | null) => Sort | null) => void;
  onFilterChange: (filter: Filter | null) => void;
};

export const PAGE_SIZE = 100;

/** asc → desc → no sort */
export function nextSort(current: Sort | null, column: string): Sort | null {
  if (current?.column !== column) {
    return { column, direction: "asc" };
  }
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

export function TableView(props: TableViewProps) {
  const [tab, setTab] = useState("data");
  // owned here so the export matches what the grid shows
  const [sort, setSort] = useState<Sort | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
      <div className="flex items-center gap-5 border-b border-foreground bg-background px-4">
        {/* a long identifier wraps: it is data, and a hover title is out of the keyboard's reach */}
        <h2 className="flex min-w-0 items-baseline py-2">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{props.schema}.</span>
          <span className="min-w-0 display text-[1.75rem] leading-[1.15] [overflow-wrap:anywhere]">
            {props.table}
          </span>
        </h2>
        <TabsList aria-label="Seções da tabela" className="shrink-0">
          <TabsTrigger value="data">Dados</TabsTrigger>
          <TabsTrigger value="structure">Estrutura</TabsTrigger>
        </TabsList>
        {props.readOnly && <Badge variant="held">Somente leitura</Badge>}
        <div className="ml-auto shrink-0">
          <ExportButton
            baseName={props.table}
            formats={[
              {
                id: "csv",
                label: "CSV",
                extension: "csv",
                run: (path, runId) =>
                  connected(props.connectionId, () =>
                    commands.exportTable(
                      props.connectionId,
                      runId,
                      {
                        schema: props.schema,
                        table: props.table,
                        filters: filter ? [filter] : [],
                        sort,
                        page: 0,
                        pageSize: PAGE_SIZE
                      },
                      path
                    )
                  )
              }
            ]}
          />
        </div>
      </div>
      {/* the data panel stays mounted: switching tabs must not drop staged edits */}
      <TabsContent value="data" forceMount className="flex min-h-0 flex-1 flex-col">
        <TableData
          {...props}
          sort={sort}
          filter={filter}
          onSortChange={setSort}
          onFilterChange={setFilter}
        />
      </TabsContent>
      <TabsContent value="structure" className="min-h-0 flex-1 overflow-auto">
        <StructureView
          connectionId={props.connectionId}
          schema={props.schema}
          table={props.table}
        />
      </TabsContent>
    </Tabs>
  );
}

function TableData({
  connectionId,
  schema,
  table,
  readOnly,
  sort,
  filter,
  onSortChange,
  onFilterChange
}: TableDataProps) {
  const [page, setPage] = useState(0);
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
  const primaryKey =
    structure.data?.columns.filter(column => column.isPrimaryKey).map(column => column.name) ?? [];
  const edit = useTableEditing({ connectionId, schema, table, readOnly, batch, primaryKey });
  const dirty = edit.count > 0;
  const setPending = useTabs(state => state.setPending);

  // the tab shows the same Δ as the save button; closing the view clears it
  useEffect(() => {
    const key = tableKey({ connectionId, schema, table });
    setPending(key, edit.count);
    return () => setPending(key, 0);
  }, [connectionId, schema, table, edit.count, setPending]);

  const selectedCell = selected && edit.rows[selected.row]?.[selected.column];
  const selectedEditable = selected !== null && edit.editing.canEdit(selected.row, selected.column);

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
        disabled={dirty}
        onApply={next => restart(() => onFilterChange(next))}
        onClear={() => restart(() => onFilterChange(null))}
      />
      {batch && !readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-1.5 text-sm">
          {edit.canEdit ? (
            <>
              <Button size="sm" variant="outline" onClick={edit.addRow}>
                <Plus /> Adicionar linha
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selected === null}
                onClick={() => selected && edit.toggleRow(selected.row)}
              >
                {selected && edit.isDeleted(selected.row) ? (
                  <>
                    <Undo2 /> Restaurar linha
                  </>
                ) : (
                  <>
                    <Trash2 /> Excluir linha
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                Duplo clique ou Enter numa célula para editar
              </span>
            </>
          ) : (
            structure.isSuccess && (
              <span className="text-xs text-muted-foreground">
                Sem chave primária editável: tabela somente leitura
              </span>
            )
          )}
          {dirty && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium">
                {edit.count} {edit.count === 1 ? "alteração pendente" : "alterações pendentes"}
              </span>
              <Button size="sm" variant="outline" disabled={edit.saving} onClick={edit.discard}>
                Descartar
              </Button>
              {/* the save carries the exposure: how many staged changes it will develop */}
              <Button size="sm" disabled={edit.saving} onClick={edit.save} className="pr-0">
                Salvar
                <span
                  aria-hidden
                  className="ml-1.5 flex h-full items-center border-l border-primary-foreground/40 px-2 font-mono text-xs"
                >
                  Δ {edit.count}
                </span>
              </Button>
            </div>
          )}
          {edit.notice && !dirty && (
            <span role="status" className="ml-auto text-xs text-success developed">
              {edit.notice}
            </span>
          )}
        </div>
      )}
      {edit.saveError && (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {edit.saveError}
        </p>
      )}
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
              rows={edit.rows}
              hasMore={false}
              isLoadingMore={false}
              sort={sort}
              onSortChange={
                dirty
                  ? undefined
                  : column => restart(() => onSortChange(prev => nextSort(prev, column)))
              }
              selected={selected}
              onSelect={setSelected}
              editing={edit.editing}
            />
          )}
          {browse.isPending && <p className="p-3 text-sm text-muted-foreground">Carregando…</p>}
        </div>
        {selected && selectedCell && batch && (
          <CellDetail
            column={batch.columns[selected.column]}
            cell={selectedCell}
            onClose={() => setSelected(null)}
            onSetNull={
              selectedEditable
                ? () => edit.setValue(selected.row, selected.column, null)
                : undefined
            }
          />
        )}
      </div>
      <div className="flex items-center gap-2 border-t bg-muted px-3 py-1.5 text-sm">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0 || browse.isFetching || dirty}
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
          disabled={!batch?.hasMore || browse.isFetching || dirty}
          onClick={() => {
            setPage(prev => prev + 1);
            setSelected(null);
          }}
        >
          Próxima
        </Button>
        {dirty && (
          <span className="text-xs text-muted-foreground">
            Salve ou descarte para trocar de página, filtrar ou ordenar
          </span>
        )}
        {browse.isFetching && <span className="text-xs text-muted-foreground">atualizando…</span>}
      </div>
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={edit.confirmation}
        confirmLabel="Salvar"
        pending={edit.saving}
        onConfirm={edit.confirm}
        onCancel={edit.dismiss}
      />
    </div>
  );
}

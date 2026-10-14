import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, Undo2 } from "lucide-react";
import { commands, type BrowseRequest, type Filter, type Sort } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DiscardDialog } from "@/components/DiscardDialog";
import { Receipt } from "@/components/Receipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { useConnections } from "@/features/connections/queries";
import { ExportButton } from "@/features/export/ExportButton";
import { CopyRowsMenu } from "@/features/results/CopyRowsMenu";
import { connected, useBrowse, useStructure } from "@/features/explorer/queries";
import { CellDetail, DetailToggle } from "@/features/results/CellDetail";
import { ResultGrid, type SelectedCell } from "@/features/results/ResultGrid";
import { BrowseToolbar } from "@/features/table/BrowseToolbar";
import { StructureView } from "@/features/table/StructureView";
import { useTableEditing } from "@/features/table/useTableEditing";
import { tableKey, useTabs } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

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
        <div className="ml-auto flex min-w-0 items-center gap-4">
          <ConnectionContext connectionId={props.connectionId} />
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
  // the full value opens on demand (Space or Valor): the grid keeps its width meanwhile
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
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
  const options = Object.fromEntries(
    structure.data?.columns.map(column => [column.name, column.options]) ?? []
  );
  const edit = useTableEditing({
    connectionId,
    schema,
    table,
    readOnly,
    batch,
    primaryKey,
    options
  });
  const dirty = edit.count > 0;
  const setPending = useTabs(state => state.setPending);
  const connections = useConnections();
  // production keeps the words on its write buttons at any width: an icon alone is not enough there
  const isProd =
    connections.data?.find(candidate => candidate.id === connectionId)?.environment === "prod";
  const rowLabelClass = isProd ? "inline" : "hidden @min-[52rem]:inline";
  // with edits staged in a narrow window, Descartar and Salvar need the room: the add
  // button gives its word first, Excluir keeps it
  const addLabelClass = isProd && dirty ? "hidden @min-[52rem]:inline" : rowLabelClass;
  // the panel stays mounted behind other tabs: the saved notice belongs to the visit that saved
  const isActiveTab = useTabs(state => {
    const tab = state.tabs.find(open => open.id === state.activeId);
    return tab?.kind === "table" && tableKey(tab) === tableKey({ connectionId, schema, table });
  });
  const { clearNotice } = edit;
  useEffect(() => {
    if (!isActiveTab) {
      clearNotice();
    }
  }, [isActiveTab, clearNotice]);

  // the tab shows the same Δ as the save button; closing the view clears it
  useEffect(() => {
    const key = tableKey({ connectionId, schema, table });
    setPending(key, edit.count);
    return () => setPending(key, 0);
  }, [connectionId, schema, table, edit.count, setPending]);

  const selectedCell = selected && edit.rows[selected.row]?.[selected.column];
  const selectedEditable = selected !== null && edit.editing.canEdit(selected.row, selected.column);
  const pending = edit.count === 1 ? "1 alteração pendente" : `${edit.count} alterações pendentes`;
  const lockedId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const wasDirty = useRef(dirty);
  const focusGrid = () => rootRef.current?.querySelector<HTMLElement>("[role='grid']")?.focus();

  // Salvar and Descartar unmount once nothing is staged: focus that was on them goes back
  // to the grid it came from, not to <body>
  useEffect(() => {
    if (wasDirty.current && !dirty && document.activeElement === document.body) {
      focusGrid();
    }
    wasDirty.current = dirty;
  }, [dirty]);

  function restart(update: () => void) {
    update();
    setPage(0);
    setSelected(null);
    edit.clearNotice();
  }

  function goToPage(next: number) {
    setPage(next);
    setSelected(null);
    edit.clearNotice();
  }

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col"
      // Ctrl+S develops the staged edits from anywhere in this view (the grid, the detail)
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          if (dirty && !edit.saving) {
            edit.save();
          }
        }
      }}
    >
      <BrowseToolbar
        columns={structure.data?.columns.map(column => column.name) ?? []}
        active={filter}
        sort={sort}
        disabled={dirty}
        lockedBy={lockedId}
        onApply={next => restart(() => onFilterChange(next))}
        onClear={() => restart(() => onFilterChange(null))}
        onClearSort={() => restart(() => onSortChange(() => null))}
      />
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
              sortLockedBy={dirty ? lockedId : undefined}
              selected={selected}
              onSelect={setSelected}
              editing={edit.editing}
              label={`Linhas de ${table}`}
              detailOpen={detailOpen}
              onToggleDetail={() => setDetailOpen(prev => !prev)}
              readOnlyHint={
                readOnly
                  ? "Conexão somente leitura: a célula não pode ser editada"
                  : edit.canEdit
                    ? "Esta célula não pode ser editada: coluna sem edição (tipo não modelado) ou linha marcada para exclusão"
                    : "Tabela sem chave primária editável: somente leitura"
              }
            />
          )}
          {browse.isPending && (
            <p className="p-3 text-sm text-muted-foreground">Carregando linhas…</p>
          )}
        </div>
        {detailOpen && batch && (
          <CellDetail
            column={selected ? (batch.columns[selected.column] ?? null) : null}
            cell={selectedCell ?? null}
            onClose={() => {
              setDetailOpen(false);
              focusGrid();
            }}
            onSetNull={
              selected && selectedEditable
                ? () => edit.setValue(selected.row, selected.column, null)
                : undefined
            }
          />
        )}
      </div>
      {/* one status bar under the data: where you are in the pages, then what is staged.
          It sizes by its own width (the sidebar takes 240–288px): the hint goes first, then the
          labels; Descartar and Salvar never shrink */}
      <div className="@container border-t bg-muted">
        {dirty && (
          // the one fact while edits are staged gets its own line, read whole at any width:
          // the disabled pager, Aplicar and the sort headers point here for their reason
          <div className="flex flex-wrap items-baseline gap-x-2 border-b px-3 py-1 text-xs">
            {edit.cancelled && (
              // a cancelled save says so, as the editor does: nothing reached the database
              <span role="status">
                <span className="legend">Salvamento cancelado</span> · nada rodou no banco.
              </span>
            )}
            <p id={lockedId} className="text-foreground">
              Salve ou descarte as alterações para paginar, filtrar ou ordenar.
            </p>
          </div>
        )}
        {edit.notice?.confirmed && !dirty && (
          // a confirmed save closes its ritual with the editor's receipt, on a line of its own
          <p
            role="status"
            className="flex min-w-0 items-center gap-2 border-b px-3 py-1 text-xs developed"
          >
            <Receipt connectionId={connectionId} confirmed text={edit.notice.text} verb="salvo" />
          </p>
        )}
        <div className="flex items-center gap-3 px-3 py-1.5 text-sm">
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Página anterior"
              aria-describedby={dirty ? lockedId : undefined}
              disabled={page === 0 || browse.isFetching || dirty}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft />
            </Button>
            {/* locked on this page, the rows range gives its room to the reason why */}
            <span className="px-1.5 text-xs text-muted-foreground">
              {dirty
                ? `Página ${page + 1}`
                : pageLabel(page, batch?.rows.length ?? 0, batch?.hasMore ?? false)}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Próxima página"
              aria-describedby={dirty ? lockedId : undefined}
              disabled={!batch?.hasMore || browse.isFetching || dirty}
              onClick={() => goToPage(page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
          {!dirty && browse.isFetching && (
            <span className="text-xs text-muted-foreground">atualizando…</span>
          )}
          {batch && (
            <DetailToggle open={detailOpen} onToggle={() => setDetailOpen(prev => !prev)} />
          )}
          {batch && (
            <CopyRowsMenu
              columns={batch.columns}
              rows={batch.rows}
              // a row added in the grid is not stored yet: nothing to copy
              selectedRow={selected && selected.row < batch.rows.length ? selected.row : null}
              insert={rows =>
                connected(connectionId, () =>
                  commands.copyAsInsert(
                    connectionId,
                    schema,
                    table,
                    batch.columns.map(column => column.name),
                    rows
                  )
                )
              }
            />
          )}
          {batch && !readOnly && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {edit.canEdit ? (
                <>
                  {/* gone while edits are staged or the saved notice speaks; the short form
                      keeps the hint in the 960px window with the sidebar open */}
                  {!dirty && !edit.notice && (
                    <span
                      className={cn(
                        "hidden text-xs text-muted-foreground",
                        // in production the button words take this room first
                        isProd ? "@min-[60rem]:inline" : "@min-[40rem]:inline"
                      )}
                    >
                      <span className="@min-[56rem]:hidden">Enter edita a célula</span>
                      <span className="hidden @min-[56rem]:inline">
                        Duplo clique ou Enter edita a célula
                      </span>
                    </span>
                  )}
                  {/* words from 1100px; below, the icon and its name (read aloud and on hover) */}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Adicionar linha"
                    title="Adicionar linha"
                    onClick={edit.addRow}
                  >
                    <Plus />
                    <span className={addLabelClass}>Adicionar linha</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={
                      selected && edit.isDeleted(selected.row) ? "Restaurar linha" : "Excluir linha"
                    }
                    title={
                      selected && edit.isDeleted(selected.row) ? "Restaurar linha" : "Excluir linha"
                    }
                    disabled={selected === null}
                    onClick={() => selected && edit.toggleRow(selected.row)}
                  >
                    {selected && edit.isDeleted(selected.row) ? (
                      <>
                        <Undo2 />
                        <span className={rowLabelClass}>Restaurar linha</span>
                      </>
                    ) : (
                      <>
                        <Trash2 />
                        <span className={rowLabelClass}>Excluir linha</span>
                      </>
                    )}
                  </Button>
                </>
              ) : (
                structure.isSuccess && (
                  <span className="text-xs text-muted-foreground">
                    Sem chave primária editável: tabela somente leitura
                  </span>
                )
              )}
              {dirty && (
                <>
                  <span className="sr-only text-xs font-medium @min-[64rem]:not-sr-only">
                    {pending}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={edit.saving}
                    onClick={() => setConfirmingDiscard(true)}
                  >
                    Descartar
                  </Button>
                  {/* the save carries the exposure: how many staged changes it will develop */}
                  <Button
                    size="sm"
                    disabled={edit.saving}
                    aria-keyshortcuts="Control+S"
                    // the Δ is drawn, not read: the name says what the save will write
                    aria-label={`Salvar (${pending})`}
                    onClick={edit.save}
                    className="pr-0"
                  >
                    Salvar
                    <span
                      aria-hidden
                      className="ml-1.5 flex h-full items-center border-l border-primary-foreground/40 px-2 font-mono text-xs"
                    >
                      Δ {edit.count}
                    </span>
                  </Button>
                </>
              )}
              {/* the save develops: the hatch clears in the grid and the notice comes up the same way */}
              {edit.notice && !edit.notice.confirmed && !dirty && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-success developed"
                >
                  <Check aria-hidden className="size-4" />
                  {edit.notice.text}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={edit.confirmation}
        confirmLabel="Salvar"
        pending={edit.saving}
        onConfirm={edit.confirm}
        onCancel={edit.dismiss}
      />
      <DiscardDialog
        open={confirmingDiscard}
        subject={table}
        count={edit.count}
        consequence="Descartar desfaz todas"
        confirmLabel="Descartar alterações"
        onConfirm={() => {
          edit.discard();
          setConfirmingDiscard(false);
        }}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </div>
  );
}

/** "Página 2 · linhas 101–200": the total is unknown, so only "há mais" when there is a next page. */
export function pageLabel(page: number, rows: number, hasMore: boolean): string {
  if (rows === 0) {
    return `Página ${page + 1} · nenhuma linha`;
  }
  const first = page * PAGE_SIZE + 1;
  const range = `linhas ${first}–${first + rows - 1}`;
  return `Página ${page + 1} · ${range}${hasMore ? ", há mais" : ""}`;
}

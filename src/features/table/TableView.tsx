import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { ImportCsvButton } from "@/features/import/ImportCsvButton";
import { CopyRowsMenu } from "@/features/results/CopyRowsMenu";
import { connected, structureQuery, useBrowse, useStructure } from "@/features/explorer/queries";
import {
  CellDetail,
  DetailSplit,
  DetailToggle,
  useCellDetail
} from "@/features/results/CellDetail";
import { ResultGrid, type CellLink, type SelectedCell } from "@/features/results/ResultGrid";
import { BrowseToolbar } from "@/features/table/BrowseToolbar";
import {
  keyOfColumn,
  matchFilters,
  type Hop,
  type IncomingKey
} from "@/features/table/foreignKeys";
import { ReferencesMenu } from "@/features/table/ReferencesMenu";
import { RowCount } from "@/features/table/RowCount";
import { StructureView } from "@/features/table/StructureView";
import { useTableEditing } from "@/features/table/useTableEditing";
import { tableKey, useTabs } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";

type TableViewProps = { connectionId: string; schema: string; table: string; readOnly: boolean };

/** `initialFilters`: the filter a foreign key opened the table with */
type TableViewOwnProps = TableViewProps & { initialFilters?: Filter[] };

type TableDataProps = TableViewProps & {
  sort: Sort | null;
  filters: Filter[];
  onSortChange: (update: (prev: Sort | null) => Sort | null) => void;
  onFiltersChange: (filters: Filter[]) => void;
};

export const PAGE_SIZE = 100;

/** asc → desc → no sort */
export function nextSort(current: Sort | null, column: string): Sort | null {
  if (current?.column !== column) {
    return { column, direction: "asc" };
  }
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

export function TableView({ initialFilters = [], ...props }: TableViewOwnProps) {
  const [tab, setTab] = useState("data");
  // owned here so the export matches what the grid shows
  const [sort, setSort] = useState<Sort | null>(null);
  const [filters, setFilters] = useState<Filter[]>(initialFilters);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
      {/* wraps rather than clips: zoomed in (Ctrl+=) the connection and the actions drop to a
          second line, whole; py-1 here and on the title keeps one line at 48px */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-foreground bg-background px-4 py-1">
        {/* a long identifier wraps: it is data, and a hover title is out of the keyboard's reach;
            up to half the header it keeps its width, so the connection name truncates first and
            a short name never breaks mid-word */}
        <h2 className="flex max-w-1/2 shrink-0 items-baseline py-1">
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
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <ConnectionContext connectionId={props.connectionId} />
          {/* somente leitura: the database would refuse the INSERT anyway */}
          {!props.readOnly && (
            <ImportCsvButton
              connectionId={props.connectionId}
              schema={props.schema}
              table={props.table}
            />
          )}
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
                        filters,
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
          filters={filters}
          onSortChange={setSort}
          onFiltersChange={setFilters}
        />
      </TabsContent>
      <TabsContent value="structure" className="min-h-0 flex-1 overflow-auto">
        <StructureView
          connectionId={props.connectionId}
          schema={props.schema}
          table={props.table}
          readOnly={props.readOnly}
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
  filters,
  onSortChange,
  onFiltersChange
}: TableDataProps) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  // opens by itself on JSON and long text, otherwise on demand (Space or Valor)
  const detail = useCellDetail();
  const detailOpen = detail.open;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  /** following a key was refused (the other table holds staged edits) or failed */
  const [followError, setFollowError] = useState<string | null>(null);
  const structure = useStructure(connectionId, schema, table);
  const queryClient = useQueryClient();
  const followTable = useTabs(state => state.followTable);

  const request: BrowseRequest = {
    schema,
    table,
    filters,
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
  const rowLabelClass = isProd ? "inline" : "hidden @min-[62rem]:inline";
  // in a narrow window the add button gives its word first (in production too, at the
  // minimum width or with edits staged, when Descartar and Salvar need the room); Excluir keeps it
  const addLabelClass =
    isProd && !dirty ? "hidden @min-[47rem]:inline" : "hidden @min-[66rem]:inline";
  // one scale for both states, set by the crowded one (edits staged: Descartar and Salvar
  // in the bar), so starting an edit never reshapes the buttons under the cursor; the hint
  // takes their room while nothing is staged. Words give way in this order: hint, the write
  // buttons (not in production: + and the bin read alone), Valor, Referências, Copiar, the
  // estimate. So the default window (1200px, sidebar of 288px) names the row's tools
  const estimateClass = isProd ? "hidden @min-[58.5rem]:inline" : "hidden @min-[47rem]:inline";
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

  const foreignKeys = structure.data?.foreignKeys ?? [];
  /** a stored row: an added one is not saved, nothing points at it yet */
  const storedRow = (row: number) => batch?.rows[row] ?? null;
  const selectedStored = selected ? storedRow(selected.row) : null;

  function open(hop: Hop | null, keyName: string) {
    if (!hop) {
      setFollowError(`${keyName}: um dos valores é NULL ou não pode ser comparado`);
      return;
    }
    const target = { connectionId, schema: hop.schema, table: hop.table };
    setFollowError(
      followTable(target, hop.filters)
        ? null
        : `${hop.table} tem alterações pendentes: salve ou descarte lá antes de abrir com filtro.`
    );
  }

  /** A key's columns on the other side; SQLite may leave them implicit (its primary key). */
  async function keyColumns(otherSchema: string, otherTable: string, named: string[]) {
    if (named.length > 0) {
      return named;
    }
    const other = await queryClient.fetchQuery(
      structureQuery(connectionId, otherSchema, otherTable)
    );
    return other.columns.filter(column => column.isPrimaryKey).map(column => column.name);
  }

  async function follow(row: number, column: number) {
    const stored = storedRow(row);
    const key = batch ? keyOfColumn(foreignKeys, batch.columns[column].name) : null;
    if (!batch || !stored || !key) {
      return;
    }
    try {
      const to = await keyColumns(key.referencedSchema, key.referencedTable, key.referencedColumns);
      const filters = matchFilters(batch.columns, stored, key.columns, to);
      open(
        filters && { schema: key.referencedSchema, table: key.referencedTable, filters },
        key.name
      );
    } catch (err) {
      setFollowError(errorMessage(err));
    }
  }

  async function followBack(incoming: IncomingKey) {
    if (!batch || !selectedStored) {
      return;
    }
    try {
      const from = await keyColumns(schema, table, incoming.key.referencedColumns);
      const filters = matchFilters(batch.columns, selectedStored, from, incoming.key.columns);
      open(
        filters && { schema: incoming.schema, table: incoming.table, filters },
        incoming.key.name
      );
    } catch (err) {
      setFollowError(errorMessage(err));
    }
  }

  const link: CellLink = {
    label: (row, column) => {
      const stored = storedRow(row);
      const key = batch ? keyOfColumn(foreignKeys, batch.columns[column].name) : null;
      // a composite key with a NULL anywhere points at no row
      if (!batch || !stored || !key) {
        return null;
      }
      if (!matchFilters(batch.columns, stored, key.columns, key.columns)) {
        return null;
      }
      return `Abrir ${key.referencedTable} filtrada por ${key.columns.join(", ")}`;
    },
    follow: (row, column) => void follow(row, column)
  };

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
        // Alt+Shift+Enter: the rows elsewhere that point at the selected one
        if (event.altKey && event.shiftKey && event.key === "Enter" && selectedStored) {
          event.preventDefault();
          setReferencesOpen(true);
          return;
        }
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
        active={filters}
        sort={sort}
        disabled={dirty}
        lockedBy={lockedId}
        onChange={next => restart(() => onFiltersChange(next))}
        onClearSort={() => restart(() => onSortChange(() => null))}
      />
      {followError && (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {followError}
        </p>
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
      <DetailSplit
        detail={
          detailOpen &&
          batch && (
            <CellDetail
              column={selected ? (batch.columns[selected.column] ?? null) : null}
              cell={selectedCell ?? null}
              onClose={() => {
                detail.close();
                focusGrid();
              }}
              onSetNull={
                selected && selectedEditable
                  ? () => edit.setValue(selected.row, selected.column, null)
                  : undefined
              }
              original={
                selected
                  ? (edit.editing.originalFor?.(selected.row, selected.column) ?? null)
                  : null
              }
              onRevert={
                selected ? () => edit.editing.revert?.(selected.row, selected.column) : undefined
              }
              editValue={
                selected && selectedEditable
                  ? edit.editing.textFor(selected.row, selected.column)
                  : null
              }
              // a column with a fixed set of values is picked inline, from its list
              onEdit={
                selected && selectedEditable && !edit.editing.optionsFor?.(selected.column).length
                  ? value => edit.setValue(selected.row, selected.column, value)
                  : undefined
              }
            />
          )
        }
      >
        <div className="h-full min-w-0">
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
              onSelect={next => {
                setSelected(next);
                if (next) {
                  detail.reveal(batch.columns[next.column], edit.rows[next.row]?.[next.column]);
                }
              }}
              editing={edit.editing}
              label={`Linhas de ${table}`}
              detailOpen={detailOpen}
              onToggleDetail={detail.toggle}
              link={foreignKeys.length > 0 ? link : undefined}
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
      </DetailSplit>
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
        {/* never clipped: if the words above still do not fit (production keeps its write
            words at any width), the write group drops to a second line, whole */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 text-sm">
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
          {/* a new filter or a save makes the count speak of other rows: it starts over */}
          <RowCount
            key={`${JSON.stringify(filters)}|${edit.saves}`}
            connectionId={connectionId}
            request={request}
            estimateClassName={estimateClass}
          />
          {!dirty && browse.isFetching && (
            <span className="text-xs text-muted-foreground">atualizando…</span>
          )}
          {batch && (
            <DetailToggle
              open={detailOpen}
              onToggle={detail.toggle}
              labelClassName="hidden @min-[56rem]:inline"
            />
          )}
          {batch && (
            <ReferencesMenu
              connectionId={connectionId}
              schema={schema}
              table={table}
              enabled={selectedStored !== null}
              open={referencesOpen}
              onOpenChange={setReferencesOpen}
              onPick={incoming => void followBack(incoming)}
              labelClassName="hidden @min-[54rem]:inline"
            />
          )}
          {batch && (
            <CopyRowsMenu
              columns={batch.columns}
              rows={batch.rows}
              // a row added in the grid is not stored yet: nothing to copy
              selectedRow={selected && selected.row < batch.rows.length ? selected.row : null}
              labelClassName="hidden @min-[50rem]:inline"
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
                    <span className="hidden text-xs text-muted-foreground @min-[68.5rem]:inline">
                      <span className="@min-[73rem]:hidden">Enter edita a célula</span>
                      <span className="hidden @min-[73rem]:inline">
                        Duplo clique ou Enter edita a célula
                      </span>
                    </span>
                  )}
                  {/* words in a wide bar (66rem); below, the icon and its name (read aloud and on hover) */}
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
                  <span className="sr-only text-xs font-medium @min-[75.5rem]:not-sr-only">
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
        changes={edit.diff}
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

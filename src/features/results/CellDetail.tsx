import { useState, type ReactNode } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { PanelRight, X } from "lucide-react";
import type { Cell, ResultColumn } from "@/bindings";
import { Button } from "@/components/ui/button";
import { JsonEditor } from "@/features/mongo/JsonEditor";
import { detailText, GRID_TEXT_LIMIT, prettyJson } from "@/features/results/format";
import { jsonProblem } from "@/features/results/jsonCheck";
import { cn } from "@/lib/utils";

type CellDetailProps = {
  /** null while no cell is selected: the panel stays open and says how to fill it */
  column: ResultColumn | null;
  cell: Cell | null;
  onClose: () => void;
  /** present when the cell is editable */
  onSetNull?: () => void;
  /** the stored value a staged edit replaces */
  original?: Cell | null;
  onRevert?: () => void;
  /** present when the cell can be written from here: the value the edit starts from, null is NULL */
  editValue?: string | null;
  onEdit?: (value: string | null) => void;
};

/** json and jsonb (Postgres), JSON (MySQL): edited as JSON, checked before it stages. */
export function isJsonColumn(column: ResultColumn): boolean {
  const type = column.typeName.toLowerCase();
  return type === "json" || type === "jsonb";
}

/** A value the grid's single line cannot show: JSON, or text cut short or over several lines. */
export function wantsPanel(column: ResultColumn, cell: Cell): boolean {
  if (isJsonColumn(column)) {
    return true;
  }
  return cell.t === "text" && (cell.v.length > GRID_TEXT_LIMIT || cell.v.includes("\n"));
}

/**
 * The value panel's state. It opens by itself on a value the grid cannot show whole; once
 * closed it stays closed for the rest of the visit, until Space or Valor opens it again.
 */
export function useCellDetail() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  return {
    open,
    toggle: () => {
      setOpen(!open);
      setDismissed(open);
    },
    close: () => {
      setOpen(false);
      setDismissed(true);
    },
    /** call on each selection: opens the panel for JSON and long text */
    reveal: (column: ResultColumn | undefined, cell: Cell | undefined) => {
      if (!dismissed && column && cell && wantsPanel(column, cell)) {
        setOpen(true);
      }
    }
  };
}

type DetailSplitProps = { children: ReactNode; detail: ReactNode };

/** The grid, and beside it the value panel, resizable by mouse or keyboard (arrows on the bar). */
export function DetailSplit({ children, detail }: DetailSplitProps) {
  const detailPanel = usePanelRef();
  return (
    <Group orientation="horizontal" className="min-h-0 flex-1">
      <Panel id="grid" minSize={200} className="min-w-0">
        {children}
      </Panel>
      {detail && (
        <>
          {/* a 25px grab area around the 1px line; a double click widens or narrows, without dragging */}
          <Separator
            aria-label="Largura do painel do valor"
            title="Arraste, use as setas ou dê duplo clique para alternar a largura"
            onDoubleClick={() => {
              const panel = detailPanel.current;
              panel?.resize(panel.getSize().asPercentage > 45 ? "32" : "60");
            }}
            className="relative w-px bg-border outline-none after:absolute after:inset-y-0 after:-inset-x-3 hover:bg-primary/40 focus-visible:bg-ring focus-visible:shadow-[0_0_0_1px_var(--ring)] data-[separator=active]:bg-primary/40"
          />
          <Panel id="detail" defaultSize="32" minSize={240} maxSize="75" panelRef={detailPanel}>
            {detail}
          </Panel>
        </>
      )}
    </Group>
  );
}

export function CellDetail({
  column,
  cell,
  onClose,
  onSetNull,
  original = null,
  onRevert,
  editValue = null,
  onEdit
}: CellDetailProps) {
  return (
    <aside
      aria-label="Valor da célula"
      onKeyDown={event => event.key === "Escape" && onClose()}
      className="flex h-full w-full flex-col"
    >
      <div className="flex items-center justify-between gap-2 border-b bg-muted px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{column?.name ?? "Valor da célula"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {column?.typeName ?? "Nenhuma célula selecionada"}
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Fechar" onClick={onClose}>
          <X />
        </Button>
      </div>
      {!column || !cell ? (
        <p className="p-3 text-xs text-muted-foreground">
          Selecione uma célula na grade para ver o valor inteiro, como está gravado.
        </p>
      ) : (
        // in a short window the panel scrolls as a whole: its parts never ride over each other
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <CellValue
            column={column}
            cell={cell}
            onSetNull={onSetNull}
            original={original}
            onRevert={onRevert}
            editValue={editValue}
            onEdit={onEdit}
          />
        </div>
      )}
    </aside>
  );
}

type CellValueProps = Pick<
  CellDetailProps,
  "onSetNull" | "original" | "onRevert" | "editValue" | "onEdit"
> & {
  column: ResultColumn;
  cell: Cell;
};

function CellValue({
  column,
  cell,
  onSetNull,
  original,
  onRevert,
  editValue,
  onEdit
}: CellValueProps) {
  const json = isJsonColumn(column);
  const label = `${original ? "Depois" : "Valor"} de ${column.name}`;
  return (
    <>
      {original && (
        // the stored value stays in sight under a staged edit; the hatch belongs to the edit
        <div className="border-b bg-muted px-3 py-2">
          <p className="legend text-muted-foreground">Antes</p>
          <pre
            className={cn(
              "mt-1 max-h-24 overflow-auto font-mono text-xs break-all whitespace-pre-wrap",
              original.t === "null" && "text-muted-foreground italic"
            )}
          >
            {detailText(original)}
          </pre>
          {onRevert && (
            <Button
              size="xs"
              variant="outline"
              className="mt-2"
              aria-keyshortcuts="Control+Z"
              title="Volta ao valor gravado (Ctrl+Z)"
              onClick={onRevert}
            >
              Desfazer alteração
            </Button>
          )}
        </div>
      )}
      {json && onEdit && (
        <JsonValueEditor
          key={column.name}
          label={label}
          initial={editValue ?? null}
          onCommit={onEdit}
        />
      )}
      {json && !onEdit && cell.t === "json" && (
        // formatted for reading only: nothing is written from here
        <div className="flex min-h-24 flex-1 flex-col p-2">
          <JsonEditor
            key={`${column.name}:read`}
            value={prettyJson(cell.v)}
            onChange={() => undefined}
            label={`Valor de ${column.name} (somente leitura)`}
            readOnly
          />
        </div>
      )}
      {!json && onEdit && (
        <ValueEditor
          key={column.name}
          label={label}
          initial={editValue ?? null}
          onCommit={onEdit}
        />
      )}
      {!onEdit && (!json || cell.t !== "json") && (
        // focusable so a long value scrolls from the keyboard
        <pre
          tabIndex={0}
          role="region"
          aria-label={`Valor de ${column.name}`}
          className={cn(
            "flex-1 overflow-auto p-3 font-mono text-xs break-all whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            cell.t === "null" && "text-muted-foreground italic"
          )}
        >
          {detailText(cell)}
        </pre>
      )}
      {onSetNull && cell.t !== "null" && (
        <div className="border-t px-3 py-2">
          <Button size="sm" variant="outline" onClick={onSetNull}>
            Definir como NULL
          </Button>
        </div>
      )}
      {cell.t === "bytes" && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Prévia dos primeiros bytes; o conteúdo completo não é carregado.
        </p>
      )}
      {cell.t === "unknown" && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Tipo não modelado: exibido como texto e não editável.
        </p>
      )}
    </>
  );
}

type ValueEditorProps = {
  label: string;
  /** null is NULL, shown as a placeholder */
  initial: string | null;
  onCommit: (value: string | null) => void;
};

/** A revert or another cell starts the draft over; after a commit it already matches. */
function useDraft(initial: string | null) {
  const [draft, setDraft] = useState(initial);
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setDraft(initial);
  }
  return [draft, setDraft] as const;
}

/**
 * The value written where it can be read whole: long text is edited here, not in a 28px line,
 * wrapped at the panel's width. It stages like the inline editor, on leaving the field or
 * Ctrl+Enter, and only when the text changed, so opening a NULL never writes ''.
 */
function ValueEditor({ label, initial, onCommit }: ValueEditorProps) {
  const [draft, setDraft] = useDraft(initial);

  function commit() {
    if (draft !== initial) {
      onCommit(draft);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-1.5 p-2">
      {/* NULL is a marker, not text in the field: said above it, so the empty box reads as
          "type to replace", never as a value on display */}
      {draft === null && (
        <p className="text-xs text-muted-foreground">
          Gravado como <span className="font-mono italic">NULL</span>
        </p>
      )}
      <textarea
        aria-label={label}
        aria-describedby="value-editor-keys"
        aria-keyshortcuts="Control+Enter"
        spellCheck={false}
        value={draft ?? ""}
        placeholder={draft === null ? "Digite para substituir NULL" : undefined}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape" && draft !== initial) {
            // Esc first drops the draft; a second one closes the panel
            event.stopPropagation();
            setDraft(initial);
          }
        }}
        // boxed like every other field: without the edge it reads as a display
        className="min-h-24 flex-1 resize-none border border-input bg-background p-2.5 font-mono text-xs break-all outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
      />
      <p id="value-editor-keys" className="text-xs text-muted-foreground">
        Ctrl+Enter ou sair do campo guarda como pendente · Esc desfaz o rascunho
      </p>
    </div>
  );
}

/**
 * JSON in CodeMirror, starting from the text exactly as stored: nothing is re-indented or
 * parsed unless the user asks for "Formatar", so numbers beyond 2^53 and the stored layout
 * survive. An invalid draft says the line and blocks Aplicar.
 */
function JsonValueEditor({ label, initial, onCommit }: ValueEditorProps) {
  const [draft, setDraft] = useDraft(initial);
  const changed = draft !== initial;
  const problem = draft === null ? null : jsonProblem(draft);
  const canApply = changed && draft !== null && problem === null;

  function apply() {
    if (canApply) {
      onCommit(draft);
    }
  }

  return (
    // a grid, not a flex column: the editor row's floor is a fixed 6rem, so the block never
    // shrinks under its buttons (they used to ride over Definir como NULL in a short window)
    // and a long JSON scrolls inside the editor instead of stretching the panel
    <div
      className={cn(
        "grid flex-1 gap-1.5 p-2",
        draft === null
          ? "grid-rows-[auto_minmax(6rem,1fr)_auto]"
          : "grid-rows-[minmax(6rem,1fr)_auto]"
      )}
    >
      {draft === null && (
        <p className="text-xs text-muted-foreground">
          Gravado como <span className="font-mono italic">NULL</span>: digite o JSON para substituir
        </p>
      )}
      <div className="min-h-0">
        <JsonEditor value={draft ?? ""} onChange={setDraft} onRun={apply} label={label} />
      </div>
      <div className="grid gap-1.5">
        {problem && (
          // polite: it changes with every keystroke while the JSON is half typed
          <p role="status" className="text-xs text-destructive">
            JSON inválido na linha {problem.line}, coluna {problem.column}: {problem.message}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={draft === null || problem !== null}
            title="Reindenta o texto, sem converter os números"
            onClick={() => draft !== null && setDraft(prettyJson(draft))}
          >
            Formatar
          </Button>
          <Button size="xs" disabled={!canApply} aria-keyshortcuts="Control+Enter" onClick={apply}>
            Aplicar
          </Button>
          <p className="text-xs text-muted-foreground">Ctrl+Enter também aplica</p>
        </div>
      </div>
    </div>
  );
}

type DetailToggleProps = {
  open: boolean;
  onToggle: () => void;
  /** when the word shows: each bar has its own crowd of controls */
  labelClassName?: string;
};

/**
 * Opens the full-value panel beside the grid; Space does the same from a selected cell.
 * Inside a narrow @container bar only the icon shows; the name stays for the reader.
 */
export function DetailToggle({
  open,
  onToggle,
  labelClassName = "hidden @min-[44rem]:inline"
}: DetailToggleProps) {
  return (
    <Button
      size="xs"
      variant="outline"
      aria-label="Valor"
      aria-pressed={open}
      aria-keyshortcuts="Space"
      title="Valor inteiro da célula selecionada (Espaço)"
      onClick={onToggle}
      className="aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground aria-pressed:hover:text-background"
    >
      <PanelRight />
      <span className={labelClassName}>Valor</span>
    </Button>
  );
}

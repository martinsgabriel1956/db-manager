import { useState } from "react";
import { PanelRight, X } from "lucide-react";
import type { Cell, ResultColumn } from "@/bindings";
import { Button } from "@/components/ui/button";
import { detailText, prettyJson } from "@/features/results/format";
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
      className="flex w-80 shrink-0 flex-col border-l"
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
        <CellValue
          column={column}
          cell={cell}
          onSetNull={onSetNull}
          original={original}
          onRevert={onRevert}
          editValue={editValue}
          onEdit={onEdit}
        />
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
      {onEdit ? (
        <ValueEditor
          key={column.name}
          label={`${original ? "Depois" : "Valor"} de ${column.name}`}
          initial={editValue ?? null}
          // jsonb stores its own normal form: indented here, it reads like the panel always did
          indentJson={column.typeName === "jsonb"}
          onCommit={onEdit}
        />
      ) : (
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
  indentJson: boolean;
  onCommit: (value: string | null) => void;
};

/**
 * The value written where it can be read whole: long text and JSON are edited here, not in
 * a 28px line. It stages like the inline editor, on leaving the field or Ctrl+Enter, and only
 * when the text changed, so opening a NULL never writes ''.
 */
function ValueEditor({ label, initial, indentJson, onCommit }: ValueEditorProps) {
  const start = initial !== null && indentJson ? prettyJson(initial) : initial;
  const [draft, setDraft] = useState(start);
  // a revert or another cell starts the draft over; after a commit it already matches, and the
  // field keeps focus (remounting it would drop the caret mid-edit)
  const [base, setBase] = useState(start);
  if (base !== start) {
    setBase(start);
    setDraft(start);
  }

  function commit() {
    if (draft !== start) {
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
          } else if (event.key === "Escape" && draft !== start) {
            // Esc first drops the draft; a second one closes the panel
            event.stopPropagation();
            setDraft(start);
          }
        }}
        // boxed like every other field: without the edge it reads as a display
        className="min-h-24 flex-1 resize-none border border-input bg-background p-2.5 font-mono text-xs break-all outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
      />
      <p id="value-editor-keys" className="text-xs text-muted-foreground">
        Ctrl+Enter ou sair do campo deixa como alteração pendente · Esc desfaz o rascunho
      </p>
    </div>
  );
}

type DetailToggleProps = { open: boolean; onToggle: () => void };

/**
 * Opens the full-value panel beside the grid; Space does the same from a selected cell.
 * Inside a narrow @container bar only the icon shows; the name stays for the reader.
 */
export function DetailToggle({ open, onToggle }: DetailToggleProps) {
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
      <span className="hidden @min-[44rem]:inline">Valor</span>
    </Button>
  );
}

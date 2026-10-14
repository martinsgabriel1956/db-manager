import { PanelRight, X } from "lucide-react";
import type { Cell, ResultColumn } from "@/bindings";
import { Button } from "@/components/ui/button";
import { detailText } from "@/features/results/format";
import { cn } from "@/lib/utils";

type CellDetailProps = {
  /** null while no cell is selected: the panel stays open and says how to fill it */
  column: ResultColumn | null;
  cell: Cell | null;
  onClose: () => void;
  /** present when the cell is editable */
  onSetNull?: () => void;
};

export function CellDetail({ column, cell, onClose, onSetNull }: CellDetailProps) {
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
        <CellValue column={column} cell={cell} onSetNull={onSetNull} />
      )}
    </aside>
  );
}

type CellValueProps = Pick<CellDetailProps, "onSetNull"> & { column: ResultColumn; cell: Cell };

function CellValue({ column, cell, onSetNull }: CellValueProps) {
  return (
    <>
      {/* focusable so a long value scrolls from the keyboard */}
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

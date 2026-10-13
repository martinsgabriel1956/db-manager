import { useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import type { Cell, ResultColumn } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { rowsAsJson } from "@/features/results/copy";
import { errorMessage } from "@/lib/errors";

type CopyRowsMenuProps = {
  columns: ResultColumn[];
  /** the stored rows, as loaded: pending edits are not copied */
  rows: Cell[][];
  /** index into `rows`; null when nothing (or an unsaved row) is selected */
  selectedRow: number | null;
  /** tables only: a result of an arbitrary query has no table to insert into */
  insert?: (rows: Cell[][]) => Promise<string>;
};

type CopyState =
  { status: "idle" } | { status: "done"; text: string } | { status: "error"; text: string };

/** "1 linha copiada", "3 linhas carregadas" */
function rowCount(count: number, participle: string) {
  const plural = count === 1 ? "" : "s";
  return `${count.toLocaleString("pt-BR")} linha${plural} ${participle}${plural}`;
}

/** Copies the selected row, or every loaded row, as JSON or INSERT. */
export function CopyRowsMenu({ columns, rows, selectedRow, insert }: CopyRowsMenuProps) {
  const [state, setState] = useState<CopyState>({ status: "idle" });
  const selected = selectedRow !== null && rows[selectedRow] ? [rows[selectedRow]] : null;

  async function copy(picked: Cell[][], format: "JSON" | "INSERT") {
    try {
      const text =
        format === "INSERT" && insert ? await insert(picked) : rowsAsJson(columns, picked);
      await navigator.clipboard.writeText(text);
      setState({ status: "done", text: `${rowCount(picked.length, "copiada")} como ${format}` });
    } catch (err) {
      setState({ status: "error", text: `Não copiado: ${errorMessage(err)}` });
    }
  }

  const formats = insert ? (["JSON", "INSERT"] as const) : (["JSON"] as const);

  return (
    <span className="flex min-w-0 items-center gap-2 text-xs">
      {state.status === "done" && (
        <span role="status" className="truncate text-success">
          {state.text}
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="max-w-96 break-words text-destructive">
          {state.text}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="outline" disabled={rows.length === 0}>
            <Copy /> Copiar <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {formats.map(format => (
            <DropdownMenuItem
              key={`selected-${format}`}
              disabled={!selected}
              onSelect={() => selected && copy(selected, format)}
            >
              Linha selecionada como {format}
            </DropdownMenuItem>
          ))}
          {formats.map(format => (
            <DropdownMenuItem key={`all-${format}`} onSelect={() => copy(rows, format)}>
              {rowCount(rows.length, "carregada")} como {format}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

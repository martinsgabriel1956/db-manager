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
  /** when the word shows; the icon and the name (read aloud and on hover) always do */
  labelClassName?: string;
};

type CopyState =
  | { status: "idle" }
  /** `of`: the rows it speaks of; another page, filter or query makes it stale */
  | { status: "done"; text: string; of: Cell[][] }
  | { status: "error"; text: string; of: Cell[][] };

/** "1 linha copiada", "3 linhas carregadas" */
function rowCount(count: number, participle: string) {
  const plural = count === 1 ? "" : "s";
  return `${count.toLocaleString("pt-BR")} linha${plural} ${participle}${plural}`;
}

/** Copies the selected row, or every loaded row, as JSON or INSERT. */
export function CopyRowsMenu({
  columns,
  rows,
  selectedRow,
  insert,
  labelClassName = "inline"
}: CopyRowsMenuProps) {
  const [copied, setState] = useState<CopyState>({ status: "idle" });
  const state: CopyState =
    copied.status !== "idle" && copied.of !== rows ? { status: "idle" } : copied;
  const selected = selectedRow !== null && rows[selectedRow] ? [rows[selectedRow]] : null;

  async function copy(picked: Cell[][], format: "JSON" | "INSERT") {
    try {
      const text =
        format === "INSERT" && insert ? await insert(picked) : rowsAsJson(columns, picked);
      await navigator.clipboard.writeText(text);
      setState({
        status: "done",
        text: `${rowCount(picked.length, "copiada")} como ${format}`,
        of: rows
      });
    } catch (err) {
      setState({ status: "error", text: `Não copiado: ${errorMessage(err)}`, of: rows });
    }
  }

  const formats = insert ? (["JSON", "INSERT"] as const) : (["JSON"] as const);

  return (
    // never shrinks in a crowded bar (it used to collapse under the button); the notice is capped
    <span className="flex shrink-0 items-center gap-2 text-xs">
      {state.status === "done" && (
        <span role="status" className="max-w-60 truncate text-success">
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
          <Button
            size="xs"
            variant="outline"
            aria-label="Copiar"
            title="Copiar"
            disabled={rows.length === 0}
          >
            <Copy /> <span className={labelClassName}>Copiar</span> <ChevronDown />
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

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Square, Upload } from "lucide-react";
import {
  commands,
  type ColumnMapping,
  type Confirmation,
  type CsvImport,
  type CsvPreview
} from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { connected, useStructure } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type ImportCsvButtonProps = { connectionId: string; schema: string; table: string };

type ImportState =
  | { status: "idle" }
  | { status: "mapping"; path: string; preview: CsvPreview; error: string | null }
  | { status: "confirming"; request: CsvImport; confirmation: Confirmation }
  | { status: "running"; runId: string }
  | { status: "done"; rows: number }
  | { status: "error"; message: string };

const DELIMITERS: Record<string, string> = { ",": "vírgula", ";": "ponto e vírgula", "\t": "tab" };

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** File column → table column with the same name (ignoring case), or none. */
export function initialMapping(fileColumns: string[], tableColumns: string[]): string[] {
  return fileColumns.map(
    name =>
      tableColumns.find(column => column === name) ??
      tableColumns.find(column => column.toLowerCase() === name.trim().toLowerCase()) ??
      ""
  );
}

/**
 * Opens a CSV, maps its columns onto the table's and imports it in one transaction.
 * The backend answers the first call with the sample INSERT and the row count, signed
 * in the confirmation before anything runs.
 */
export function ImportCsvButton({ connectionId, schema, table }: ImportCsvButtonProps) {
  const queryClient = useQueryClient();
  const structure = useStructure(connectionId, schema, table);
  const tableColumns = structure.data?.columns.map(column => column.name) ?? [];
  const [state, setState] = useState<ImportState>({ status: "idle" });
  const [mapping, setMapping] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);

  async function pick() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "CSV", extensions: ["csv", "txt"] }]
    });
    if (!path) {
      return;
    }
    try {
      const preview = await commands.previewCsv(path);
      setMapping(initialMapping(preview.columns, tableColumns));
      setState({ status: "mapping", path, preview, error: null });
    } catch (err) {
      setState({ status: "error", message: errorMessage(err) });
    }
  }

  function request(path: string): CsvImport {
    const columns: ColumnMapping[] = mapping.flatMap((column, source) =>
      column ? [{ source, column }] : []
    );
    return { schema, table, path, mapping: columns };
  }

  async function review(path: string, preview: CsvPreview) {
    const next = request(path);
    setReviewing(true);
    try {
      const response = await connected(connectionId, () =>
        commands.importCsv(connectionId, crypto.randomUUID(), next, false)
      );
      if (response.status === "needsConfirmation") {
        setState({ status: "confirming", request: next, confirmation: response.confirmation });
      }
    } catch (err) {
      setState({ status: "mapping", path, preview, error: errorMessage(err) });
    }
    setReviewing(false);
  }

  async function run(next: CsvImport) {
    const runId = crypto.randomUUID();
    setState({ status: "running", runId });
    try {
      const response = await connected(connectionId, () =>
        commands.importCsv(connectionId, runId, next, true)
      );
      if (response.status === "imported") {
        setState({ status: "done", rows: response.rows });
      }
    } catch (err) {
      setState({ status: "error", message: errorMessage(err) });
    }
    queryClient.invalidateQueries({ queryKey: ["browse", connectionId] });
    queryClient.invalidateQueries({ queryKey: ["history"] });
  }

  if (state.status === "running") {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        Importando…
        <Button
          size="xs"
          variant="outline"
          onClick={() => commands.cancelRun(state.runId).catch(() => undefined)}
        >
          <Square /> Cancelar importação
        </Button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs">
      {state.status === "done" && (
        <span role="status" className="text-success">
          {state.rows.toLocaleString("pt-BR")}{" "}
          {state.rows === 1 ? "linha importada" : "linhas importadas"}
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="max-w-96 break-words text-destructive">
          {state.message}
        </span>
      )}
      <Button size="xs" variant="outline" disabled={!structure.data} onClick={pick}>
        <Upload /> Importar CSV
      </Button>
      {state.status === "mapping" && (
        <MappingDialog
          path={state.path}
          preview={state.preview}
          tableColumns={tableColumns}
          table={`${schema}.${table}`}
          mapping={mapping}
          error={state.error}
          pending={reviewing}
          onChange={setMapping}
          onReview={() => review(state.path, state.preview)}
          onCancel={() => setState({ status: "idle" })}
        />
      )}
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={state.status === "confirming" ? state.confirmation : null}
        confirmLabel="Importar"
        onConfirm={() => state.status === "confirming" && run(state.request)}
        onCancel={() => setState({ status: "idle" })}
      />
    </span>
  );
}

type MappingDialogProps = {
  path: string;
  preview: CsvPreview;
  tableColumns: string[];
  table: string;
  mapping: string[];
  error: string | null;
  pending: boolean;
  onChange: (mapping: string[]) => void;
  onReview: () => void;
  onCancel: () => void;
};

function MappingDialog({
  path,
  preview,
  tableColumns,
  table,
  mapping,
  error,
  pending,
  onChange,
  onReview,
  onCancel
}: MappingDialogProps) {
  const headingId = useId();
  const mapped = mapping.filter(Boolean).length;

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar {fileName(path)}</DialogTitle>
          <DialogDescription>
            Em {table}. Separador: {DELIMITERS[preview.delimiter] ?? preview.delimiter}; campo vazio
            sem aspas é NULL e <code>""</code> é texto vazio. Colunas da tabela que ficam de fora
            recebem o valor padrão.
          </DialogDescription>
        </DialogHeader>
        <table aria-label="Coluna do arquivo para coluna da tabela" className="text-sm">
          <thead>
            <tr className="legend text-left text-muted-foreground">
              <th scope="col" className="py-1 pr-4 font-normal">
                Coluna do arquivo
              </th>
              <th scope="col" className="py-1 font-normal">
                Coluna da tabela
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.columns.map((name, index) => (
              <tr key={index}>
                <th scope="row" className="py-0.5 pr-4 text-left font-mono font-normal">
                  {name || `(coluna ${index + 1})`}
                </th>
                <td className="py-0.5">
                  <NativeSelect
                    aria-label={`Destino de ${name || `coluna ${index + 1}`}`}
                    className="h-7 min-w-48 font-mono text-xs"
                    value={mapping[index] ?? ""}
                    onChange={event =>
                      onChange(
                        mapping.map((column, i) => (i === index ? event.target.value : column))
                      )
                    }
                  >
                    <option value="">não importar</option>
                    {tableColumns.map(column => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <p id={headingId} className="legend mb-1 text-muted-foreground">
            Primeiras linhas do arquivo
          </p>
          {/* focusable so a wide file scrolls from the keyboard */}
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={headingId}
            className="max-h-48 overflow-auto border"
          >
            <table className="font-mono text-xs">
              <thead>
                <tr>
                  {preview.columns.map((name, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="border-b px-2 py-1 text-left whitespace-nowrap"
                    >
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((value, index) => (
                      <td
                        key={index}
                        className={cn(
                          "max-w-60 truncate px-2 py-0.5 whitespace-pre",
                          value === null && "text-muted-foreground italic"
                        )}
                      >
                        {value ?? "NULL"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm break-words text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={pending || mapped === 0} onClick={onReview}>
            {pending ? "Lendo o arquivo…" : "Revisar importação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

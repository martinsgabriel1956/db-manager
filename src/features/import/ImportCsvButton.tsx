import { useId, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Upload } from "lucide-react";
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
import { ImportStatus, useImportRun } from "@/features/import/ImportRun";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type ImportCsvButtonProps = { connectionId: string; schema: string; table: string };

type Step =
  | { status: "idle" }
  | { status: "mapping"; path: string; preview: CsvPreview; error: string | null }
  | { status: "confirming"; request: CsvImport; confirmation: Confirmation };

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
  const structure = useStructure(connectionId, schema, table);
  const tableColumns = structure.data?.columns.map(column => column.name) ?? [];
  const runner = useImportRun(["browse", connectionId], rows =>
    rows === 1 ? "1 linha importada" : `${rows.toLocaleString("pt-BR")} linhas importadas`
  );
  const [step, setStep] = useState<Step>({ status: "idle" });
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
      setStep({ status: "mapping", path, preview, error: null });
    } catch (err) {
      runner.fail(err);
    }
  }

  async function review(path: string, preview: CsvPreview) {
    const columns: ColumnMapping[] = mapping.flatMap((column, source) =>
      column ? [{ source, column }] : []
    );
    const request: CsvImport = { schema, table, path, mapping: columns };
    setReviewing(true);
    try {
      const response = await connected(connectionId, () =>
        commands.importCsv(connectionId, crypto.randomUUID(), request, false)
      );
      if (response.status === "needsConfirmation") {
        setStep({ status: "confirming", request, confirmation: response.confirmation });
      }
    } catch (err) {
      setStep({ status: "mapping", path, preview, error: errorMessage(err) });
    }
    setReviewing(false);
  }

  return (
    <ImportStatus runner={runner}>
      <Button size="xs" variant="outline" disabled={!structure.data} onClick={pick}>
        <Upload /> Importar CSV
      </Button>
      {step.status === "mapping" && (
        <MappingDialog
          path={step.path}
          preview={step.preview}
          tableColumns={tableColumns}
          table={`${schema}.${table}`}
          mapping={mapping}
          error={step.error}
          pending={reviewing}
          onChange={setMapping}
          onReview={() => review(step.path, step.preview)}
          onCancel={() => setStep({ status: "idle" })}
        />
      )}
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={step.status === "confirming" ? step.confirmation : null}
        confirmLabel="Importar"
        onConfirm={() => {
          if (step.status === "confirming") {
            setStep({ status: "idle" });
            runner.run(runId =>
              connected(connectionId, () =>
                commands.importCsv(connectionId, runId, step.request, true)
              )
            );
          }
        }}
        onCancel={() => setStep({ status: "idle" })}
      />
    </ImportStatus>
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

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { DatabaseBackup, Square, Upload } from "lucide-react";
import {
  commands,
  type BackupFormat,
  type Confirmation,
  type ConnectionConfig,
  type Engine
} from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { connected, isConnectionQuery } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

type BackupDialogProps = { connection: ConnectionConfig; onClose: () => void };

type FormatOption = { format: BackupFormat; label: string; extension: string };

type JobState =
  | { status: "idle" }
  | { status: "running"; runId: string; label: string }
  | { status: "done"; message: string; command: string }
  | { status: "error"; message: string };

type Review = { path: string; confirmation: Confirmation };

const FORMATS: Partial<Record<Engine, FormatOption[]>> = {
  postgres: [
    { format: "custom", label: "Custom (pg_dump -Fc, volta pelo pg_restore)", extension: "dump" },
    { format: "sql", label: "SQL em texto (pg_dump -Fp, volta pelo psql)", extension: "sql" }
  ],
  mysql: [{ format: "sql", label: "SQL (mysqldump)", extension: "sql" }],
  sqlite: [{ format: "sqliteFile", label: "Cópia do arquivo (VACUUM INTO)", extension: "sqlite" }]
};

const TOOLS: Partial<Record<Engine, string>> = {
  postgres:
    "Usa o pg_dump, o pg_restore e o psql instalados no sistema (PATH), na versão do servidor ou mais nova.",
  mysql: "Usa o mysqldump e o mysql instalados no sistema (PATH).",
  sqlite: "O próprio app copia o arquivo com VACUUM INTO: uma cópia consistente, mesmo em uso."
};

const RESTORE_NOTE: Partial<Record<Engine, string>> = {
  postgres:
    "Um arquivo custom volta pelo pg_restore --clean (apaga e recria os objetos do backup); um .sql roda pelo psql. Nos dois casos numa transação, que para no primeiro erro.",
  mysql:
    "O arquivo roda pelo mysql como está. Não é uma transação: um erro no meio deixa o que já rodou."
};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits })} ${units[unit]}`;
}

function baseName(connection: ConnectionConfig): string {
  const name = connection.target.kind === "network" ? connection.target.database : connection.name;
  return `${name}-${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Backup and restore of the whole database, through the system's client tools (SQLite
 * copies itself). The command that ran is shown after; a restore shows it before, in the
 * same confirmation every destructive command gets.
 */
export function BackupDialog({ connection, onClose }: BackupDialogProps) {
  const queryClient = useQueryClient();
  const formats = FORMATS[connection.engine] ?? [];
  const [formatId, setFormatId] = useState<BackupFormat | undefined>(formats[0]?.format);
  const [job, setJob] = useState<JobState>({ status: "idle" });
  const [review, setReview] = useState<Review | null>(null);
  const formatSelectId = useId();
  const option = formats.find(candidate => candidate.format === formatId) ?? formats[0];
  const running = job.status === "running";
  const restoreNote = RESTORE_NOTE[connection.engine];

  async function track(label: string, work: (runId: string) => Promise<JobState>) {
    const runId = crypto.randomUUID();
    setJob({ status: "running", runId, label });
    try {
      setJob(await work(runId));
    } catch (err) {
      setJob({ status: "error", message: errorMessage(err) });
    }
    queryClient.invalidateQueries({ queryKey: ["history"] });
  }

  async function startBackup() {
    if (!option) {
      return;
    }
    const path = await save({
      defaultPath: `${baseName(connection)}.${option.extension}`,
      filters: [{ name: option.label, extensions: [option.extension] }]
    });
    if (!path) {
      return;
    }
    await track("Fazendo backup…", async runId => {
      const outcome = await connected(connection.id, () =>
        commands.backupDatabase(connection.id, runId, option.format, path)
      );
      // specta types every f64 as nullable (NaN travels as null); a file size never is NaN
      const size = outcome.bytes === null ? "" : ` · ${formatBytes(outcome.bytes)}`;
      return {
        status: "done",
        message: `Backup gravado em ${fileName(path)}${size} · ${outcome.durationMs} ms`,
        command: outcome.command
      };
    });
  }

  async function pickRestore() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Backup",
          extensions: connection.engine === "postgres" ? ["dump", "backup", "sql"] : ["sql"]
        }
      ]
    });
    if (!path) {
      return;
    }
    try {
      const response = await connected(connection.id, () =>
        commands.restoreDatabase(connection.id, crypto.randomUUID(), path, false)
      );
      if (response.status === "needsConfirmation") {
        setReview({ path, confirmation: response.confirmation });
      }
    } catch (err) {
      setJob({ status: "error", message: errorMessage(err) });
    }
  }

  function confirmRestore() {
    if (!review) {
      return;
    }
    const { path } = review;
    setReview(null);
    track("Restaurando…", async runId => {
      const response = await connected(connection.id, () =>
        commands.restoreDatabase(connection.id, runId, path, true)
      );
      if (response.status === "needsConfirmation") {
        return { status: "error", message: "A restauração pediu outra confirmação; nada rodou." };
      }
      // whatever the grid and the tree showed may be gone or new now
      queryClient.invalidateQueries({
        predicate: query => isConnectionQuery(query.queryKey, connection.id)
      });
      return {
        status: "done",
        message: `Restaurado de ${fileName(path)} · ${response.durationMs} ms`,
        command: response.command
      };
    });
  }

  return (
    // a running job keeps the dialog: its cancel button lives here
    <Dialog open onOpenChange={next => !next && !running && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Backup e restauração</DialogTitle>
          <DialogDescription>
            {connection.name} · {TOOLS[connection.engine]}
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby={`${formatSelectId}-backup`} className="grid gap-2">
          <h3 id={`${formatSelectId}-backup`} className="legend text-muted-foreground">
            Backup
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {formats.length > 1 && (
              <NativeSelect
                aria-label="Formato do backup"
                value={option?.format}
                disabled={running}
                onChange={event =>
                  setFormatId(formats.find(f => f.format === event.target.value)?.format)
                }
              >
                {formats.map(candidate => (
                  <option key={candidate.format} value={candidate.format}>
                    {candidate.label}
                  </option>
                ))}
              </NativeSelect>
            )}
            {formats.length === 1 && <span className="text-sm">{option?.label}</span>}
            <Button size="sm" disabled={running || !option} onClick={startBackup}>
              <DatabaseBackup /> Fazer backup…
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Grava em um arquivo .part e renomeia no fim: um backup que falha ou é cancelado não
            apaga um arquivo existente.
          </p>
        </section>

        <section aria-labelledby={`${formatSelectId}-restore`} className="grid gap-2">
          <h3 id={`${formatSelectId}-restore`} className="legend text-muted-foreground">
            Restaurar
          </h3>
          {connection.engine === "sqlite" ? (
            <p className="text-sm">
              O app não restaura SQLite: feche a conexão e copie o arquivo do backup no lugar do
              banco.
            </p>
          ) : connection.readOnly ? (
            <p className="text-sm">
              Conexão somente leitura: restaurar está desligado, porque escreve no banco.
            </p>
          ) : (
            <>
              <div>
                <Button size="sm" variant="outline" disabled={running} onClick={pickRestore}>
                  <Upload /> Restaurar de um arquivo…
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {restoreNote} O comando exato aparece para confirmar antes de rodar.
              </p>
            </>
          )}
        </section>

        {job.status === "running" && (
          <div role="status" className="flex items-center gap-2 border-t pt-3 text-sm">
            {job.label}
            {connection.engine === "sqlite" ? (
              <span className="text-xs text-muted-foreground">
                O SQLite não interrompe a cópia no meio.
              </span>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={() => commands.cancelRun(job.runId).catch(() => undefined)}
              >
                <Square /> Cancelar
              </Button>
            )}
          </div>
        )}
        {job.status === "done" && (
          <div className="grid gap-1.5 border-t pt-3">
            <p role="status" className="text-sm text-success">
              {job.message}
            </p>
            <p className="legend text-muted-foreground">Comando executado (sem a senha)</p>
            <pre
              tabIndex={0}
              role="region"
              aria-label="Comando executado"
              className="max-h-40 overflow-auto border bg-muted px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap outline-none focus-visible:border-ring"
            >
              {job.command}
            </pre>
          </div>
        )}
        {job.status === "error" && (
          <p role="alert" className="border-t pt-3 text-sm break-words text-destructive">
            {job.message}
          </p>
        )}

        <ConfirmDialog
          connectionId={connection.id}
          confirmation={review?.confirmation ?? null}
          confirmLabel="Restaurar"
          statementSuffix=""
          onConfirm={confirmRestore}
          onCancel={() => setReview(null)}
        />
      </DialogContent>
    </Dialog>
  );
}

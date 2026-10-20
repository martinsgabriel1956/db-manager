import { useId, useState, type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { commands, type ConnectionConfig } from "@/bindings";
import { SHEET_CLASS, SheetConnection, SheetFooter, SheetHeader } from "@/components/Sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useConnections } from "@/features/connections/queries";
import {
  paramValue,
  uniqueNames,
  type FoundParams,
  type ParamInput
} from "@/features/editor/params";
import { connected } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

type ParamsDialogProps = {
  connectionId: string;
  /** the SQL cut around its placeholders: the preview is filled from it */
  found: FoundParams;
  /** the values last used in this tab */
  remembered: Record<string, ParamInput>;
  /** from the backend on submit: a number that is not one, a NUL byte */
  error: string | null;
  pending: boolean;
  onSubmit: (values: Record<string, ParamInput>) => void;
  onCancel: () => void;
};

const KIND_LABELS: Record<ParamInput["kind"], string> = {
  text: "Texto",
  number: "Número",
  null: "NULL"
};

const KINDS: ParamInput["kind"][] = ["text", "number", "null"];

function isKind(value: string): value is ParamInput["kind"] {
  return value === "text" || value === "number" || value === "null";
}

/**
 * Asks the values of the `:name` placeholders before the SQL runs, in the same sheet as the
 * confirmation. Text goes in as a string literal of the connection's dialect, a number bare,
 * NULL as NULL: the backend writes them, and the command shown below as the values are typed
 * is the one that runs (and is confirmed and recorded).
 */
export function ParamsDialog({
  connectionId,
  found,
  remembered,
  error,
  pending,
  onSubmit,
  onCancel
}: ParamsDialogProps) {
  const id = useId();
  const names = uniqueNames(found.names);
  const connection: ConnectionConfig | undefined = useConnections().data?.find(
    candidate => candidate.id === connectionId
  );
  const [values, setValues] = useState<Record<string, ParamInput>>(() =>
    Object.fromEntries(names.map(name => [name, remembered[name] ?? { kind: "text", value: "" }]))
  );
  const filled = found.names.map(name => paramValue(values[name]));
  // the dialect's own quoting, from the backend: an approximation here would not be the command
  const preview = useQuery({
    queryKey: ["fillParams", connectionId, found.parts, filled],
    queryFn: () =>
      connected(connectionId, () => commands.fillParams(connectionId, found.parts, filled)),
    placeholderData: keepPreviousData
  });

  function update(name: string, change: Partial<ParamInput>) {
    setValues(prev => ({ ...prev, [name]: { ...prev[name], ...change } }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending) {
      onSubmit(values);
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent showCloseButton={false} className={SHEET_CLASS}>
        <SheetHeader title="Parâmetros" />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SheetConnection connection={connection} />
            {names.map(name => {
              const input = values[name];
              return (
                <div
                  key={name}
                  className="grid grid-cols-[minmax(5rem,auto)_1fr_7rem] items-center gap-3 border-b px-5 py-2"
                >
                  <label htmlFor={`${id}-${name}`} className="font-mono text-sm font-semibold">
                    :{name}
                  </label>
                  <Input
                    id={`${id}-${name}`}
                    className="font-mono"
                    spellCheck={false}
                    autoComplete="off"
                    disabled={input.kind === "null"}
                    placeholder={input.kind === "null" ? "NULL" : undefined}
                    inputMode={input.kind === "number" ? "decimal" : undefined}
                    value={input.kind === "null" ? "" : input.value}
                    onChange={event => update(name, { value: event.target.value })}
                  />
                  <NativeSelect
                    aria-label={`Tipo de :${name}`}
                    value={input.kind}
                    onChange={event => {
                      const kind = event.target.value;
                      if (isKind(kind)) {
                        update(name, { kind });
                      }
                    }}
                  >
                    {KINDS.map(kind => (
                      <option key={kind} value={kind}>
                        {KIND_LABELS[kind]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              );
            })}
            <div className="px-5 py-3">
              <p className="legend text-muted-foreground">Comando que vai rodar</p>
              {/* focusable so a long command scrolls from the keyboard */}
              <pre
                tabIndex={0}
                role="region"
                aria-label="Comando que vai rodar"
                aria-busy={preview.isFetching}
                className="mt-1.5 max-h-48 overflow-auto border border-foreground bg-background px-3.5 py-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap outline-none focus-visible:border-ring focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
              >
                {preview.isError ? "—" : (preview.data ?? "…")}
              </pre>
              {error ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {error}
                </p>
              ) : (
                preview.isError && (
                  // polite: it changes with every keystroke while a value is half typed
                  <p role="status" className="mt-2 text-sm text-destructive">
                    {errorMessage(preview.error)}
                  </p>
                )
              )}
            </div>
          </div>
          <SheetFooter
            hint={
              <DialogDescription className="text-xs">
                Texto entra entre aspas, Número sem aspas, NULL como NULL.
              </DialogDescription>
            }
          >
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Executar
            </Button>
          </SheetFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

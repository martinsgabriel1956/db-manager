import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ParamInput } from "@/features/editor/params";

type ParamsDialogProps = {
  /** each placeholder name once, in order of appearance */
  names: string[];
  /** the values last used in this tab */
  remembered: Record<string, ParamInput>;
  /** from the backend: a number that is not one, a NUL byte */
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
 * Asks the values of the `:name` placeholders before the SQL runs. Text goes in as a string
 * literal of the connection's dialect, a number bare, NULL as NULL: the backend writes them,
 * and the SQL that runs (and is confirmed and recorded) is the filled one.
 */
export function ParamsDialog({
  names,
  remembered,
  error,
  pending,
  onSubmit,
  onCancel
}: ParamsDialogProps) {
  const id = useId();
  const [values, setValues] = useState<Record<string, ParamInput>>(() =>
    Object.fromEntries(names.map(name => [name, remembered[name] ?? { kind: "text", value: "" }]))
  );

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
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Parâmetros</DialogTitle>
            <DialogDescription>
              Os valores entram no SQL como literais do banco; o comando que roda, é confirmado e
              vai para o histórico já vem preenchido.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-80 gap-3 overflow-auto">
            {names.map(name => {
              const input = values[name];
              return (
                <div key={name} className="grid grid-cols-[1fr_7rem] items-end gap-2">
                  <div className="grid gap-1.5">
                    <label htmlFor={`${id}-${name}`} className="font-mono text-sm">
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
                  </div>
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
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Executar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

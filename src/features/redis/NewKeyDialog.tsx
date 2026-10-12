import { useId, useState } from "react";
import type { KeyEdit } from "@/bindings";
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
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COLUMN_LABELS, newKeyEdits, type NewKeyKind } from "@/features/redis/entries";

type NewKeyDialogProps = {
  pending: boolean;
  /** from the backend (key exists, invalid score, …) */
  error: string | null;
  onCreate: (key: string, edits: KeyEdit[]) => void;
  onCancel: () => void;
};

const KINDS: NewKeyKind[] = ["string", "hash", "list", "set", "zset"];

/** A key is created with its first value: Redis has no empty collections. */
export function NewKeyDialog({ pending, error, onCreate, onCancel }: NewKeyDialogProps) {
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<NewKeyKind>("string");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [ttl, setTtl] = useState("");
  const id = useId();
  const [firstLabel, secondLabel] = kind === "string" ? ["Valor", null] : COLUMN_LABELS[kind];
  const ttlSecs = ttl === "" ? null : Number(ttl);
  const validTtl = ttlSecs === null || (Number.isInteger(ttlSecs) && ttlSecs > 0);

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova chave</DialogTitle>
          <DialogDescription>Uma chave nasce com o primeiro valor.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-key`}>Nome da chave</Label>
            <Input
              id={`${id}-key`}
              className="font-mono"
              value={key}
              onChange={event => setKey(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-kind`}>Tipo</Label>
            <NativeSelect
              id={`${id}-kind`}
              value={kind}
              onChange={event => setKind(event.target.value as NewKeyKind)}
            >
              {KINDS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-first`}>{firstLabel}</Label>
            <Input
              id={`${id}-first`}
              className="font-mono"
              value={first}
              onChange={event => setFirst(event.target.value)}
            />
          </div>
          {secondLabel && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-second`}>{secondLabel}</Label>
              <Input
                id={`${id}-second`}
                className="font-mono"
                value={second}
                onChange={event => setSecond(event.target.value)}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-ttl`}>TTL em segundos (opcional)</Label>
            <Input
              id={`${id}-ttl`}
              type="number"
              min={1}
              aria-invalid={!validTtl || undefined}
              aria-describedby={validTtl ? undefined : `${id}-ttl-error`}
              value={ttl}
              onChange={event => setTtl(event.target.value)}
            />
            {!validTtl && (
              <p id={`${id}-ttl-error`} className="text-xs text-destructive">
                Use um número inteiro de segundos, maior que zero.
              </p>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            disabled={pending || key === "" || !validTtl}
            onClick={() => onCreate(key, newKeyEdits(kind, { first, second }, ttlSecs))}
          >
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

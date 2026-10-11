import { useState } from "react";
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
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1">
            Nome
            <Input
              aria-label="Nome da chave"
              className="font-mono"
              value={key}
              onChange={event => setKey(event.target.value)}
            />
          </label>
          <label className="grid gap-1">
            Tipo
            <select
              aria-label="Tipo"
              className="h-8 rounded-md border border-input bg-transparent px-2"
              value={kind}
              onChange={event => setKind(event.target.value as NewKeyKind)}
            >
              {KINDS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            {firstLabel}
            <Input
              aria-label={firstLabel}
              className="font-mono"
              value={first}
              onChange={event => setFirst(event.target.value)}
            />
          </label>
          {secondLabel && (
            <label className="grid gap-1">
              {secondLabel}
              <Input
                aria-label={secondLabel}
                className="font-mono"
                value={second}
                onChange={event => setSecond(event.target.value)}
              />
            </label>
          )}
          <label className="grid gap-1">
            TTL em segundos (opcional)
            <Input
              aria-label="TTL da nova chave"
              type="number"
              min={1}
              aria-invalid={!validTtl || undefined}
              value={ttl}
              onChange={event => setTtl(event.target.value)}
            />
          </label>
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

import { useState, type FormEvent } from "react";
import type { Filter, FilterOp } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type BrowseToolbarProps = {
  columns: string[];
  active: Filter | null;
  /** locked while edits are pending */
  disabled?: boolean;
  onApply: (filter: Filter) => void;
  onClear: () => void;
};

const OP_LABEL: Record<FilterOp, string> = {
  eq: "=",
  like: "LIKE",
  isNull: "IS NULL",
  isNotNull: "IS NOT NULL"
};

const OPS = Object.keys(OP_LABEL) as FilterOp[];

export function BrowseToolbar({
  columns,
  active,
  disabled = false,
  onApply,
  onClear
}: BrowseToolbarProps) {
  const [column, setColumn] = useState(active?.column ?? "");
  const [op, setOp] = useState<FilterOp>(active?.op ?? "eq");
  const [value, setValue] = useState(active?.value ?? "");
  const needsValue = op === "eq" || op === "like";
  const selectedColumn = column || columns[0] || "";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedColumn || disabled) {
      return;
    }
    onApply({ column: selectedColumn, op, value: needsValue ? value : null });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-2"
    >
      {/* filtration is the only magenta: it lights up while a filter scopes the rows */}
      {active ? (
        <span className="inline-flex h-[18px] items-center bg-filter px-1.5 legend text-background">
          Filtro ativo
        </span>
      ) : (
        <span className="legend text-muted-foreground">Filtro</span>
      )}
      <NativeSelect
        aria-label="Coluna do filtro"
        className="h-7"
        value={selectedColumn}
        onChange={event => setColumn(event.target.value)}
      >
        {columns.map(name => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="Operador do filtro"
        className="h-7"
        value={op}
        onChange={event => setOp(event.target.value as FilterOp)}
      >
        {OPS.map(option => (
          <option key={option} value={option}>
            {OP_LABEL[option]}
          </option>
        ))}
      </NativeSelect>
      {needsValue && (
        <Input
          aria-label="Valor do filtro"
          className="h-7 w-56"
          placeholder={op === "like" ? "ex.: %@gmail.com" : "valor"}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      )}
      <Button type="submit" size="sm" variant="outline" disabled={!selectedColumn || disabled}>
        Aplicar
      </Button>
      {active && (
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onClear}>
          Limpar filtro
        </Button>
      )}
    </form>
  );
}

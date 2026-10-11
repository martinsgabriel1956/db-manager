import { useState, type FormEvent } from "react";
import type { Filter, FilterOp } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BrowseToolbarProps = {
  columns: string[];
  active: Filter | null;
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

const SELECT_CLASS = "h-7 rounded-md border border-input bg-transparent px-2 text-sm";

export function BrowseToolbar({ columns, active, onApply, onClear }: BrowseToolbarProps) {
  const [column, setColumn] = useState(active?.column ?? "");
  const [op, setOp] = useState<FilterOp>(active?.op ?? "eq");
  const [value, setValue] = useState(active?.value ?? "");
  const needsValue = op === "eq" || op === "like";
  const selectedColumn = column || columns[0] || "";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedColumn) {
      return;
    }
    onApply({ column: selectedColumn, op, value: needsValue ? value : null });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <span className="text-xs text-muted-foreground">Filtro</span>
      <select
        aria-label="Coluna do filtro"
        className={SELECT_CLASS}
        value={selectedColumn}
        onChange={event => setColumn(event.target.value)}
      >
        {columns.map(name => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select
        aria-label="Operador do filtro"
        className={SELECT_CLASS}
        value={op}
        onChange={event => setOp(event.target.value as FilterOp)}
      >
        {OPS.map(option => (
          <option key={option} value={option}>
            {OP_LABEL[option]}
          </option>
        ))}
      </select>
      {needsValue && (
        <Input
          aria-label="Valor do filtro"
          className="h-7 w-56"
          placeholder={op === "like" ? "ex.: %@gmail.com" : "valor"}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      )}
      <Button type="submit" size="sm" variant="outline" disabled={!selectedColumn}>
        Aplicar
      </Button>
      {active && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Limpar filtro
        </Button>
      )}
    </form>
  );
}

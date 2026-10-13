import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { Filter, FilterOp, Sort } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type BrowseToolbarProps = {
  columns: string[];
  active: Filter | null;
  /** the column sort, set from the grid header; cleared here */
  sort: Sort | null;
  /** locked while edits are pending */
  disabled?: boolean;
  /** id of the text saying why it is locked */
  lockedBy?: string;
  onApply: (filter: Filter) => void;
  onClear: () => void;
  onClearSort: () => void;
};

type FilterChipProps = {
  label: string;
  removeLabel: string;
  disabled: boolean;
  onRemove: () => void;
  children: ReactNode;
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
  sort,
  disabled = false,
  lockedBy,
  onApply,
  onClear,
  onClearSort
}: BrowseToolbarProps) {
  const [column, setColumn] = useState(active?.column ?? "");
  const [op, setOp] = useState<FilterOp>(active?.op ?? "eq");
  const [value, setValue] = useState(active?.value ?? "");
  const needsValue = op === "eq" || op === "like";
  const selectedColumn = column || columns[0] || "";
  // the inputs no longer say what scopes the rows: Aplicar becomes the next step
  const unapplied =
    active !== null &&
    (selectedColumn !== active.column ||
      op !== active.op ||
      (needsValue && value !== (active.value ?? "")));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedColumn || disabled) {
      return;
    }
    onApply({ column: selectedColumn, op, value: needsValue ? value : null });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-b bg-muted px-3 py-2">
      <span className="legend text-muted-foreground">Filtro</span>
      <NativeSelect
        aria-label="Coluna do filtro"
        className="h-7 max-w-40"
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
        // as wide as the chosen operator where the engine supports it ("=" needs no 115px)
        className="h-7 [field-sizing:content]"
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
          className="h-7 w-44 min-w-0 shrink"
          placeholder={op === "like" ? "ex.: %@gmail.com" : "valor"}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      )}
      {/* inputs that no longer match the applied filter make Aplicar the next step */}
      <Button
        type="submit"
        size="sm"
        variant={unapplied ? "default" : "outline"}
        disabled={!selectedColumn || disabled}
        aria-describedby={disabled ? lockedBy : undefined}
      >
        Aplicar
      </Button>
      {/* filtration is the only magenta: the chips say exactly what scopes the rows */}
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        {active && (
          <FilterChip
            label="Filtro"
            removeLabel="Limpar filtro"
            disabled={disabled}
            onRemove={onClear}
          >
            {filterText(active)}
          </FilterChip>
        )}
        {sort && (
          <FilterChip
            label="Ordenado"
            removeLabel="Remover ordenação"
            disabled={disabled}
            onRemove={onClearSort}
          >
            {sort.column}
            {sort.direction === "asc" ? (
              <ArrowUp aria-hidden className="ml-0.5 inline size-3" />
            ) : (
              <ArrowDown aria-hidden className="ml-0.5 inline size-3" />
            )}
            <span className="sr-only">
              {sort.direction === "asc" ? " crescente" : " decrescente"}
            </span>
          </FilterChip>
        )}
      </div>
    </form>
  );
}

/** The applied condition as it reads in SQL: `id = 42`, `email LIKE %@x`, `deleted_at IS NULL`. */
export function filterText(filter: Filter): string {
  const op = OP_LABEL[filter.op];
  return filter.op === "eq" || filter.op === "like"
    ? `${filter.column} ${op} ${filter.value ?? ""}`
    : `${filter.column} ${op}`;
}

function FilterChip({ label, removeLabel, disabled, onRemove, children }: FilterChipProps) {
  return (
    <span className="inline-flex h-[18px] min-w-0 items-center gap-1 bg-filter pl-1.5 text-background">
      <span className="legend">{label}</span>
      <span className="min-w-0 truncate font-mono text-[11px]">{children}</span>
      <button
        type="button"
        aria-label={removeLabel}
        disabled={disabled}
        onClick={onRemove}
        className="relative grid h-full w-[18px] shrink-0 place-items-center outline-none after:absolute after:-inset-[3px] after:content-[''] hover:bg-background/20 focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-inset disabled:opacity-50"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

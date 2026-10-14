import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { Filter, FilterOp, Sort } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type BrowseToolbarProps = {
  columns: string[];
  /** the conditions scoping the rows, all of them at once (AND) */
  active: Filter[];
  /** the column sort, set from the grid header; cleared here */
  sort: Sort | null;
  /** locked while edits are pending */
  disabled?: boolean;
  /** id of the text saying why it is locked */
  lockedBy?: string;
  onChange: (filters: Filter[]) => void;
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
  ne: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
  like: "LIKE",
  in: "IN",
  isNull: "IS NULL",
  isNotNull: "IS NOT NULL"
};

const PLACEHOLDER: Partial<Record<FilterOp, string>> = {
  like: "ex.: %@gmail.com",
  in: "ex.: 1, 2, 3"
};

const needsValue = (op: FilterOp) => op !== "isNull" && op !== "isNotNull";

const sameCondition = (a: Filter, b: Filter) =>
  a.column === b.column && a.op === b.op && (a.value ?? "") === (b.value ?? "");

const OPS = Object.keys(OP_LABEL) as FilterOp[];

export function BrowseToolbar({
  columns,
  active,
  sort,
  disabled = false,
  lockedBy,
  onChange,
  onClearSort
}: BrowseToolbarProps) {
  const [column, setColumn] = useState("");
  const [op, setOp] = useState<FilterOp>("eq");
  const [value, setValue] = useState("");
  const selectedColumn = column || columns[0] || "";
  const draft: Filter = {
    column: selectedColumn,
    op,
    value: needsValue(op) ? value : null
  };
  // a condition typed but not yet among the applied ones: Aplicar becomes the next step
  const unapplied =
    active.length > 0 &&
    (!needsValue(op) || value !== "") &&
    !active.some(filter => sameCondition(filter, draft));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedColumn || disabled) {
      return;
    }
    // one condition per column and operator: applying `id > 5` again replaces `id > 3`
    onChange([
      ...active.filter(filter => filter.column !== draft.column || filter.op !== draft.op),
      draft
    ]);
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
      {needsValue(op) && (
        <Input
          aria-label="Valor do filtro"
          className="h-7 w-44 min-w-0 shrink"
          placeholder={PLACEHOLDER[op] ?? "valor"}
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
        {active.map((filter, index) => (
          <FilterChip
            key={filterText(filter)}
            // every condition is ANDed: the second chip on says so
            label={index === 0 ? "Filtro" : "E"}
            removeLabel={`Remover filtro ${filterText(filter)}`}
            disabled={disabled}
            onRemove={() => onChange(active.filter(other => other !== filter))}
          >
            {filterText(filter)}
          </FilterChip>
        ))}
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

/** The applied condition as it reads in SQL: `id = 42`, `id IN (1, 2)`, `deleted_at IS NULL`. */
export function filterText(filter: Filter): string {
  const op = OP_LABEL[filter.op];
  if (!needsValue(filter.op)) {
    return `${filter.column} ${op}`;
  }
  return filter.op === "in"
    ? `${filter.column} ${op} (${filter.value ?? ""})`
    : `${filter.column} ${op} ${filter.value ?? ""}`;
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

import type { Cell, DiagramTable, Filter, ForeignKeyInfo, ResultColumn } from "@/bindings";
import { formatCell } from "@/features/results/format";

/** A table to open, filtered down to the rows a foreign key links. */
export type Hop = { schema: string; table: string; filters: Filter[] };

/** A foreign key of another table pointing at this one: the rows that reference a row. */
export type IncomingKey = { schema: string; table: string; key: ForeignKeyInfo };

/**
 * The stored value as the equality filter's text; null when it points nowhere (NULL)
 * or when the grid only holds part of it (a binary preview, an array).
 */
export function filterValue(cell: Cell): string | null {
  if (cell.t === "null" || cell.t === "bytes" || cell.t === "array") {
    return null;
  }
  return formatCell(cell);
}

/**
 * `toColumns[i] = row[fromColumns[i]]` for every column of the key; null when any value
 * is NULL (a composite key with a NULL references nothing) or not exact.
 */
export function matchFilters(
  columns: ResultColumn[],
  row: Cell[],
  fromColumns: string[],
  toColumns: string[]
): Filter[] | null {
  if (fromColumns.length === 0 || fromColumns.length !== toColumns.length) {
    return null;
  }
  const filters: Filter[] = [];
  for (const [position, from] of fromColumns.entries()) {
    const index = columns.findIndex(column => column.name === from);
    const value = index < 0 ? null : filterValue(row[index]);
    if (value === null) {
      return null;
    }
    filters.push({ column: toColumns[position], op: "eq", value });
  }
  return filters;
}

/** The first foreign key the column belongs to. */
// ponytail: a column in two foreign keys follows the first; a picker when that shows up
export function keyOfColumn(keys: ForeignKeyInfo[], column: string): ForeignKeyInfo | null {
  return keys.find(key => key.columns.includes(column)) ?? null;
}

/** Foreign keys of the schema's tables that point at `table` (self references included). */
export function incomingKeys(tables: DiagramTable[], schema: string, table: string): IncomingKey[] {
  return tables.flatMap(candidate =>
    candidate.foreignKeys
      .filter(key => key.referencedSchema === schema && key.referencedTable === table)
      .map(key => ({ schema, table: candidate.name, key }))
  );
}

/** "pedidos (cliente_id)" */
export function incomingLabel(incoming: IncomingKey): string {
  return `${incoming.table} (${incoming.key.columns.join(", ")})`;
}

import type { Cell, ResultColumn, RowChange } from "@/bindings";
import { formatCell } from "@/features/results/format";

/** A value typed by the user; null writes NULL. */
export type EditValue = string | null;

export type NewRow = { id: string; values: Record<string, EditValue> };

/**
 * Pending grid edits for one page. Existing rows are addressed by their index in
 * the page, which stays fixed while edits are pending (navigation is locked).
 */
export type Staged = {
  updates: Record<number, Record<string, EditValue>>;
  deletes: number[];
  inserts: NewRow[];
};

export const EMPTY_STAGED: Staged = { updates: {}, deletes: [], inserts: [] };

export function stagedCount(staged: Staged): number {
  const updatedRows = Object.keys(staged.updates).filter(
    row => !staged.deletes.includes(Number(row))
  ).length;
  return updatedRows + staged.deletes.length + staged.inserts.length;
}

/** Value the inline editor starts from: the text PostgreSQL renders, or null for NULL. */
export function editText(cell: Cell): EditValue {
  return cell.t === "null" ? null : formatCell(cell);
}

/** Stages an edit on an existing row; typing the original value back removes it. */
export function stageUpdate(
  staged: Staged,
  rowIndex: number,
  column: string,
  value: EditValue,
  original: Cell
): Staged {
  const unchanged = value === editText(original);
  const rowEdits = { ...staged.updates[rowIndex] };
  if (unchanged) {
    delete rowEdits[column];
  } else {
    rowEdits[column] = value;
  }
  const updates = { ...staged.updates };
  if (Object.keys(rowEdits).length === 0) {
    delete updates[rowIndex];
  } else {
    updates[rowIndex] = rowEdits;
  }
  return { ...staged, updates };
}

export function stageInsertValue(
  staged: Staged,
  rowId: string,
  column: string,
  value: EditValue
): Staged {
  return {
    ...staged,
    inserts: staged.inserts.map(row =>
      row.id === rowId ? { ...row, values: { ...row.values, [column]: value } } : row
    )
  };
}

export function toggleDelete(staged: Staged, rowIndex: number): Staged {
  const deletes = staged.deletes.includes(rowIndex)
    ? staged.deletes.filter(row => row !== rowIndex)
    : [...staged.deletes, rowIndex];
  return { ...staged, deletes };
}

export function addRow(staged: Staged): Staged {
  return { ...staged, inserts: [...staged.inserts, { id: crypto.randomUUID(), values: {} }] };
}

export function removeNewRow(staged: Staged, rowId: string): Staged {
  return { ...staged, inserts: staged.inserts.filter(row => row.id !== rowId) };
}

function cellFor(value: EditValue): Cell {
  return value === null ? { t: "null" } : { t: "text", v: value };
}

/** Columns left out of a new row get their DEFAULT; shown as such, never sent. */
export const DEFAULT_CELL: Cell = { t: "unknown", v: { typeName: "default", text: "DEFAULT" } };

/** Page rows with pending edits applied, followed by the new rows. */
export function displayRows(rows: Cell[][], columns: ResultColumn[], staged: Staged): Cell[][] {
  const edited = rows.map((row, rowIndex) => {
    const edits = staged.updates[rowIndex];
    if (!edits) {
      return row;
    }
    return row.map((cell, columnIndex) => {
      const name = columns[columnIndex].name;
      return name in edits ? cellFor(edits[name]) : cell;
    });
  });
  const added = staged.inserts.map(insert =>
    columns.map(column =>
      column.name in insert.values ? cellFor(insert.values[column.name]) : DEFAULT_CELL
    )
  );
  return [...edited, ...added];
}

/**
 * Pending edits → backend changes: deletes first, then updates, then inserts, so a
 * row can be replaced without tripping a unique constraint. Rows are identified by
 * their original primary-key values.
 */
export function buildChanges(
  rows: Cell[][],
  columns: ResultColumn[],
  primaryKey: string[],
  staged: Staged
): RowChange[] {
  const key = (rowIndex: number) =>
    primaryKey.map(column => ({
      column,
      value: rows[rowIndex][columns.findIndex(c => c.name === column)]
    }));
  const toValues = (values: Record<string, EditValue>) =>
    Object.entries(values).map(([column, value]) => ({ column, value }));

  const deletes: RowChange[] = staged.deletes.map(rowIndex => ({
    kind: "delete",
    key: key(rowIndex)
  }));
  const updates: RowChange[] = Object.entries(staged.updates)
    .map(([row, values]) => [Number(row), values] as const)
    .filter(([rowIndex]) => !staged.deletes.includes(rowIndex))
    .map(([rowIndex, values]) => ({
      kind: "update",
      key: key(rowIndex),
      values: toValues(values)
    }));
  const inserts: RowChange[] = staged.inserts.map(insert => ({
    kind: "insert",
    values: toValues(insert.values)
  }));
  return [...deletes, ...updates, ...inserts];
}

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commands, type Confirmation, type ResultColumn, type RowBatch } from "@/bindings";
import type { GridEditing } from "@/features/results/ResultGrid";
import {
  addRow,
  buildChanges,
  displayRows,
  editText,
  EMPTY_STAGED,
  removeNewRow,
  stagedCount,
  stageInsertValue,
  stageUpdate,
  toggleDelete,
  type EditValue,
  type Staged
} from "@/features/table/staged";
import { errorMessage } from "@/lib/errors";

type Params = {
  connectionId: string;
  schema: string;
  table: string;
  readOnly: boolean;
  batch: RowBatch | undefined;
  primaryKey: string[];
};

/**
 * Staged edits for one page of a table, saved in one transaction. Editing needs a
 * writable connection and a primary key the backend can match rows by.
 */
export function useTableEditing({
  connectionId,
  schema,
  table,
  readOnly,
  batch,
  primaryKey
}: Params) {
  const [staged, setStaged] = useState<Staged>(EMPTY_STAGED);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** cells just saved, kept for one beat so their hatch develops away */
  const [developed, setDeveloped] = useState<Record<number, string[]> | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!developed) {
      return;
    }
    const timer = setTimeout(() => setDeveloped(null), 400);
    return () => clearTimeout(timer);
  }, [developed]);

  const columns: ResultColumn[] = batch?.columns ?? [];
  const pageRows = batch?.rows ?? [];
  const keyEditable =
    primaryKey.length > 0 &&
    primaryKey.every(name => columns.find(column => column.name === name)?.editable);
  const canEdit = !readOnly && keyEditable && batch !== undefined;
  const count = stagedCount(staged);
  const rows = displayRows(pageRows, columns, staged);

  const newRowAt = (row: number) =>
    row >= pageRows.length ? staged.inserts[row - pageRows.length] : undefined;

  const save = useMutation({
    mutationFn: (confirmed: boolean) =>
      commands.applyChanges(
        connectionId,
        { schema, table, changes: buildChanges(pageRows, columns, primaryKey, staged) },
        confirmed
      ),
    onSuccess: response => {
      if (response.status === "needsConfirmation") {
        setConfirmation(response.confirmation);
        return;
      }
      setConfirmation(null);
      setDeveloped(
        Object.fromEntries(
          Object.entries(staged.updates).map(([row, values]) => [row, Object.keys(values)])
        )
      );
      setStaged(EMPTY_STAGED);
      setNotice(
        `${response.rowsChanged} ${response.rowsChanged === 1 ? "alteração salva" : "alterações salvas"}`
      );
      queryClient.invalidateQueries({ queryKey: ["browse", connectionId] });
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
    onError: () => {
      setConfirmation(null);
      queryClient.invalidateQueries({ queryKey: ["history"] });
    }
  });

  function setValue(row: number, column: number, value: EditValue) {
    const name = columns[column].name;
    const inserted = newRowAt(row);
    setNotice(null);
    setStaged(prev =>
      inserted
        ? stageInsertValue(prev, inserted.id, name, value)
        : stageUpdate(prev, row, name, value, pageRows[row][column])
    );
  }

  const editing: GridEditing = {
    canEdit: (row, column) => canEdit && columns[column].editable && !staged.deletes.includes(row),
    textFor: (row, column) => {
      const name = columns[column].name;
      const inserted = newRowAt(row);
      const pending = inserted ? inserted.values : staged.updates[row];
      if (pending && name in pending) {
        return pending[name] ?? "";
      }
      return inserted ? "" : editText(pageRows[row][column]);
    },
    onCommit: (row, column, value) => setValue(row, column, value),
    rowStatus: row => (newRowAt(row) ? "new" : staged.deletes.includes(row) ? "deleted" : null),
    isEdited: (row, column) => {
      const name = columns[column].name;
      const inserted = newRowAt(row);
      return name in (inserted ? inserted.values : (staged.updates[row] ?? {}));
    },
    isDeveloping: (row, column) => developed?.[row]?.includes(columns[column].name) ?? false
  };

  return {
    rows,
    editing,
    canEdit,
    keyEditable,
    count,
    isNewRow: (row: number) => newRowAt(row) !== undefined,
    isDeleted: (row: number) => staged.deletes.includes(row),
    setValue,
    addRow: () => {
      setNotice(null);
      setStaged(addRow);
    },
    /** deletes/restores an existing row, drops a new one */
    toggleRow: (row: number) => {
      const inserted = newRowAt(row);
      setNotice(null);
      setStaged(prev => (inserted ? removeNewRow(prev, inserted.id) : toggleDelete(prev, row)));
    },
    discard: () => {
      save.reset();
      setStaged(EMPTY_STAGED);
    },
    save: () => save.mutate(false),
    saving: save.isPending,
    saveError: save.error ? errorMessage(save.error) : null,
    notice,
    /** the notice speaks of the rows on screen: gone once another page, filter or order shows */
    clearNotice: () => setNotice(null),
    confirmation,
    confirm: () => save.mutate(true),
    dismiss: () => setConfirmation(null)
  };
}

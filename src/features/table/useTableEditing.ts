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
  stagedDiff,
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
  /** per column name: the values it accepts (enum, boolean) */
  options: Record<string, string[]>;
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
  primaryKey,
  options
}: Params) {
  const [staged, setStaged] = useState<Staged>(EMPTY_STAGED);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  /** the saved line; `confirmed` when it went through the confirmation, which earns a receipt */
  const [notice, setNotice] = useState<{ text: string; confirmed: boolean } | null>(null);
  /** the confirmation was cancelled: nothing ran, the edits stay staged */
  const [cancelled, setCancelled] = useState(false);
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
    onSuccess: (response, confirmed) => {
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
      setNotice({
        text: `${response.rowsChanged} ${response.rowsChanged === 1 ? "alteração salva" : "alterações salvas"}`,
        confirmed
      });
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
    setCancelled(false);
    setStaged(prev =>
      inserted
        ? stageInsertValue(prev, inserted.id, name, value)
        : stageUpdate(prev, row, name, value, pageRows[row][column])
    );
  }

  /** an edited existing cell goes back to what is stored: the edit leaves the stage */
  function revert(row: number, column: number) {
    if (newRowAt(row) || !(columns[column].name in (staged.updates[row] ?? {}))) {
      return;
    }
    setValue(row, column, editText(pageRows[row][column]));
  }

  const editing: GridEditing = {
    // a selection can outlive its row (a new row dropped while selected): nothing to edit there
    canEdit: (row, column) =>
      canEdit && row < rows.length && columns[column].editable && !staged.deletes.includes(row),
    textFor: (row, column) => {
      const name = columns[column].name;
      const inserted = newRowAt(row);
      const pending = inserted ? inserted.values : staged.updates[row];
      if (pending && name in pending) {
        return pending[name];
      }
      return inserted ? "" : editText(pageRows[row][column]);
    },
    onCommit: (row, column, value) => setValue(row, column, value),
    optionsFor: column => options[columns[column].name] ?? [],
    rowStatus: row => (newRowAt(row) ? "new" : staged.deletes.includes(row) ? "deleted" : null),
    isEdited: (row, column) => {
      const name = columns[column].name;
      const inserted = newRowAt(row);
      return name in (inserted ? inserted.values : (staged.updates[row] ?? {}));
    },
    isDeveloping: (row, column) => developed?.[row]?.includes(columns[column].name) ?? false,
    originalFor: (row, column) =>
      !newRowAt(row) && columns[column].name in (staged.updates[row] ?? {})
        ? pageRows[row][column]
        : null,
    revert
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
      setCancelled(false);
      setStaged(addRow);
    },
    /** deletes/restores an existing row, drops a new one */
    toggleRow: (row: number) => {
      const inserted = newRowAt(row);
      setNotice(null);
      setCancelled(false);
      setStaged(prev => (inserted ? removeNewRow(prev, inserted.id) : toggleDelete(prev, row)));
    },
    discard: () => {
      save.reset();
      setCancelled(false);
      setStaged(EMPTY_STAGED);
    },
    save: () => {
      setCancelled(false);
      save.mutate(false);
    },
    saving: save.isPending,
    saveError: save.error ? errorMessage(save.error) : null,
    notice,
    /** the notice speaks of the rows on screen: gone once another page, filter or order shows */
    clearNotice: () => setNotice(null),
    confirmation,
    /** what each staged update replaces, read on the confirmation before signing it */
    diff: confirmation ? stagedDiff(pageRows, columns, primaryKey, staged) : [],
    confirm: () => save.mutate(true),
    cancelled,
    dismiss: () => {
      setConfirmation(null);
      setCancelled(true);
    }
  };
}

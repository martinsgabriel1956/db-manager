import { useState, type FormEvent } from "react";
import type { ConnectionConfig } from "@/bindings";
import { Button } from "@/components/ui/button";
import { ConnectionFields } from "@/features/connections/ConnectionFields";
import {
  changeEngine,
  EMPTY_FORM,
  fromConfig,
  parseForm,
  type ConnectionFormValues,
  type FormErrors
} from "@/features/connections/form";
import { useDeleteConnection, useSaveConnection } from "@/features/connections/queries";
import { errorMessage } from "@/lib/errors";

type ConnectionFormProps = {
  /** null = creating a new connection */
  connection: ConnectionConfig | null;
  onSaved: (id: string, keychainWarning: string | null) => void;
  onDeleted: (keychainWarning: string | null) => void;
};

export function ConnectionForm({ connection, onSaved, onDeleted }: ConnectionFormProps) {
  const isEditing = connection !== null;
  // lazy init: the id must stay stable across re-renders of a new, unsaved connection
  const [id] = useState(() => connection?.id ?? crypto.randomUUID());
  const [values, setValues] = useState<ConnectionFormValues>(
    connection ? fromConfig(connection) : EMPTY_FORM
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const save = useSaveConnection();
  const remove = useDeleteConnection();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseForm(values, id);
    if (!parsed.success) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    save.mutate(
      { config: parsed.config, secret: parsed.secret },
      {
        onSuccess: outcome => {
          // the secret was applied; re-saving must not set or clear it again
          setValues(prev => ({ ...prev, password: "", clearPassword: false }));
          onSaved(id, outcome.keychainWarning);
        }
      }
    );
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    remove.mutate(id, { onSuccess: outcome => onDeleted(outcome.keychainWarning) });
  }

  const serverError = save.error ?? remove.error;

  return (
    <form onSubmit={handleSubmit} className="grid max-w-xl gap-6" noValidate>
      <h2 className="text-lg font-semibold">{isEditing ? "Editar conexão" : "Nova conexão"}</h2>

      <ConnectionFields
        values={values}
        errors={errors}
        isEditing={isEditing}
        onChange={patch => setValues(prev => ({ ...prev, ...patch }))}
        onEngineChange={engine => setValues(prev => changeEngine(prev, engine))}
      />

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(serverError)}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          Salvar
        </Button>
        {isEditing && (
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={handleDelete}
          >
            {confirmingDelete ? "Confirmar exclusão" : "Excluir"}
          </Button>
        )}
      </div>
    </form>
  );
}

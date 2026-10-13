import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { commands, type ConnectionConfig } from "@/bindings";
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
import {
  useDeleteConnection,
  useSaveConnection,
  type SaveConnectionInput
} from "@/features/connections/queries";
import { errorMessage } from "@/lib/errors";

type ConnectionFormProps = {
  /** null = creating a new connection */
  connection: ConnectionConfig | null;
  onSaved: (id: string, keychainWarning: string | null) => void;
  onDeleted: (keychainWarning: string | null) => void;
  onCancel: () => void;
};

/** Connects with the draft, saved or not, and closes; the elapsed time is all it reports. */
async function testDraft({ config, secret }: SaveConnectionInput): Promise<number> {
  const started = performance.now();
  await commands.testConnection(config, secret);
  return Math.round(performance.now() - started);
}

export function ConnectionForm({ connection, onSaved, onDeleted, onCancel }: ConnectionFormProps) {
  const isEditing = connection !== null;
  // lazy init: the id must stay stable across re-renders of a new, unsaved connection
  const [id] = useState(() => connection?.id ?? crypto.randomUUID());
  const [values, setValues] = useState<ConnectionFormValues>(
    connection ? fromConfig(connection) : EMPTY_FORM
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const save = useSaveConnection();
  const remove = useDeleteConnection();
  const test = useMutation({ mutationFn: testDraft });
  // a result speaks only for the values it tested: editing a field retires it
  const [testedValues, setTestedValues] = useState<string | null>(null);
  const testIsCurrent = testedValues === JSON.stringify(values);

  function focusFirstInvalid() {
    // once the fields are marked, land on the first one so its error is read with it
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus()
    );
  }

  function handleTest() {
    // name and environment never reach the database: a draft without them can still be tested
    const parsed = parseForm(
      {
        ...values,
        name: values.name.trim() || "rascunho",
        environment: values.environment || "local"
      },
      id,
      isEditing
    );
    if (!parsed.success) {
      setErrors(parsed.errors);
      focusFirstInvalid();
      return;
    }
    setErrors({});
    setTestedValues(JSON.stringify(values));
    test.mutate({ config: parsed.config, secret: parsed.secret });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseForm(values, id, isEditing);
    if (!parsed.success) {
      setErrors(parsed.errors);
      focusFirstInvalid();
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
    <form ref={formRef} onSubmit={handleSubmit} className="grid max-w-xl gap-6" noValidate>
      {/* editing names which connection: the identifier keeps its case, like a table name */}
      <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-3 border-b-2 border-foreground pb-2">
        <span className="display-caps text-[1.75rem]">
          {isEditing ? "Editar conexão" : "Nova conexão"}
        </span>
        {connection && (
          <span className="min-w-0 display text-[1.75rem] leading-[1.15] [overflow-wrap:anywhere]">
            <span className="sr-only">: </span>
            {connection.name}
          </span>
        )}
      </h2>

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

      {test.isSuccess && testIsCurrent && (
        <p role="status" className="text-sm text-success">
          Conectou em {test.data} ms: o banco respondeu.
        </p>
      )}
      {test.isError && testIsCurrent && (
        <div role="alert" className="grid gap-1 text-sm">
          <p className="text-destructive">Não conectou: {errorMessage(test.error)}</p>
          <p className="text-xs text-muted-foreground">
            Nada foi salvo. Confira host, porta, usuário e senha; com TLS em Exigir, o servidor
            precisa aceitar TLS. Banco atrás de bastion: abra um túnel antes (ssh -L).
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          Salvar
        </Button>
        {/* tests what is typed, without saving: wrong credentials never reach the keychain */}
        <Button type="button" variant="outline" disabled={test.isPending} onClick={handleTest}>
          {test.isPending ? "Testando…" : "Testar conexão"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        {isEditing && (
          <Button
            type="button"
            variant={confirmingDelete ? "destructive" : "outline"}
            // kept apart from save and test: a different kind of action
            className={confirmingDelete ? "ml-auto" : "ml-auto text-destructive"}
            disabled={remove.isPending}
            onClick={handleDelete}
            onBlur={() => setConfirmingDelete(false)}
            onKeyDown={event => event.key === "Escape" && setConfirmingDelete(false)}
          >
            {confirmingDelete ? "Confirmar exclusão" : "Excluir"}
          </Button>
        )}
      </div>
    </form>
  );
}

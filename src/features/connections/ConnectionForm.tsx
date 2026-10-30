import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { commands, type ConnectionConfig } from "@/bindings";
import { DeleteStrip, keepArmedFocus } from "@/components/DeleteStrip";
import { Button } from "@/components/ui/button";
import { ConnectionFields } from "@/features/connections/ConnectionFields";
import {
  changeEngine,
  duplicateForm,
  EMPTY_FORM,
  fromConfig,
  parseForm,
  type ConnectionFormValues,
  type FormErrors
} from "@/features/connections/form";
import {
  useConnections,
  useDeleteConnection,
  useSaveConnection,
  type SaveConnectionInput
} from "@/features/connections/queries";
import { byGroup } from "@/features/explorer/treeNav";
import { errorMessage } from "@/lib/errors";

type ConnectionFormProps = {
  /** null = creating a new connection */
  connection: ConnectionConfig | null;
  /** a new connection filled from this one ("Duplicar conexão") */
  copyOf?: ConnectionConfig | null;
  onSaved: (id: string, keychainWarning: string | null) => void;
  onDeleted: (keychainWarning: string | null) => void;
  onCancel: () => void;
  /** typed but not saved: the parked form's tab says "rascunho" */
  onEditedChange?: (edited: boolean) => void;
};

/** Connects with the draft, saved or not, and closes; the elapsed time is all it reports. */
async function testDraft({
  config,
  secret,
  sshSecret,
  sentinelSecret
}: SaveConnectionInput): Promise<number> {
  const started = performance.now();
  await commands.testConnection(config, secret, sshSecret, sentinelSecret);
  return Math.round(performance.now() - started);
}

export function ConnectionForm({
  connection,
  copyOf = null,
  onSaved,
  onDeleted,
  onCancel,
  onEditedChange
}: ConnectionFormProps) {
  const isEditing = connection !== null;
  // lazy init: the id must stay stable across re-renders of a new, unsaved connection
  const [id] = useState(() => connection?.id ?? crypto.randomUUID());
  const [initial] = useState<ConnectionFormValues>(() =>
    connection ? fromConfig(connection) : copyOf ? duplicateForm(copyOf) : EMPTY_FORM
  );
  // fixed with the id: the copy keeps pointing at the original's secrets until saved
  const [copyOfId] = useState(() => copyOf?.id);
  const [values, setValues] = useState(initial);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // typed but not saved: cancelling asks once instead of dropping it. On a new connection,
  // picking an engine alone types nothing: compared on the starting engine, the defaults it
  // swapped in (port, TLS, database) fall away
  const compared = isEditing ? values : changeEngine(values, initial.engine);
  const edited = JSON.stringify(compared) !== JSON.stringify(initial);
  useEffect(() => onEditedChange?.(edited), [edited, onEditedChange]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const cancelTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // opened from the sidebar, the palette or a menu: the focus follows to the form's title,
  // which names what is being edited, and Tab goes on to the first field
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  const save = useSaveConnection();
  const connections = useConnections();
  const groups = byGroup(connections.data ?? []).groups.map(group => group.name);
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
      isEditing,
      copyOfId
    );
    if (!parsed.success) {
      setErrors(parsed.errors);
      focusFirstInvalid();
      return;
    }
    setErrors({});
    setTestedValues(JSON.stringify(values));
    test.mutate(parsed);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseForm(values, id, isEditing, copyOfId);
    if (!parsed.success) {
      setErrors(parsed.errors);
      focusFirstInvalid();
      return;
    }
    setErrors({});
    save.mutate(parsed, {
      onSuccess: outcome => {
        // the secrets were applied; re-saving must not set or clear them again
        setValues(prev => ({
          ...prev,
          password: "",
          clearPassword: false,
          sshPassword: "",
          clearSshPassword: false,
          sentinelPassword: "",
          clearSentinelPassword: false
        }));
        onSaved(id, outcome.keychainWarning);
      }
    });
  }

  function handleCancel() {
    if (edited) {
      setConfirmingDelete(false);
      setConfirmingCancel(armed => !armed);
      return;
    }
    onCancel();
  }

  function handleDelete() {
    setConfirmingCancel(false);
    setConfirmingDelete(armed => !armed);
  }

  const serverError = save.error ?? remove.error;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid max-w-xl gap-6" noValidate>
      {/* editing names which connection: the identifier keeps its case, like a table name */}
      <h2
        ref={titleRef}
        tabIndex={-1}
        className="flex min-w-0 flex-wrap items-baseline gap-x-3 border-b-2 border-foreground pb-2 outline-none"
      >
        <span className="display-caps text-[1.75rem]">
          {isEditing ? "Editar conexão" : copyOf ? "Duplicar conexão" : "Nova conexão"}
        </span>
        {(connection ?? copyOf) && (
          <span className="min-w-0 display text-[1.75rem] leading-[1.15] [overflow-wrap:anywhere]">
            <span className="sr-only">: </span>
            {(connection ?? copyOf)?.name}
          </span>
        )}
      </h2>

      <ConnectionFields
        values={values}
        errors={errors}
        storedSecret={isEditing ? "own" : copyOfId ? "copy" : null}
        groups={groups}
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
            precisa aceitar TLS. Banco atrás de bastion: marque Conectar por túnel SSH.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* in the order of the work: try what is typed, then keep it. Testing never saves:
            wrong credentials never reach the keychain */}
        <Button type="button" variant="outline" disabled={test.isPending} onClick={handleTest}>
          {test.isPending ? "Testando…" : "Testar conexão"}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          Salvar
        </Button>
        {/* both arm a strip below, away from the trigger: a second press disarms, so a double
            click never drops what was typed or deletes the connection */}
        <Button
          type="button"
          variant="ghost"
          ref={cancelTriggerRef}
          aria-expanded={edited ? confirmingCancel : undefined}
          onMouseDown={keepArmedFocus(confirmingCancel)}
          onClick={handleCancel}
        >
          Cancelar
        </Button>
        {isEditing && (
          <Button
            type="button"
            variant="outline"
            ref={deleteTriggerRef}
            // kept apart from save and test: a different kind of action
            className="ml-auto text-destructive"
            aria-expanded={confirmingDelete}
            disabled={remove.isPending}
            onMouseDown={keepArmedFocus(confirmingDelete)}
            onClick={handleDelete}
          >
            Excluir
          </Button>
        )}
      </div>
      {confirmingCancel && (
        <DeleteStrip
          message="O que foi digitado aqui some; a conexão salva não muda."
          confirmLabel="Descartar o que foi digitado"
          keepLabel="Continuar editando"
          variant="outline"
          onConfirm={onCancel}
          onDisarm={() => setConfirmingCancel(false)}
          triggerRef={cancelTriggerRef}
        />
      )}
      {confirmingDelete && (
        <DeleteStrip
          message={`Exclui a conexão ${connection?.name ?? ""} e as senhas dela no keychain. Não dá para desfazer.`}
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(id, { onSuccess: outcome => onDeleted(outcome.keychainWarning) })
          }
          onDisarm={() => setConfirmingDelete(false)}
          triggerRef={deleteTriggerRef}
        />
      )}
    </form>
  );
}

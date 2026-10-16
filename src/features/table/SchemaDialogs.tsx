import { useId, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { commands, type ColumnDefinition, type ColumnInfo, type SchemaChange } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { connected } from "@/features/explorer/queries";
import { useSchemaChange } from "@/features/table/useSchemaChange";
import { errorMessage } from "@/lib/errors";

/** What every form gets: it only builds the change; the backend answers with the DDL. */
export type ReviewProps = {
  /** false while the confirmation shows the command: the form waits behind it, filled */
  open: boolean;
  pending: boolean;
  error: string | null;
  onReview: (change: SchemaChange) => void;
  onCancel: () => void;
};

type ShellProps = ReviewProps & {
  title: string;
  description: ReactNode;
  /** null when the form is complete; otherwise what is missing, said by the disabled button */
  change: SchemaChange | null;
  children: ReactNode;
};

function FormShell({
  open,
  pending,
  error,
  onReview,
  onCancel,
  title,
  description,
  change,
  children
}: ShellProps) {
  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault();
            if (change && !pending) {
              onReview(change);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            {/* nothing runs here: the next step shows the exact command */}
            <Button type="submit" disabled={pending || change === null}>
              {pending ? "Gerando…" : "Revisar comando"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  label,
  value,
  onChange,
  hint,
  autoFocus
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="font-mono"
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        aria-describedby={hint ? `${id}-hint` : undefined}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

const TYPE_HINT = "SQL do banco, como no CREATE TABLE: varchar(100), integer, timestamptz…";
const DEFAULT_HINT = "Expressão SQL, entra como digitada: texto entre aspas ('ativo'), now(), 0.";

/** "" is no default */
function optional(text: string): string | null {
  return text.trim() === "" ? null : text;
}

const EMPTY_COLUMN: ColumnDefinition = { name: "", dataType: "", nullable: true, default: null };

export function AddColumnDialog(props: ReviewProps & { table: string }) {
  const [column, setColumn] = useState(EMPTY_COLUMN);
  const complete = column.name.trim() !== "" && column.dataType.trim() !== "";
  return (
    <FormShell
      {...props}
      title="Adicionar coluna"
      description={`Nova coluna em ${props.table}.`}
      change={complete ? { kind: "addColumn", column } : null}
    >
      <ColumnFields column={column} onChange={setColumn} />
    </FormShell>
  );
}

function ColumnFields({
  column,
  onChange
}: {
  column: ColumnDefinition;
  onChange: (column: ColumnDefinition) => void;
}) {
  return (
    <>
      <TextField
        label="Nome"
        autoFocus
        value={column.name}
        onChange={name => onChange({ ...column, name })}
      />
      <TextField
        label="Tipo"
        hint={TYPE_HINT}
        value={column.dataType}
        onChange={dataType => onChange({ ...column, dataType })}
      />
      <TextField
        label="Default (opcional)"
        hint={DEFAULT_HINT}
        value={column.default ?? ""}
        onChange={text => onChange({ ...column, default: optional(text) })}
      />
      <Check
        label="NOT NULL"
        checked={!column.nullable}
        onChange={notNull => onChange({ ...column, nullable: !notNull })}
      />
    </>
  );
}

export function RenameColumnDialog(props: ReviewProps & { column: string }) {
  const [name, setName] = useState(props.column);
  const changed = name.trim() !== "" && name !== props.column;
  return (
    <FormShell
      {...props}
      title="Renomear coluna"
      description={`A coluna ${props.column} passa a se chamar:`}
      change={changed ? { kind: "renameColumn", column: props.column, newName: name } : null}
    >
      <TextField label="Novo nome" autoFocus value={name} onChange={setName} />
    </FormShell>
  );
}

/** Postgres: the type alone, with USING when the server cannot convert by itself. */
export function SetTypeDialog(props: ReviewProps & { column: ColumnInfo }) {
  const [dataType, setDataType] = useState(props.column.dataType);
  const [using, setUsing] = useState("");
  const changed = dataType.trim() !== "" && dataType !== props.column.dataType;
  return (
    <FormShell
      {...props}
      title="Mudar tipo"
      description={`Coluna ${props.column.name}, hoje ${props.column.dataType}. O Postgres converte os valores existentes ou recusa a mudança.`}
      change={
        changed
          ? { kind: "setType", column: props.column.name, dataType, using: optional(using) }
          : null
      }
    >
      <TextField
        label="Novo tipo"
        hint={TYPE_HINT}
        autoFocus
        value={dataType}
        onChange={setDataType}
      />
      <TextField
        label="USING (opcional)"
        hint={`Como converter cada valor, quando não há conversão automática: ${props.column.name}::integer`}
        value={using}
        onChange={setUsing}
      />
    </FormShell>
  );
}

export function SetDefaultDialog(props: ReviewProps & { column: ColumnInfo }) {
  const [text, setText] = useState(props.column.default ?? "");
  const changed = text.trim() !== (props.column.default ?? "").trim();
  return (
    <FormShell
      {...props}
      title="Mudar default"
      description={`Coluna ${props.column.name}. Vazio remove o default; as linhas existentes não mudam.`}
      change={
        changed ? { kind: "setDefault", column: props.column.name, default: optional(text) } : null
      }
    >
      <TextField label="Default" hint={DEFAULT_HINT} autoFocus value={text} onChange={setText} />
    </FormShell>
  );
}

/** MySQL: MODIFY COLUMN takes the whole definition, so the form starts from the current one. */
export function RedefineColumnDialog(
  props: ReviewProps & { connectionId: string; schema: string; table: string; column: string }
) {
  const { connectionId, schema, table, column } = props;
  const current = useQuery({
    queryKey: ["columnDefinition", connectionId, schema, table, column],
    queryFn: () =>
      connected(connectionId, () => commands.columnDefinition(connectionId, schema, table, column)),
    staleTime: 0,
    gcTime: 0
  });
  const [edited, setEdited] = useState<string | null>(null);
  const definition = edited ?? current.data ?? "";
  const id = useId();
  const changed = current.isSuccess && definition.trim() !== "" && definition !== current.data;
  return (
    <FormShell
      {...props}
      title="Redefinir coluna"
      description={
        <>
          No MySQL, mudar tipo ou NULL reescreve a coluna inteira (<code>MODIFY COLUMN</code>): o
          que sair desta definição (default, comentário, AUTO_INCREMENT) sai da coluna.
        </>
      }
      change={changed ? { kind: "redefineColumn", column, definition } : null}
    >
      {current.isPending && <p className="text-sm text-muted-foreground">Lendo a definição…</p>}
      {current.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(current.error)}
        </p>
      )}
      {current.isSuccess && (
        <div className="grid gap-1.5">
          <Label htmlFor={id}>Definição de {column}</Label>
          <textarea
            id={id}
            autoFocus
            spellCheck={false}
            rows={3}
            className="border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus-visible:border-ring"
            value={definition}
            onChange={event => setEdited(event.target.value)}
          />
        </div>
      )}
    </FormShell>
  );
}

export function CreateIndexDialog(props: ReviewProps & { table: string; columns: string[] }) {
  const [name, setName] = useState("");
  /** in the order they were ticked: that is the index's column order */
  const [picked, setPicked] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const complete = name.trim() !== "" && picked.length > 0;
  return (
    <FormShell
      {...props}
      title="Criar índice"
      description={`Índice em ${props.table}. As colunas entram na ordem em que forem marcadas.`}
      change={complete ? { kind: "createIndex", name, columns: picked, unique } : null}
    >
      <TextField label="Nome do índice" autoFocus value={name} onChange={setName} />
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Colunas</legend>
        {props.columns.map(column => (
          <Check
            key={column}
            label={picked.includes(column) ? `${column} (${picked.indexOf(column) + 1}ª)` : column}
            checked={picked.includes(column)}
            onChange={checked =>
              setPicked(prev =>
                checked ? [...prev, column] : prev.filter(other => other !== column)
              )
            }
          />
        ))}
      </fieldset>
      <Check label="UNIQUE" checked={unique} onChange={setUnique} />
    </FormShell>
  );
}

type DraftColumn = ColumnDefinition & { id: number; primaryKey: boolean };

/** `onReview` gets the table's name too: there is no table yet to address the change to. */
export function CreateTableDialog(
  props: Omit<ReviewProps, "onReview"> & {
    schema: string;
    onReview: (table: string, change: SchemaChange) => void;
  }
) {
  const [name, setName] = useState("");
  const [nextId, setNextId] = useState(1);
  const [columns, setColumns] = useState<DraftColumn[]>([
    { ...EMPTY_COLUMN, id: 0, name: "id", dataType: "", nullable: false, primaryKey: true }
  ]);
  const complete =
    name.trim() !== "" &&
    columns.length > 0 &&
    columns.every(column => column.name.trim() !== "" && column.dataType.trim() !== "");
  const update = (id: number, patch: Partial<DraftColumn>) =>
    setColumns(prev => prev.map(column => (column.id === id ? { ...column, ...patch } : column)));

  return (
    <FormShell
      {...props}
      onReview={change => props.onReview(name.trim(), change)}
      title="Nova tabela"
      description={`Tabela em ${props.schema}. ${TYPE_HINT}`}
      change={
        complete
          ? {
              kind: "createTable",
              columns: columns.map(({ name, dataType, nullable, default: value }) => ({
                name,
                dataType,
                nullable,
                default: value
              })),
              primaryKey: columns.filter(column => column.primaryKey).map(column => column.name)
            }
          : null
      }
    >
      <TextField label="Nome da tabela" autoFocus value={name} onChange={setName} />
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">Colunas</legend>
        {columns.map((column, index) => (
          <div
            key={column.id}
            className="grid gap-2 border p-2"
            role="group"
            aria-label={`Coluna ${index + 1}`}
          >
            <div className="grid grid-cols-2 gap-2">
              <TextField
                label="Nome"
                value={column.name}
                onChange={value => update(column.id, { name: value })}
              />
              <TextField
                label="Tipo"
                value={column.dataType}
                onChange={value => update(column.id, { dataType: value })}
              />
            </div>
            <TextField
              label="Default (opcional)"
              value={column.default ?? ""}
              onChange={value => update(column.id, { default: optional(value) })}
            />
            <div className="flex items-center gap-4">
              <Check
                label="NOT NULL"
                checked={!column.nullable}
                onChange={notNull => update(column.id, { nullable: !notNull })}
              />
              <Check
                label="Chave primária"
                checked={column.primaryKey}
                onChange={primaryKey => update(column.id, { primaryKey })}
              />
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="ml-auto"
                aria-label={`Remover coluna ${index + 1}`}
                disabled={columns.length === 1}
                onClick={() => setColumns(prev => prev.filter(other => other.id !== column.id))}
              >
                <Trash2 /> Remover
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() => {
            setColumns(prev => [...prev, { ...EMPTY_COLUMN, id: nextId, primaryKey: false }]);
            setNextId(prev => prev + 1);
          }}
        >
          <Plus /> Adicionar coluna
        </Button>
      </fieldset>
    </FormShell>
  );
}

/** "Nova tabela" from the tree: the form, then the exact CREATE TABLE, then the new table opens. */
export function NewTableFlow({
  connectionId,
  schema,
  onCreated,
  onCancel
}: {
  connectionId: string;
  schema: string;
  onCreated: (table: string) => void;
  onCancel: () => void;
}) {
  const change = useSchemaChange(connectionId, schema, ({ table }) => onCreated(table));
  return (
    <>
      <CreateTableDialog
        open={change.confirmation === null}
        pending={change.reviewing}
        error={change.reviewError ?? change.runError}
        schema={schema}
        onReview={change.review}
        onCancel={onCancel}
      />
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={change.confirmation}
        confirmLabel="Criar tabela"
        pending={change.running}
        onConfirm={change.confirm}
        onCancel={change.dismiss}
      />
    </>
  );
}

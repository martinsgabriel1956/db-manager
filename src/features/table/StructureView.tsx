import { useState, type ReactNode } from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { ColumnInfo, SchemaChange } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useConnections } from "@/features/connections/queries";
import { useStructure } from "@/features/explorer/queries";
import {
  AddColumnDialog,
  CreateIndexDialog,
  RedefineColumnDialog,
  RenameColumnDialog,
  SetDefaultDialog,
  SetTypeDialog,
  type ReviewProps
} from "@/features/table/SchemaDialogs";
import { useSchemaChange } from "@/features/table/useSchemaChange";
import { tableKey, useTabs } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";

type StructureViewProps = {
  connectionId: string;
  schema: string;
  table: string;
  readOnly: boolean;
};

type SectionProps = {
  title: string;
  headers: string[];
  children: ReactNode;
  empty: boolean;
  action?: ReactNode;
};

/** The form open over the structure; a direct action (remove, NULL) has none. */
type Form =
  | { kind: "addColumn" }
  | { kind: "rename" | "type" | "default" | "redefine"; column: ColumnInfo }
  | { kind: "index" };

function Section({ title, headers, children, empty, action }: SectionProps) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground">Nenhum.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-7 border-b text-left legend text-muted-foreground">
              {headers.map(header => (
                <th key={header} className="py-1.5 pr-4 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-xs">{children}</tbody>
        </table>
      )}
    </section>
  );
}

export function StructureView({ connectionId, schema, table, readOnly }: StructureViewProps) {
  const structure = useStructure(connectionId, schema, table);
  const engine = useConnections().data?.find(c => c.id === connectionId)?.engine;
  // the grid's staged edits are keyed to these columns: change one or the other, not both
  const dirty = useTabs(
    state => (state.pending[tableKey({ connectionId, schema, table })] ?? 0) > 0
  );
  const [form, setForm] = useState<Form | null>(null);
  const change = useSchemaChange(connectionId, schema, () => setForm(null));

  if (structure.isPending) {
    return <p className="p-4 text-sm text-muted-foreground">Carregando estrutura…</p>;
  }
  if (structure.isError) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {errorMessage(structure.error)}
      </p>
    );
  }

  const editable = !readOnly && !dirty && engine !== undefined;
  const review = (next: SchemaChange) => change.review(table, next);
  const open = (next: Form) => {
    change.reset();
    setForm(next);
  };
  const formProps: ReviewProps = {
    open: change.confirmation === null,
    pending: change.reviewing,
    // a command the database refused brings the form back with its error
    error: change.reviewError ?? change.runError,
    onReview: review,
    onCancel: () => setForm(null)
  };

  const { columns, indexes, foreignKeys } = structure.data;
  return (
    <div className="grid gap-6 overflow-auto p-4">
      {readOnly && (
        <p className="text-sm text-muted-foreground">
          Conexão somente leitura: a estrutura não pode ser alterada.
        </p>
      )}
      {!readOnly && dirty && (
        <p className="text-sm text-foreground">
          Salve ou descarte as alterações pendentes nos dados antes de alterar a estrutura.
        </p>
      )}
      {change.done && (
        <p role="status" className="text-sm text-success">
          Executado: <code className="font-mono text-xs">{change.done}</code>
        </p>
      )}
      {/* a direct action (remove, NULL) goes straight here; a form's error stays on the form */}
      {form === null && change.reviewError && (
        <p role="alert" className="text-sm text-destructive">
          {change.reviewError}
        </p>
      )}
      {form === null && change.runError && (
        <p role="alert" className="text-sm text-destructive">
          {change.runError}
        </p>
      )}
      <Section
        title="Colunas"
        headers={["Nome", "Tipo", "Nulo", "Default", "PK", ...(editable ? ["Ações"] : [])]}
        empty={false}
        action={
          editable && (
            <Button size="xs" variant="outline" onClick={() => open({ kind: "addColumn" })}>
              <Plus /> Adicionar coluna
            </Button>
          )
        }
      >
        {columns.map(column => (
          <tr key={column.name} className="h-7 border-b">
            <td className="py-1.5 pr-4 font-semibold">{column.name}</td>
            <td className="py-1.5 pr-4">{column.dataType}</td>
            <td className="py-1.5 pr-4">{column.nullable ? "sim" : "não"}</td>
            <td className="py-1.5 pr-4 text-muted-foreground">{column.default ?? ""}</td>
            <td className="py-1.5 pr-4">{column.isPrimaryKey ? "PK" : ""}</td>
            {editable && (
              <td className="py-1 pr-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Ações da coluna ${column.name}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => open({ kind: "rename", column })}>
                      Renomear…
                    </DropdownMenuItem>
                    {engine === "postgres" && (
                      <>
                        <DropdownMenuItem onSelect={() => open({ kind: "type", column })}>
                          Mudar tipo…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => open({ kind: "default", column })}>
                          Mudar default…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            review({
                              kind: "setNullable",
                              column: column.name,
                              nullable: !column.nullable
                            })
                          }
                        >
                          {column.nullable ? "Exigir NOT NULL" : "Permitir NULL"}
                        </DropdownMenuItem>
                      </>
                    )}
                    {engine === "mysql" && (
                      <>
                        <DropdownMenuItem onSelect={() => open({ kind: "redefine", column })}>
                          Redefinir (tipo, NULL)…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => open({ kind: "default", column })}>
                          Mudar default…
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => review({ kind: "dropColumn", column: column.name })}
                    >
                      <Trash2 /> Remover coluna
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            )}
          </tr>
        ))}
      </Section>
      {editable && engine === "sqlite" && (
        // said, not hidden: the menu has no such items on SQLite, this is why
        <p className="-mt-4 text-xs text-muted-foreground">
          O SQLite não muda o tipo, o default nem o NULL de uma coluna sem recriar a tabela: para
          isso, recrie-a pelo editor SQL. Renomear e remover coluna ele faz.
        </p>
      )}
      <Section
        title="Índices"
        headers={["Nome", "Definição", ...(editable ? ["Ações"] : [])]}
        empty={indexes.length === 0}
        action={
          editable && (
            <Button size="xs" variant="outline" onClick={() => open({ kind: "index" })}>
              <Plus /> Criar índice
            </Button>
          )
        }
      >
        {indexes.map(index => (
          <tr key={index.name} className="h-7 border-b">
            <td className="py-1.5 pr-4 font-semibold">{index.name}</td>
            <td className="py-1.5 pr-4">{index.definition}</td>
            {editable && (
              <td className="py-1 pr-4">
                {/* SQLite's automatic indexes belong to their PRIMARY KEY/UNIQUE: not droppable */}
                {!index.name.startsWith("sqlite_autoindex_") && (
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Remover índice ${index.name}`}
                    onClick={() => review({ kind: "dropIndex", name: index.name })}
                  >
                    <Trash2 /> Remover
                  </Button>
                )}
              </td>
            )}
          </tr>
        ))}
      </Section>
      <Section
        title="Chaves estrangeiras"
        headers={["Nome", "Definição"]}
        empty={foreignKeys.length === 0}
      >
        {foreignKeys.map(foreignKey => (
          <tr key={foreignKey.name} className="h-7 border-b">
            <td className="py-1.5 pr-4 font-semibold">{foreignKey.name}</td>
            <td className="py-1.5 pr-4">{foreignKey.definition}</td>
          </tr>
        ))}
      </Section>
      {form?.kind === "addColumn" && <AddColumnDialog {...formProps} table={table} />}
      {form?.kind === "rename" && <RenameColumnDialog {...formProps} column={form.column.name} />}
      {form?.kind === "type" && <SetTypeDialog {...formProps} column={form.column} />}
      {form?.kind === "default" && <SetDefaultDialog {...formProps} column={form.column} />}
      {form?.kind === "redefine" && (
        <RedefineColumnDialog
          {...formProps}
          connectionId={connectionId}
          schema={schema}
          table={table}
          column={form.column.name}
        />
      )}
      {form?.kind === "index" && (
        <CreateIndexDialog
          {...formProps}
          table={table}
          columns={columns.map(column => column.name)}
        />
      )}
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={change.confirmation}
        confirmLabel="Executar"
        pending={change.running}
        onConfirm={change.confirm}
        onCancel={change.dismiss}
      />
    </div>
  );
}

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
  ConstraintDialog,
  ForeignKeyDialog,
  RenameDialog,
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
  emptyText?: string;
};

/** The form open over the structure; a direct action (remove, NULL) has none. */
type Form =
  | { kind: "addColumn" }
  | { kind: "rename" | "type" | "default" | "redefine"; column: ColumnInfo }
  | { kind: "index" | "renameTable" | "foreignKey" | "constraint" }
  | { kind: "renameIndex"; name: string };

function Section({ title, headers, children, empty, action, emptyText = "Nenhum." }: SectionProps) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
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
  const change = useSchemaChange(connectionId, schema, ({ change: done }) => {
    setForm(null);
    // the tab named the old table: it follows the rename, and closes with the table
    const tabs = useTabs.getState();
    const tab = tabs.tabs.find(
      open => open.kind === "table" && tableKey(open) === tableKey({ connectionId, schema, table })
    );
    if (done.kind === "renameTable") {
      tabs.openTable({ connectionId, schema, table: done.newName });
    }
    if (tab && (done.kind === "renameTable" || done.kind === "dropTable")) {
      tabs.close(tab.id);
    }
  });

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

  const { columns, indexes, foreignKeys, constraints } = structure.data;
  // SQLite keeps constraints in its CREATE TABLE text only: no adding or dropping them
  const constraintsEditable = editable && engine !== "sqlite";
  const columnNames = columns.map(column => column.name);
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
      {editable && (
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => open({ kind: "renameTable" })}>
            Renomear tabela…
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="text-destructive"
            onClick={() => review({ kind: "dropTable" })}
          >
            <Trash2 /> Remover tabela
          </Button>
        </div>
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
                  <span className="flex gap-1.5">
                    {/* SQLite cannot rename an index (drop and create it again) */}
                    {engine !== "sqlite" && (
                      <Button
                        size="xs"
                        variant="outline"
                        aria-label={`Renomear índice ${index.name}`}
                        onClick={() => open({ kind: "renameIndex", name: index.name })}
                      >
                        Renomear
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label={`Remover índice ${index.name}`}
                      onClick={() => review({ kind: "dropIndex", name: index.name })}
                    >
                      <Trash2 /> Remover
                    </Button>
                  </span>
                )}
              </td>
            )}
          </tr>
        ))}
      </Section>
      <Section
        title="Chaves estrangeiras"
        headers={["Nome", "Definição", ...(constraintsEditable ? ["Ações"] : [])]}
        empty={foreignKeys.length === 0}
        emptyText="Nenhuma."
        action={
          constraintsEditable && (
            <Button size="xs" variant="outline" onClick={() => open({ kind: "foreignKey" })}>
              <Plus /> Adicionar chave estrangeira
            </Button>
          )
        }
      >
        {foreignKeys.map(foreignKey => (
          <tr key={foreignKey.name} className="h-7 border-b">
            <td className="py-1.5 pr-4 font-semibold">{foreignKey.name}</td>
            <td className="py-1.5 pr-4">{foreignKey.definition}</td>
            {constraintsEditable && (
              <td className="py-1 pr-4">
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={`Remover chave estrangeira ${foreignKey.name}`}
                  onClick={() => review({ kind: "dropConstraint", name: foreignKey.name })}
                >
                  <Trash2 /> Remover
                </Button>
              </td>
            )}
          </tr>
        ))}
      </Section>
      {engine === "sqlite" ? (
        editable && (
          <p className="text-xs text-muted-foreground">
            O SQLite só declara constraints (chave estrangeira, CHECK, UNIQUE) no CREATE TABLE:
            adicionar ou remover uma exige recriar a tabela pelo editor SQL. Para UNIQUE, um índice
            UNIQUE faz o mesmo papel.
          </p>
        )
      ) : (
        <Section
          // MySQL lists UNIQUE as an index, so only its CHECKs show here
          title={engine === "mysql" ? "Constraints CHECK" : "Constraints UNIQUE e CHECK"}
          headers={["Nome", "Definição", ...(constraintsEditable ? ["Ações"] : [])]}
          empty={constraints.length === 0}
          emptyText="Nenhuma."
          action={
            constraintsEditable && (
              <Button size="xs" variant="outline" onClick={() => open({ kind: "constraint" })}>
                <Plus /> Adicionar constraint
              </Button>
            )
          }
        >
          {constraints.map(constraint => (
            <tr key={constraint.name} className="h-7 border-b">
              <td className="py-1.5 pr-4 font-semibold">{constraint.name}</td>
              <td className="py-1.5 pr-4">{constraint.definition}</td>
              {constraintsEditable && (
                <td className="py-1 pr-4">
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Remover constraint ${constraint.name}`}
                    onClick={() => review({ kind: "dropConstraint", name: constraint.name })}
                  >
                    <Trash2 /> Remover
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </Section>
      )}
      {form?.kind === "addColumn" && <AddColumnDialog {...formProps} table={table} />}
      {form?.kind === "rename" && (
        <RenameDialog
          {...formProps}
          title="Renomear coluna"
          current={form.column.name}
          build={newName => ({ kind: "renameColumn", column: form.column.name, newName })}
        />
      )}
      {form?.kind === "renameIndex" && (
        <RenameDialog
          {...formProps}
          title="Renomear índice"
          current={form.name}
          build={newName => ({ kind: "renameIndex", name: form.name, newName })}
        />
      )}
      {form?.kind === "renameTable" && (
        <RenameDialog
          {...formProps}
          title="Renomear tabela"
          current={table}
          build={newName => ({ kind: "renameTable", newName })}
        />
      )}
      {form?.kind === "foreignKey" && (
        <ForeignKeyDialog
          {...formProps}
          connectionId={connectionId}
          schema={schema}
          table={table}
          columns={columnNames}
        />
      )}
      {form?.kind === "constraint" && (
        <ConstraintDialog {...formProps} table={table} columns={columnNames} />
      )}
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
        <CreateIndexDialog {...formProps} table={table} columns={columnNames} />
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

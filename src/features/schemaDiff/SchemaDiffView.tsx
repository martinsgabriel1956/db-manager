import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { commands, type ConnectionConfig, type DiffKind, type SchemaDiff } from "@/bindings";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { EnvTag } from "@/features/connections/EnvTag";
import { ENGINE_LABEL, ENVIRONMENT_STYLE } from "@/features/connections/options";
import { connected, useSchemas } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

type SchemaDiffViewProps = {
  connections: ConnectionConfig[];
  /** the source it was opened from */
  connectionId: string;
  schema: string;
};

/** One side of the comparison. */
type Side = { connectionId: string; schema: string };

type SidePickerProps = {
  legend: string;
  side: Side;
  /** the SQL connections of the source's engine */
  choices: ConnectionConfig[];
  onChange: (side: Side) => void;
};

const KIND_LABEL: Record<DiffKind, string> = {
  column: "Coluna",
  primaryKey: "Chave primária",
  index: "Índice",
  constraint: "Constraint",
  foreignKey: "Chave estrangeira"
};

/**
 * Another connection of the same engine, never production by default: the suggested DDL is
 * written for the target, and pointing it at prod is a choice the user makes. Else the same one.
 */
function defaultTarget(source: ConnectionConfig | undefined, choices: ConnectionConfig[]) {
  return (
    choices.find(connection => connection.id !== source?.id && connection.environment !== "prod") ??
    source
  );
}

/**
 * Two schemas of the same engine side by side: tables only on one side, and for the
 * tables on both, columns, indexes and constraints that differ. The suggested DDL is
 * shown to copy, never run from here.
 */
export function SchemaDiffView({ connections, connectionId, schema }: SchemaDiffViewProps) {
  const opened = connections.find(connection => connection.id === connectionId);
  const [source, setSource] = useState<Side>({ connectionId, schema });
  // the backend refuses two engines too: types and DDL of one do not apply to the other
  const choices = connections.filter(connection => connection.engine === opened?.engine);
  const [target, setTarget] = useState<Side>({
    connectionId: defaultTarget(opened, choices)?.id ?? connectionId,
    schema
  });
  const compare = useMutation({
    mutationFn: async (sides: { source: Side; target: Side }) => {
      await commands.connectDatabase(sides.source.connectionId);
      return connected(sides.target.connectionId, () =>
        commands.compareSchemas(
          sides.source.connectionId,
          sides.source.schema,
          sides.target.connectionId,
          sides.target.schema
        )
      );
    }
  });
  const name = (side: Side) =>
    `${connections.find(c => c.id === side.connectionId)?.name ?? "?"} · ${side.schema}`;

  return (
    <div className="flex h-full flex-col">
      {/* wraps rather than clips: zoomed in (Ctrl+=) the connection and the actions drop to a
          second line, whole; py-1 here and on the title keeps one line at 48px */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-foreground bg-background px-4 py-1">
        <h2 className="shrink-0 py-1 display-caps text-[1.75rem] leading-[1.15]">
          Comparar schema
        </h2>
        {opened && (
          <span className="text-xs text-muted-foreground">{ENGINE_LABEL[opened.engine]}</span>
        )}
        <ConnectionContext connectionId={connectionId} className="ml-auto" />
      </div>
      <form
        className="flex flex-wrap items-end gap-4 border-b bg-muted px-3 py-2 text-xs"
        onSubmit={event => {
          event.preventDefault();
          compare.mutate({ source, target });
        }}
      >
        <SidePicker legend="Origem" side={source} choices={choices} onChange={setSource} />
        <SidePicker legend="Destino" side={target} choices={choices} onChange={setTarget} />
        <Button size="sm" type="submit" disabled={compare.isPending}>
          {compare.isPending ? "Comparando…" : "Comparar"}
        </Button>
        <p className="basis-full text-muted-foreground">
          Leitura dos catálogos: nada é alterado. Compara tabelas, colunas, chave primária, índices
          e constraints; views, sequências, tipos, funções, triggers e permissões ficam de fora. O
          DDL sugerido leva o destino ao estado da origem e nunca é executado por esta tela.
        </p>
      </form>
      {compare.isError && compare.variables && (
        <div role="alert" className="grid gap-1 border-b px-3 py-2">
          <p className="text-sm font-semibold text-destructive">
            Não foi possível comparar {name(compare.variables.source)} com{" "}
            {name(compare.variables.target)}
          </p>
          {/* the driver's own words, as data */}
          <p className="font-mono text-[11px] break-words">{errorMessage(compare.error)}</p>
        </div>
      )}
      {/* named after the sides that were compared, not the ones picked since */}
      {compare.data && compare.variables && (
        <DiffResult
          diff={compare.data}
          sourceName={name(compare.variables.source)}
          targetName={name(compare.variables.target)}
        />
      )}
    </div>
  );
}

function SidePicker({ legend, side, choices, onChange }: SidePickerProps) {
  const schemas = useSchemas(side.connectionId, true);
  const picked = choices.find(connection => connection.id === side.connectionId);
  return (
    <fieldset className="flex items-end gap-2">
      <legend className="mb-1 legend text-muted-foreground">{legend}</legend>
      <label className="grid gap-1">
        <span className="legend text-muted-foreground">Conexão</span>
        <NativeSelect
          aria-label={`Conexão de ${legend.toLowerCase()}`}
          className="h-7 text-xs"
          value={side.connectionId}
          onChange={event => onChange({ connectionId: event.target.value, schema: side.schema })}
        >
          {choices.map(connection => (
            <option key={connection.id} value={connection.id}>
              {connection.name} · {ENVIRONMENT_STYLE[connection.environment].label}
            </option>
          ))}
        </NativeSelect>
      </label>
      {/* the picked side's environment as the tag every other screen prints, not a word in a list */}
      {picked && <EnvTag environment={picked.environment} className="mb-[5px]" />}
      <label className="grid gap-1">
        <span className="legend text-muted-foreground">Schema</span>
        <NativeSelect
          aria-label={`Schema de ${legend.toLowerCase()}`}
          className="h-7 text-xs"
          value={side.schema}
          onChange={event => onChange({ ...side, schema: event.target.value })}
        >
          {/* the schema typed in may not be listed yet (or exist): it stays visible */}
          {!schemas.data?.some(schema => schema.name === side.schema) && (
            <option value={side.schema}>{side.schema}</option>
          )}
          {schemas.data?.map(schema => (
            <option key={schema.name} value={schema.name}>
              {schema.name}
            </option>
          ))}
        </NativeSelect>
      </label>
    </fieldset>
  );
}

type DiffResultProps = { diff: SchemaDiff; sourceName: string; targetName: string };

function DiffResult({ diff, sourceName, targetName }: DiffResultProps) {
  const nothing =
    diff.onlyInSource.length === 0 && diff.onlyInTarget.length === 0 && diff.changed.length === 0;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-sm">
      <p role="status" className="mb-3">
        {nothing
          ? `Nenhuma diferença: ${diff.equal} tabelas iguais.`
          : `${diff.changed.length} com diferenças · ${diff.onlyInSource.length} só na origem · ${diff.onlyInTarget.length} só no destino · ${diff.equal} iguais`}
      </p>
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <TableList title={`Só na origem (${sourceName})`} tables={diff.onlyInSource} />
        <TableList title={`Só no destino (${targetName})`} tables={diff.onlyInTarget} />
      </div>
      {diff.changed.map(table => (
        <section key={table.table} aria-label={`Diferenças em ${table.table}`} className="mb-4">
          <h3 className="mb-1 font-mono text-sm font-semibold">{table.table}</h3>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="sticky top-0 h-7 border-b border-foreground bg-muted text-left legend text-muted-foreground [&>th]:px-2">
                <th className="w-32 font-medium">Tipo</th>
                <th className="font-medium">Nome</th>
                <th className="font-medium">Origem</th>
                <th className="font-medium">Destino</th>
              </tr>
            </thead>
            <tbody>
              {table.items.map(item => (
                <tr
                  key={`${item.kind}/${item.name}`}
                  className="h-7 border-b align-top [&>td]:px-2"
                >
                  <td className="py-1">{KIND_LABEL[item.kind]}</td>
                  <td className="py-1 font-mono">{item.name}</td>
                  <td className="py-1 font-mono break-all">{item.source ?? "— (não existe)"}</td>
                  <td className="py-1 font-mono break-all">{item.target ?? "— (não existe)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <SuggestedDdl ddl={diff.ddl} />
    </div>
  );
}

function TableList({ title, tables }: { title: string; tables: string[] }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {tables.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma.</p>
      ) : (
        <ul className="font-mono text-xs">
          {tables.map(table => (
            <li key={table}>{table}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SuggestedDdl({ ddl }: { ddl: string | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (ddl === null) {
    return (
      <p className="border border-dotted border-foreground p-2 text-xs">
        DDL sugerido só existe para Postgres por enquanto: no MySQL e no SQLite esta tela lista as
        diferenças, sem gerar o DDL.
      </p>
    );
  }
  if (ddl === "") {
    return <p className="text-xs text-muted-foreground">Nada a alterar no destino.</p>;
  }
  return (
    <section aria-label="DDL sugerido">
      <div className="mb-1 flex items-center gap-3">
        <h3 className="text-sm font-semibold">DDL sugerido para o destino</h3>
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            navigator.clipboard.writeText(ddl).then(
              () => setCopied("DDL copiado"),
              (err: unknown) => setCopied(`Não copiado: ${errorMessage(err)}`)
            )
          }
        >
          <Copy /> Copiar DDL
        </Button>
        {copied && (
          <span role="status" className="text-xs">
            {copied}
          </span>
        )}
      </div>
      <p className="mb-1 text-xs text-muted-foreground">
        Não é executado aqui. Revise antes de rodar no editor SQL do destino: DROP apaga dados, a
        ordem pode precisar de ajuste quando tabelas novas se referenciam, e um default com nextval
        de sequência que o destino não tem falha ao rodar.
      </p>
      <pre className="overflow-auto border bg-muted p-2 font-mono text-xs whitespace-pre">
        {ddl}
      </pre>
    </section>
  );
}

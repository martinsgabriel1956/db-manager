import { useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDdl, useStructure } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

type StructureViewProps = { connectionId: string; schema: string; table: string };

type SectionProps = { title: string; headers: string[]; children: ReactNode; empty: boolean };

function Section({ title, headers, children, empty }: SectionProps) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
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

type DdlSectionProps = { connectionId: string; schema: string; table: string };

/** The CREATE statement, as the database gives it (or rebuilt, on Postgres), with a copy button. */
function DdlSection({ connectionId, schema, table }: DdlSectionProps) {
  const ddl = useDdl(connectionId, schema, table);
  const [copied, setCopied] = useState<{ ok: boolean; text: string } | null>(null);

  async function copy(sql: string) {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied({ ok: true, text: "DDL copiado" });
    } catch (err) {
      setCopied({ ok: false, text: `Não copiado: ${errorMessage(err)}` });
    }
  }

  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">DDL</h3>
        {ddl.isSuccess && (
          <Button size="xs" variant="outline" onClick={() => copy(ddl.data.sql)}>
            <Copy /> Copiar
          </Button>
        )}
        {copied && (
          <span
            role={copied.ok ? "status" : "alert"}
            className={copied.ok ? "text-xs text-success" : "text-xs text-destructive"}
          >
            {copied.text}
          </span>
        )}
      </div>
      {ddl.isPending && <p className="text-sm text-muted-foreground">Carregando DDL…</p>}
      {ddl.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(ddl.error)}
        </p>
      )}
      {ddl.isSuccess && (
        <>
          {ddl.data.reconstructed && (
            <p className="text-xs text-muted-foreground">
              Reconstruído a partir do catálogo: o Postgres não guarda o CREATE TABLE original.
              Colunas, defaults, chaves, checks e índices estão aqui; permissões, dono, herança e
              opções de armazenamento não.
            </p>
          )}
          {/* scrollable: reachable by keyboard, named for screen readers */}
          <pre
            role="region"
            tabIndex={0}
            aria-label={`DDL de ${table}`}
            className="overflow-auto border bg-muted p-3 font-mono text-xs whitespace-pre"
          >
            {ddl.data.sql}
          </pre>
        </>
      )}
    </section>
  );
}

export function StructureView({ connectionId, schema, table }: StructureViewProps) {
  const structure = useStructure(connectionId, schema, table);

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

  const { columns, indexes, foreignKeys } = structure.data;
  return (
    <div className="grid gap-6 overflow-auto p-4">
      <Section title="Colunas" headers={["Nome", "Tipo", "Nulo", "Default", "PK"]} empty={false}>
        {columns.map(column => (
          <tr key={column.name} className="h-7 border-b">
            <td className="py-1.5 pr-4 font-semibold">{column.name}</td>
            <td className="py-1.5 pr-4">{column.dataType}</td>
            <td className="py-1.5 pr-4">{column.nullable ? "sim" : "não"}</td>
            <td className="py-1.5 pr-4 text-muted-foreground">{column.default ?? ""}</td>
            <td className="py-1.5 pr-4">{column.isPrimaryKey ? "PK" : ""}</td>
          </tr>
        ))}
      </Section>
      <Section title="Índices" headers={["Nome", "Definição"]} empty={indexes.length === 0}>
        {indexes.map(index => (
          <tr key={index.name} className="h-7 border-b">
            <td className="py-1.5 pr-4 font-semibold">{index.name}</td>
            <td className="py-1.5 pr-4">{index.definition}</td>
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
      <DdlSection connectionId={connectionId} schema={schema} table={table} />
    </div>
  );
}

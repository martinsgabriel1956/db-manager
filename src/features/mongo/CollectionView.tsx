import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AggregationPanel } from "@/features/mongo/AggregationPanel";
import { DocumentsPanel } from "@/features/mongo/DocumentsPanel";
import { useIndexes } from "@/features/mongo/queries";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type CollectionViewProps = {
  connectionId: string;
  database: string;
  collection: string;
  readOnly: boolean;
};

type Section = "documents" | "aggregation" | "indexes";

const SECTION_LABEL: Record<Section, string> = {
  documents: "Documentos",
  aggregation: "Agregação",
  indexes: "Índices"
};

export function CollectionView({
  connectionId,
  database,
  collection,
  readOnly
}: CollectionViewProps) {
  const [section, setSection] = useState<Section>("documents");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b px-3">
        <h2 className="py-2 font-mono text-sm font-semibold">
          {database}.{collection}
        </h2>
        <div role="tablist" className="flex gap-1">
          {(Object.keys(SECTION_LABEL) as Section[]).map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              onClick={() => setSection(id)}
              className={cn(
                "border-b-2 px-2 py-2 text-sm",
                section === id
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground"
              )}
            >
              {SECTION_LABEL[id]}
            </button>
          ))}
        </div>
        {readOnly && <Badge variant="outline">Somente leitura</Badge>}
      </div>
      {/* panels stay mounted so filters, results and editors survive switching */}
      <div className={cn("min-h-0 flex-1", section !== "documents" && "hidden")}>
        <DocumentsPanel
          connectionId={connectionId}
          database={database}
          collection={collection}
          readOnly={readOnly}
        />
      </div>
      <div className={cn("min-h-0 flex-1", section !== "aggregation" && "hidden")}>
        <AggregationPanel connectionId={connectionId} database={database} collection={collection} />
      </div>
      {section === "indexes" && (
        <IndexesPanel connectionId={connectionId} database={database} collection={collection} />
      )}
    </div>
  );
}

function IndexesPanel({
  connectionId,
  database,
  collection
}: Omit<CollectionViewProps, "readOnly">) {
  const indexes = useIndexes(connectionId, database, collection);
  if (indexes.isPending) {
    return <p className="p-4 text-sm text-muted-foreground">Carregando índices…</p>;
  }
  if (indexes.isError) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {errorMessage(indexes.error)}
      </p>
    );
  }
  return (
    <table className="m-4 border-collapse text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-1.5 pr-6 font-medium">Nome</th>
          <th className="py-1.5 font-medium">Chaves</th>
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {indexes.data.map(index => (
          <tr key={index.name} className="border-b">
            <td className="py-1.5 pr-6 font-semibold">{index.name}</td>
            <td className="py-1.5">{index.definition}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

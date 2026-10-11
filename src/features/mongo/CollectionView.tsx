import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AggregationPanel } from "@/features/mongo/AggregationPanel";
import { DocumentsPanel } from "@/features/mongo/DocumentsPanel";
import { useIndexes } from "@/features/mongo/queries";
import { errorMessage } from "@/lib/errors";

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
  const [section, setSection] = useState("documents");

  return (
    <Tabs value={section} onValueChange={setSection} className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b bg-muted px-3">
        <h2 className="py-2 font-mono text-sm font-semibold">
          {database}.{collection}
        </h2>
        <TabsList aria-label="Seções da coleção">
          {(Object.keys(SECTION_LABEL) as Section[]).map(id => (
            <TabsTrigger key={id} value={id}>
              {SECTION_LABEL[id]}
            </TabsTrigger>
          ))}
        </TabsList>
        {readOnly && <Badge variant="outline">Somente leitura</Badge>}
      </div>
      {/* panels stay mounted so filters, results and editors survive switching */}
      <TabsContent value="documents" forceMount className="min-h-0 flex-1">
        <DocumentsPanel
          connectionId={connectionId}
          database={database}
          collection={collection}
          readOnly={readOnly}
        />
      </TabsContent>
      <TabsContent value="aggregation" forceMount className="min-h-0 flex-1">
        <AggregationPanel connectionId={connectionId} database={database} collection={collection} />
      </TabsContent>
      <TabsContent value="indexes" className="min-h-0 flex-1 overflow-auto">
        <IndexesPanel connectionId={connectionId} database={database} collection={collection} />
      </TabsContent>
    </Tabs>
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
        <tr className="h-7 border-b text-left label-caps text-muted-foreground">
          <th className="py-1.5 pr-6 font-medium">Nome</th>
          <th className="py-1.5 font-medium">Chaves</th>
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {indexes.data.map(index => (
          <tr key={index.name} className="h-7 border-b">
            <td className="py-1.5 pr-6 font-semibold">{index.name}</td>
            <td className="py-1.5">{index.definition}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { AggregationPanel } from "@/features/mongo/AggregationPanel";
import { DocumentsPanel } from "@/features/mongo/DocumentsPanel";
import { IndexesPanel } from "@/features/mongo/IndexesPanel";

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
      <div className="flex items-center gap-5 border-b border-foreground bg-background px-4">
        {/* a long identifier wraps: it is data, and a hover title is out of the keyboard's reach */}
        <h2 className="flex min-w-0 items-baseline py-2">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{database}.</span>
          <span className="min-w-0 display text-[1.75rem] leading-[1.15] [overflow-wrap:anywhere]">
            {collection}
          </span>
        </h2>
        <TabsList aria-label="Seções da coleção" className="shrink-0">
          {(Object.keys(SECTION_LABEL) as Section[]).map(id => (
            <TabsTrigger key={id} value={id}>
              {SECTION_LABEL[id]}
            </TabsTrigger>
          ))}
        </TabsList>
        {readOnly && <Badge variant="held">Somente leitura</Badge>}
        <ConnectionContext connectionId={connectionId} className="ml-auto" />
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
        <IndexesPanel
          connectionId={connectionId}
          database={database}
          collection={collection}
          readOnly={readOnly}
        />
      </TabsContent>
    </Tabs>
  );
}

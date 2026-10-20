import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { AggregationPanel } from "@/features/mongo/AggregationPanel";
import { DocumentsPanel } from "@/features/mongo/DocumentsPanel";
import { IndexesPanel } from "@/features/mongo/IndexesPanel";
import { LivePanel } from "@/features/mongo/LivePanel";
import { SchemaPanel } from "@/features/mongo/SchemaPanel";

type CollectionViewProps = {
  connectionId: string;
  database: string;
  collection: string;
  readOnly: boolean;
};

type Section = "documents" | "aggregation" | "schema" | "indexes" | "live";

const SECTION_LABEL: Record<Section, string> = {
  documents: "Documentos",
  aggregation: "Agregação",
  schema: "Schema",
  indexes: "Índices",
  live: "Ao vivo"
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
      {/* wraps rather than clips: zoomed in (Ctrl+=) the connection and the actions drop to a
          second line, whole; py-1 here and on the title keeps one line at 48px */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-foreground bg-background px-4 py-1">
        {/* a long identifier wraps: it is data, and a hover title is out of the keyboard's reach;
            up to half the header it keeps its width, so the connection name truncates first and
            a short name never breaks mid-word */}
        <h2 className="flex max-w-1/2 shrink-0 items-baseline py-1">
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
      <TabsContent value="schema" forceMount className="min-h-0 flex-1">
        <SchemaPanel connectionId={connectionId} database={database} collection={collection} />
      </TabsContent>
      {/* not kept mounted: leaving the section closes the change stream on the server */}
      <TabsContent value="live" className="min-h-0 flex-1">
        <LivePanel connectionId={connectionId} database={database} collection={collection} />
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

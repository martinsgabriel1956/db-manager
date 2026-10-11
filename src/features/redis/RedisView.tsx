import { useState } from "react";
import type { ConnectionConfig } from "@/bindings";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_REDIS_SEPARATOR } from "@/features/connections/options";
import { ConsolePanel } from "@/features/redis/ConsolePanel";
import { InfoPanel } from "@/features/redis/InfoPanel";
import { KeyBrowser } from "@/features/redis/KeyBrowser";

type RedisViewProps = { connection: ConnectionConfig; db: number };

type Section = "keys" | "console" | "info";

const SECTION_LABEL: Record<Section, string> = {
  keys: "Chaves",
  console: "Console",
  info: "Servidor"
};

export function RedisView({ connection, db }: RedisViewProps) {
  const [section, setSection] = useState("keys");

  return (
    <Tabs value={section} onValueChange={setSection} className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b bg-muted px-3">
        <h2 className="py-2 font-mono text-sm font-semibold">
          {connection.name} · db{db}
        </h2>
        <TabsList aria-label="Seções do Redis">
          {(Object.keys(SECTION_LABEL) as Section[]).map(id => (
            <TabsTrigger key={id} value={id}>
              {SECTION_LABEL[id]}
            </TabsTrigger>
          ))}
        </TabsList>
        {connection.readOnly && <Badge variant="outline">Somente leitura</Badge>}
      </div>
      {/* panels stay mounted so the selected key and the console scrollback survive switching */}
      <TabsContent value="keys" forceMount className="min-h-0 flex-1">
        <KeyBrowser
          connectionId={connection.id}
          db={db}
          separator={connection.keySeparator ?? DEFAULT_REDIS_SEPARATOR}
          readOnly={connection.readOnly}
        />
      </TabsContent>
      <TabsContent value="console" forceMount className="min-h-0 flex-1">
        <ConsolePanel connectionId={connection.id} db={db} />
      </TabsContent>
      <TabsContent value="info" className="min-h-0 flex-1">
        <InfoPanel connectionId={connection.id} />
      </TabsContent>
    </Tabs>
  );
}

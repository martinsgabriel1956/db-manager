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
      <div className="flex items-center gap-5 border-b border-foreground bg-background px-4">
        <h2 className="flex items-baseline gap-1.5 py-2.5">
          <span className="text-xs text-muted-foreground">{connection.name} ·</span>
          <span className="display text-[1.75rem]">db{db}</span>
        </h2>
        <TabsList aria-label="Seções do Redis">
          {(Object.keys(SECTION_LABEL) as Section[]).map(id => (
            <TabsTrigger key={id} value={id}>
              {SECTION_LABEL[id]}
            </TabsTrigger>
          ))}
        </TabsList>
        {connection.readOnly && <Badge variant="held">Somente leitura</Badge>}
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

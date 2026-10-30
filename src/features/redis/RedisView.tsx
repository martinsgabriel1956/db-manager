import { useRef, useState } from "react";
import type { ConnectionConfig } from "@/bindings";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { DEFAULT_REDIS_SEPARATOR } from "@/features/connections/options";
import { ConsolePanel } from "@/features/redis/ConsolePanel";
import { InfoPanel } from "@/features/redis/InfoPanel";
import { KeyBrowser } from "@/features/redis/KeyBrowser";
import { MonitorPanel } from "@/features/redis/MonitorPanel";
import { PubSubPanel } from "@/features/redis/PubSubPanel";
import { useRedisMaster } from "@/features/redis/queries";

type RedisViewProps = { connection: ConnectionConfig; db: number };

type Section = "keys" | "console" | "pubsub" | "monitor" | "info";

const SECTION_LABEL: Record<Section, string> = {
  keys: "Chaves",
  console: "Console",
  pubsub: "Pub/sub",
  monitor: "Monitor",
  info: "Servidor"
};

export function RedisView({ connection, db }: RedisViewProps) {
  const [section, setSection] = useState("keys");
  const promptRef = useRef<HTMLInputElement>(null);
  const sentinel = connection.target.kind === "redisSentinel" ? connection.target : null;
  const master = useRedisMaster(connection.id, sentinel !== null);

  return (
    <Tabs
      value={section}
      onValueChange={setSection}
      // a short window (the minimum at 200% zoom) scrolls the view below its panels' floor
      className="flex h-full flex-col overflow-y-auto"
    >
      {/* wraps rather than clips: zoomed in (Ctrl+=) the connection and the actions drop to a
          second line, whole; py-1 here and on the title keeps one line at 48px */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-foreground bg-background px-4 py-1">
        <h2 className="shrink-0 py-1 display text-[1.75rem] leading-[1.15]">db{db}</h2>
        <TabsList aria-label="Seções do Redis" className="min-w-0 flex-wrap">
          {(Object.keys(SECTION_LABEL) as Section[]).map(id => (
            <TabsTrigger
              key={id}
              value={id}
              // picking Console (click, Enter or Space) lands on its prompt so typing goes there;
              // arrowing across the sections only moves through them. The section is already
              // active by the click (Radix switches on mousedown or focus), so the prompt is shown
              onClick={id === "console" ? () => promptRef.current?.focus() : undefined}
            >
              {SECTION_LABEL[id]}
            </TabsTrigger>
          ))}
        </TabsList>
        {connection.readOnly && <Badge variant="held">Somente leitura</Badge>}
        {/* which server the writes reach: the sentinels decide it at each connect */}
        {sentinel && master.data && (
          <p className="text-xs text-muted-foreground">
            master {sentinel.masterName} em <span className="font-mono">{master.data}</span>
          </p>
        )}
        <ConnectionContext connectionId={connection.id} className="ml-auto" />
      </div>
      {/* panels stay mounted so the selected key and the console scrollback survive switching */}
      <TabsContent value="keys" forceMount className="min-h-64 flex-1">
        <KeyBrowser
          connectionId={connection.id}
          db={db}
          separator={connection.keySeparator ?? DEFAULT_REDIS_SEPARATOR}
          readOnly={connection.readOnly}
        />
      </TabsContent>
      <TabsContent value="console" forceMount className="min-h-64 flex-1">
        <ConsolePanel connectionId={connection.id} db={db} promptRef={promptRef} />
      </TabsContent>
      {/* mounted while the tab is open: the subscription survives switching sections */}
      <TabsContent value="pubsub" forceMount className="min-h-64 flex-1">
        <PubSubPanel connectionId={connection.id} db={db} readOnly={connection.readOnly} />
      </TabsContent>
      {/* not kept mounted: leaving the section stops MONITOR, which costs the server */}
      <TabsContent value="monitor" className="min-h-64 flex-1">
        <MonitorPanel connectionId={connection.id} />
      </TabsContent>
      <TabsContent value="info" className="min-h-64 flex-1">
        <InfoPanel connectionId={connection.id} />
      </TabsContent>
    </Tabs>
  );
}

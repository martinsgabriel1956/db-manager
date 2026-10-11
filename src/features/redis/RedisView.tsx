import { useState } from "react";
import type { ConnectionConfig } from "@/bindings";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_REDIS_SEPARATOR } from "@/features/connections/options";
import { ConsolePanel } from "@/features/redis/ConsolePanel";
import { InfoPanel } from "@/features/redis/InfoPanel";
import { KeyBrowser } from "@/features/redis/KeyBrowser";
import { cn } from "@/lib/utils";

type RedisViewProps = { connection: ConnectionConfig; db: number };

type Section = "keys" | "console" | "info";

const SECTION_LABEL: Record<Section, string> = {
  keys: "Chaves",
  console: "Console",
  info: "Servidor"
};

export function RedisView({ connection, db }: RedisViewProps) {
  const [section, setSection] = useState<Section>("keys");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b px-3">
        <h2 className="py-2 font-mono text-sm font-semibold">
          {connection.name} · db{db}
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
        {connection.readOnly && <Badge variant="outline">Somente leitura</Badge>}
      </div>
      {/* panels stay mounted so the selected key and the console scrollback survive switching */}
      <div className={cn("min-h-0 flex-1", section !== "keys" && "hidden")}>
        <KeyBrowser
          connectionId={connection.id}
          db={db}
          separator={connection.keySeparator ?? DEFAULT_REDIS_SEPARATOR}
          readOnly={connection.readOnly}
        />
      </div>
      <div className={cn("min-h-0 flex-1", section !== "console" && "hidden")}>
        <ConsolePanel connectionId={connection.id} db={db} />
      </div>
      {section === "info" && <InfoPanel connectionId={connection.id} />}
    </div>
  );
}

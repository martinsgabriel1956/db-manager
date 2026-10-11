import type { ConnectionConfig } from "@/bindings";
import { Badge } from "@/components/ui/badge";
import { ENGINE_LABEL, ENVIRONMENT_STYLE } from "@/features/connections/options";
import { cn } from "@/lib/utils";

type ConnectionListProps = {
  connections: ConnectionConfig[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ConnectionList({ connections, selectedId, onSelect }: ConnectionListProps) {
  if (connections.length === 0) {
    return <p className="px-3 text-sm text-muted-foreground">Nenhuma conexão cadastrada.</p>;
  }

  return (
    <ul className="grid gap-0.5 px-2">
      {connections.map(connection => {
        const environment = ENVIRONMENT_STYLE[connection.environment];
        return (
          <li key={connection.id}>
            <button
              type="button"
              aria-current={connection.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(connection.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                connection.id === selectedId && "bg-muted"
              )}
            >
              <span
                className={cn("size-2 shrink-0 rounded-full", environment.dotClass)}
                title={environment.label}
              />
              <span className="min-w-0 flex-1 truncate">{connection.name}</span>
              <span className="text-xs text-muted-foreground">
                {ENGINE_LABEL[connection.engine]}
              </span>
              {connection.readOnly && <Badge variant="outline">RO</Badge>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

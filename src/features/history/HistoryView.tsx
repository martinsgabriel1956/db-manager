import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, SquareTerminal } from "lucide-react";
import { commands, type ConnectionConfig } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";

type HistoryViewProps = {
  connections: ConnectionConfig[];
  onOpenInEditor: (connectionId: string, sql: string) => void;
};

const ALL = "";

export function formatExecutedAt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

export function HistoryView({ connections, onOpenInEditor }: HistoryViewProps) {
  const [text, setText] = useState("");
  const [connectionId, setConnectionId] = useState(ALL);
  const history = useQuery({
    queryKey: ["history", text, connectionId],
    queryFn: () => commands.searchHistory(text, connectionId === ALL ? null : connectionId)
  });
  const knownConnections = new Set(connections.map(connection => connection.id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="mr-2 text-sm font-semibold">Histórico</h2>
        <Input
          aria-label="Buscar no histórico"
          placeholder="Buscar no SQL…"
          className="h-7 w-72"
          value={text}
          onChange={event => setText(event.target.value)}
        />
        <select
          aria-label="Filtrar por conexão"
          className="h-7 rounded-md border border-input bg-transparent px-2 text-sm"
          value={connectionId}
          onChange={event => setConnectionId(event.target.value)}
        >
          <option value={ALL}>Todas as conexões</option>
          {connections.map(connection => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>
      </div>

      {history.isError && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {errorMessage(history.error)}
        </p>
      )}
      {history.data?.length === 0 && (
        <p className="p-3 text-sm text-muted-foreground">Nada no histórico.</p>
      )}
      <ul className="min-h-0 flex-1 divide-y overflow-auto">
        {history.data?.map(entry => (
          <li key={entry.id} className="grid gap-1 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {entry.success ? (
                <CircleCheck className="size-3.5 text-emerald-600" aria-label="sucesso" />
              ) : (
                <CircleX className="size-3.5 text-destructive" aria-label="erro" />
              )}
              <span>{formatExecutedAt(entry.executedAt)}</span>
              <span>·</span>
              <span className="font-medium text-foreground">{entry.connectionName}</span>
              <span>·</span>
              <span>{entry.durationMs} ms</span>
              {knownConnections.has(entry.connectionId) && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => onOpenInEditor(entry.connectionId, entry.sql)}
                >
                  <SquareTerminal /> Abrir no editor
                </Button>
              )}
            </div>
            <pre className="max-h-24 overflow-hidden font-mono text-xs break-all whitespace-pre-wrap">
              {entry.sql}
            </pre>
            {entry.error && <p className="text-xs text-destructive">{entry.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

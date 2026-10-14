import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, SquareTerminal, Star } from "lucide-react";
import { commands, type ConnectionConfig } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { isSqlEngine } from "@/features/connections/options";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type HistoryViewProps = {
  connections: ConnectionConfig[];
  onOpenInEditor: (connectionId: string, sql: string) => void;
};

const ALL = "";

/** typing pauses this long before the history is searched */
const SEARCH_DELAY_MS = 250;

/** width of the longest run's duration bar */
const DURATION_BAR_PX = 96;

export function formatExecutedAt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

export function HistoryView({ connections, onOpenInEditor }: HistoryViewProps) {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [connectionId, setConnectionId] = useState(ALL);
  const [starredOnly, setStarredOnly] = useState(false);
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ["history", search, connectionId, starredOnly],
    queryFn: () =>
      commands.searchHistory(search, connectionId === ALL ? null : connectionId, starredOnly),
    // the previous results stay on screen while the next search runs
    placeholderData: keepPreviousData
  });
  const star = useMutation({
    mutationFn: ({ id, starred }: { id: number; starred: boolean }) =>
      commands.starHistory(id, starred),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["history"] })
  });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  // durations share one linear scale, so bar length is comparable down the list
  const longest = Math.max(1, ...(history.data ?? []).map(entry => entry.durationMs));
  // only SQL entries can be re-run in the editor
  const sqlConnections = new Set(
    connections
      .filter(connection => isSqlEngine(connection.engine))
      .map(connection => connection.id)
  );

  return (
    <div className="flex h-full flex-col">
      {/* the same view header as SQL, tables and collections: the title at the same size, on paper */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-foreground bg-background px-4 py-2">
        <h2 className="display-caps text-[1.75rem] leading-[1.15]">Histórico</h2>
        <Input
          aria-label="Buscar no histórico"
          placeholder="Buscar no SQL…"
          className="h-7 w-72"
          value={text}
          onChange={event => setText(event.target.value)}
        />
        <NativeSelect
          aria-label="Filtrar por conexão"
          className="h-7"
          value={connectionId}
          onChange={event => setConnectionId(event.target.value)}
        >
          <option value={ALL}>Todas as conexões</option>
          {connections.map(connection => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </NativeSelect>
        <Button
          size="sm"
          variant={starredOnly ? "default" : "outline"}
          className="h-7"
          aria-pressed={starredOnly}
          onClick={() => setStarredOnly(prev => !prev)}
        >
          <Star className={cn(starredOnly && "fill-current")} /> Favoritas
        </Button>
      </div>

      {star.isError && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {errorMessage(star.error)}
        </p>
      )}
      {history.isError && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {errorMessage(history.error)}
        </p>
      )}
      {history.data?.length === 0 && (
        <div className="grid flex-1 content-center justify-items-start gap-2 px-10 grid-paper">
          {/* a search that finds nothing is not an empty history */}
          {starredOnly && search === "" && connectionId === ALL ? (
            <>
              <p className="display-caps text-4xl">Nenhuma favorita</p>
              <p className="max-w-[46ch] text-sm text-muted-foreground">
                Marque a estrela de uma entrada para guardar a query aqui.
              </p>
            </>
          ) : search !== "" || connectionId !== ALL || starredOnly ? (
            <>
              <p className="display-caps text-4xl">Nenhum resultado</p>
              <p className="max-w-[46ch] text-sm text-muted-foreground">
                Nada no histórico corresponde
                {search !== "" ? ` a “${search}”` : ""}
                {connectionId !== ALL ? " nesta conexão" : ""}
                {starredOnly ? " entre as favoritas" : ""}. Mude a busca ou os filtros.
              </p>
            </>
          ) : (
            <>
              <p className="display-caps text-4xl">Nada no histórico</p>
              <p className="max-w-[46ch] text-sm text-muted-foreground">
                Cada query, edição salva e comando executado aparece aqui.
              </p>
            </>
          )}
        </div>
      )}
      <ul
        className={`min-h-0 flex-1 divide-y overflow-auto ${history.data?.length === 0 ? "hidden" : ""}`}
      >
        {history.data?.map(entry => (
          <li key={entry.id} className="grid gap-1 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Button
                size="icon-xs"
                variant="ghost"
                className="-ml-1"
                aria-label="Favorita"
                aria-pressed={entry.starred}
                title={entry.starred ? "Remover das favoritas" : "Marcar como favorita"}
                onClick={() => star.mutate({ id: entry.id, starred: !entry.starred })}
              >
                <Star className={cn(entry.starred && "fill-current text-foreground")} />
              </Button>
              {entry.success ? (
                <CircleCheck className="size-3.5 text-success" aria-label="sucesso" />
              ) : (
                <CircleX className="size-3.5 text-destructive" aria-label="erro" />
              )}
              <span>{formatExecutedAt(entry.executedAt)}</span>
              <span>·</span>
              <span className="font-medium text-foreground">{entry.connectionName}</span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-1.5 bg-foreground/60"
                  style={{ width: Math.max(2, (entry.durationMs / longest) * DURATION_BAR_PX) }}
                />
                {entry.durationMs} ms
              </span>
              {sqlConnections.has(entry.connectionId) && (
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
            <HistoryCommand text={entry.sql} />
            {entry.error && <p className="text-xs text-destructive">{entry.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Six lines at rest; a longer command says so and opens in place, never silently cut. */
function HistoryCommand({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [clipped, setClipped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && !expanded) {
      setClipped(element.scrollHeight > element.clientHeight);
    }
  }, [text, expanded]);

  return (
    <div className="grid justify-items-start gap-1">
      <pre
        ref={ref}
        className={`w-full font-mono text-xs break-all whitespace-pre-wrap ${expanded ? "" : "max-h-24 overflow-hidden"}`}
      >
        {text}
      </pre>
      {(clipped || expanded) && (
        <Button
          size="xs"
          variant="ghost"
          className="-ml-2"
          aria-expanded={expanded}
          onClick={() => setExpanded(prev => !prev)}
        >
          {expanded ? "Recolher comando" : "Mostrar comando inteiro"}
        </Button>
      )}
    </div>
  );
}

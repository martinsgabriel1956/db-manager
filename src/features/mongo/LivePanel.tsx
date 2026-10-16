import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { commands, type ChangeEvent, type WatchMessage } from "@/bindings";
import { Button } from "@/components/ui/button";
import { connected } from "@/features/explorer/queries";
import { DocumentTree } from "@/features/mongo/DocumentTree";
import { describeWrapper, isValidJson, parseDocument } from "@/features/mongo/ejson";
import { JsonEditor } from "@/features/mongo/JsonEditor";
import { errorMessage } from "@/lib/errors";

type LivePanelProps = { connectionId: string; database: string; collection: string };

/** Events kept in memory; older ones are dropped as new ones arrive. */
export const MAX_LIVE_EVENTS = 500;

type Entry = { seq: number; event: ChangeEvent };

type Status =
  | { state: "idle" }
  | { state: "opening" }
  | { state: "live" }
  | { state: "error"; message: string };

/**
 * A change stream on the collection while the panel is open: unmounting (leaving
 * the section, closing the tab) stops it on the server. Pause only freezes the
 * view; events keep arriving, up to the same limit.
 */
export function LivePanel({ connectionId, database, collection }: LivePanelProps) {
  const [pipeline, setPipeline] = useState("[]");
  const [syntaxError, setSyntaxError] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [frozen, setFrozen] = useState<Entry[] | null>(null);
  const seq = useRef(0);
  const stopCurrent = useRef<(() => void) | null>(null);

  function stop() {
    stopCurrent.current?.();
    stopCurrent.current = null;
  }

  // the stream never outlives the panel
  useEffect(() => stop, []);

  function start() {
    if (!isValidJson(pipeline)) {
      setSyntaxError(true);
      return;
    }
    setSyntaxError(false);
    stop();
    const watchId = crypto.randomUUID();
    let active = true;
    const channel = new Channel<WatchMessage>(message => {
      if (!active) {
        return;
      }
      if (message.kind === "error") {
        setStatus({ state: "error", message: message.message });
        return;
      }
      seq.current += 1;
      const entry = { seq: seq.current, event: message.event };
      setEntries(prev => [entry, ...prev].slice(0, MAX_LIVE_EVENTS));
    });
    setStatus({ state: "opening" });
    const opened = connected(connectionId, () =>
      commands.watchCollection(connectionId, watchId, database, collection, pipeline, channel)
    ).then(
      () => active && setStatus({ state: "live" }),
      error => active && setStatus({ state: "error", message: errorMessage(error) })
    );
    stopCurrent.current = () => {
      active = false;
      setStatus({ state: "idle" });
      // after opening resolves, so a stop sent while it opens cannot arrive first
      opened.finally(() => commands.stopWatch(watchId).catch(() => undefined));
    };
  }

  const shown = frozen ?? entries;
  const unseen = frozen ? (entries[0]?.seq ?? 0) - (frozen[0]?.seq ?? 0) : 0;
  const running = status.state === "opening" || status.state === "live";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          Filtro do <span className="font-mono">watch</span>: pipeline em Extended JSON (vazio ={" "}
          <span className="font-mono">[]</span>)
        </span>
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button size="sm" variant="outline" onClick={stop}>
              <Square /> Parar
            </Button>
          ) : (
            <Button size="sm" onClick={start}>
              <Play /> Iniciar
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            aria-pressed={frozen !== null}
            onClick={() => setFrozen(frozen ? null : entries)}
          >
            {frozen ? <Play /> : <Pause />} {frozen ? "Retomar" : "Pausar"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEntries([]);
              setFrozen(frozen && []);
            }}
          >
            <Trash2 /> Limpar
          </Button>
        </div>
      </div>
      <div className="h-24 shrink-0 p-2">
        <JsonEditor
          label="Pipeline do watch"
          value={pipeline}
          onChange={setPipeline}
          onRun={start}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t bg-muted/30 p-3">
        {syntaxError && (
          <p role="alert" className="text-sm text-destructive">
            JSON inválido
          </p>
        )}
        {status.state === "error" && (
          <p role="alert" className="mb-2 font-mono text-sm whitespace-pre-wrap text-destructive">
            {status.message}
          </p>
        )}
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {liveSummary(status.state, entries.length, unseen)}
        </p>
        <ol className="grid gap-2">
          {shown.map(({ seq: key, event }) => (
            <LiveEvent key={key} event={event} />
          ))}
        </ol>
      </div>
    </div>
  );
}

/** "Ouvindo · 3 eventos", "Pausado · 2 novos eventos fora da tela", with the limit when reached. */
export function liveSummary(state: Status["state"], count: number, unseen: number): string {
  const head =
    state === "opening"
      ? "Abrindo o change stream…"
      : state === "live"
        ? "Ouvindo"
        : state === "error"
          ? "Encerrado"
          : "Parado";
  const events =
    count >= MAX_LIVE_EVENTS
      ? `os últimos ${MAX_LIVE_EVENTS} eventos (os mais antigos saem da memória)`
      : `${count} ${count === 1 ? "evento" : "eventos"}`;
  const paused = unseen > 0 ? ` · pausado: ${unseen} novos fora da tela` : "";
  return `${head} · ${events}${paused}`;
}

function LiveEvent({ event }: { event: ChangeEvent }) {
  const body = event.document ?? event.diff;
  const id = event.id === null ? null : (describeWrapper(JSON.parse(event.id)) ?? event.id);
  return (
    <li className="grid gap-2 border border-foreground bg-background p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs">
        <span className="font-semibold">{event.operation}</span>
        {id !== null && <span>_id: {id}</span>}
        {event.at && (
          <time dateTime={event.at} className="ml-auto text-muted-foreground">
            {new Date(event.at).toLocaleString("pt-BR")}
          </time>
        )}
      </div>
      {body && (
        <div>
          {event.diff && !event.document && (
            <p className="mb-1 font-mono text-xs text-muted-foreground">updateDescription</p>
          )}
          <DocumentTree document={parseDocument(body)} />
        </div>
      )}
    </li>
  );
}

import { useEffect, useRef } from "react";
import { Pause, Play, Square, TriangleAlert } from "lucide-react";
import { commands, type Confirmation, type MonitorEvent } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { connected } from "@/features/explorer/queries";
import { LIVE_LIMIT, clock, useLiveLog, useLiveSession } from "@/features/redis/liveLog";
import { useConfirmed } from "@/features/redis/queries";
import { cn } from "@/lib/utils";

type Line = Extract<MonitorEvent, { kind: "line" }>;

/**
 * MONITOR on a dedicated connection. Mounted only while its section is open, so
 * leaving the section (or closing the tab) stops it; the backend also stops it
 * after 60 s or 10 000 lines.
 */
export function MonitorPanel({ connectionId }: { connectionId: string }) {
  const log = useLiveLog<Line>();
  const session = useLiveSession<MonitorEvent>(connectionId, event => log.push(event as Line));
  const running = session.status.state === "running";
  const bottomRef = useRef<HTMLDivElement>(null);

  const starter = useConfirmed<null>(async (_, confirmed) => {
    let confirmation: Confirmation | null = null;
    await session.start(async (sessionId, channel) => {
      const response = await connected(connectionId, () =>
        commands.redisMonitor(connectionId, sessionId, confirmed, channel)
      );
      if (response.status === "needsConfirmation") {
        confirmation = response.confirmation;
        return false;
      }
      return true;
    });
    return confirmation;
  });

  useEffect(() => {
    if (!log.paused) {
      bottomRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [log.lines, log.paused]);

  return (
    <div className="flex h-full flex-col">
      <p className="flex items-start gap-2 border-b px-3 py-2 text-xs text-warning">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>
          MONITOR envia a este app cada comando que o servidor executa e pode reduzir bastante o
          desempenho dele. Para sozinho após 60 s ou 10 000 linhas, ao sair desta seção ou ao fechar
          a aba.
        </span>
      </p>
      <div className="flex items-center gap-2 border-b bg-muted px-3 py-2">
        {running ? (
          <Button size="sm" variant="outline" onClick={session.stop}>
            <Square /> Parar
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={starter.isPending}
            onClick={() => starter.submit(null)}
          >
            Iniciar MONITOR
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={log.paused}
          onClick={() => log.setPaused(!log.paused)}
        >
          {log.paused ? <Play /> : <Pause />} {log.paused ? "Retomar" : "Pausar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={log.clear}>
          Limpar linhas
        </Button>
        <span role="status" className="ml-auto text-xs text-muted-foreground">
          {running
            ? "Monitorando"
            : session.status.state === "ended"
              ? session.status.reason
              : "Parado"}
          {log.paused && " · pausado (novas linhas aparecem ao retomar)"}
        </span>
      </div>
      {starter.error && (
        <p role="alert" className="border-b px-3 py-1.5 text-xs text-destructive">
          {starter.error}
        </p>
      )}
      <div
        role="log"
        aria-label="Comandos monitorados"
        className={cn(
          "min-h-0 flex-1 overflow-auto",
          log.lines.length === 0
            ? "grid content-center justify-items-start gap-2 px-8 grid-paper"
            : "p-3 font-mono text-xs"
        )}
      >
        {log.lines.length === 0 ? (
          <>
            <p aria-hidden className="display-caps text-3xl">
              Nada monitorado
            </p>
            <p className="max-w-[52ch] text-sm text-muted-foreground">
              Inicie o MONITOR para ver os comandos de todos os clientes deste servidor. Ficam na
              tela as últimas {LIVE_LIMIT} linhas.
            </p>
          </>
        ) : (
          log.lines.map(line => (
            <div key={line.seq} className="flex gap-3 border-b py-1">
              <span className="shrink-0 text-muted-foreground">{clock(line.receivedAt)}</span>
              <span className="min-w-0 break-all whitespace-pre-wrap">{line.text}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={starter.confirmation}
        confirmLabel="Iniciar MONITOR"
        statementSuffix=""
        pending={starter.isPending}
        onConfirm={starter.confirm}
        onCancel={starter.dismiss}
      />
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Square } from "lucide-react";
import { commands, type PubSubEvent, type RedisText } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connected } from "@/features/explorer/queries";
import { LIVE_LIMIT, clock, useLiveLog, useLiveSession } from "@/features/redis/liveLog";
import { useConfirmed } from "@/features/redis/queries";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type PubSubPanelProps = { connectionId: string; db: number; readOnly: boolean };

type Message = Extract<PubSubEvent, { kind: "message" }>;

// ponytail: names split on whitespace, so a channel with spaces cannot be subscribed
function words(text: string): string[] {
  return text.split(/\s+/).filter(word => word !== "");
}

function Text({ value }: { value: RedisText }) {
  return (
    <span
      className={cn(value.binary && "text-muted-foreground")}
      title={value.binary ? "binário" : undefined}
    >
      {value.text}
    </span>
  );
}

/**
 * SUBSCRIBE/PSUBSCRIBE on a dedicated connection, messages listed live; PUBLISH
 * goes through the same rules as any write.
 */
export function PubSubPanel({ connectionId, db, readOnly }: PubSubPanelProps) {
  const queryClient = useQueryClient();
  const [channels, setChannels] = useState("");
  const [patterns, setPatterns] = useState("");
  const [error, setError] = useState<string | null>(null);
  const log = useLiveLog<Message>();
  const session = useLiveSession<PubSubEvent>(connectionId, event => log.push(event as Message));
  const running = session.status.state === "running";
  const bottomRef = useRef<HTMLDivElement>(null);

  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [published, setPublished] = useState<string | null>(null);
  const publisher = useConfirmed<{ channel: string; message: string }>(async (input, confirmed) => {
    const response = await connected(connectionId, () =>
      commands.redisPublish(connectionId, db, input.channel, input.message, confirmed)
    );
    queryClient.invalidateQueries({ queryKey: ["history"] });
    if (response.status === "needsConfirmation") {
      return response.confirmation;
    }
    setPublished(`Entregue a ${response.outcome.output.replace("(integer) ", "")} assinante(s)`);
    return null;
  });

  useEffect(() => {
    if (!log.paused) {
      bottomRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [log.lines, log.paused]);

  async function subscribe(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await session.start(async (sessionId, channel) => {
        await connected(connectionId, () =>
          commands.redisSubscribe(
            connectionId,
            sessionId,
            words(channels),
            words(patterns),
            channel
          )
        );
        return true;
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function publish(event: FormEvent) {
    event.preventDefault();
    setPublished(null);
    publisher.submit({ channel: target, message });
  }

  return (
    <div className="flex h-full flex-col">
      <form
        onSubmit={subscribe}
        className="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-2"
      >
        <Input
          aria-label="Canais"
          placeholder="Canais (SUBSCRIBE), separados por espaço"
          className="h-7 w-72 font-mono text-xs"
          disabled={running}
          value={channels}
          onChange={event => setChannels(event.target.value)}
        />
        <Input
          aria-label="Padrões"
          placeholder="Padrões (PSUBSCRIBE), ex.: news.*"
          className="h-7 w-64 font-mono text-xs"
          disabled={running}
          value={patterns}
          onChange={event => setPatterns(event.target.value)}
        />
        {running ? (
          <Button type="button" size="sm" variant="outline" onClick={session.stop}>
            <Square /> Parar
          </Button>
        ) : (
          <Button type="submit" size="sm" variant="outline">
            Assinar
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={log.paused}
          onClick={() => log.setPaused(!log.paused)}
        >
          {log.paused ? <Play /> : <Pause />} {log.paused ? "Retomar" : "Pausar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={log.clear}>
          Limpar mensagens
        </Button>
        <span role="status" className="ml-auto text-xs text-muted-foreground">
          {running
            ? "Assinando"
            : session.status.state === "ended"
              ? session.status.reason
              : "Parado"}
          {log.paused && " · pausado (novas mensagens aparecem ao retomar)"}
        </span>
      </form>
      {error && (
        <p role="alert" className="border-b px-3 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
      <div
        role="log"
        aria-label="Mensagens recebidas"
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
              Nenhuma mensagem
            </p>
            <p className="max-w-[52ch] text-sm text-muted-foreground">
              A assinatura usa uma conexão própria e termina ao parar, ao fechar a aba ou a conexão.
              Ficam na tela as últimas {LIVE_LIMIT} mensagens.
            </p>
          </>
        ) : (
          log.lines.map(line => (
            <div key={line.seq} className="flex gap-3 border-b py-1">
              <span className="shrink-0 text-muted-foreground">{clock(line.receivedAt)}</span>
              <span className="shrink-0 font-semibold">
                <Text value={line.channel} />
                {line.pattern && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    ← <Text value={line.pattern} />
                  </span>
                )}
              </span>
              <span className="min-w-0 break-all whitespace-pre-wrap">
                <Text value={line.payload} />
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={publish} className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {readOnly ? (
          <span className="text-xs text-muted-foreground">
            Somente leitura: PUBLISH é escrita e está desativado.
          </span>
        ) : (
          <>
            <Input
              aria-label="Canal para publicar"
              placeholder="Canal"
              className="h-7 w-48 font-mono text-xs"
              value={target}
              onChange={event => setTarget(event.target.value)}
            />
            <Input
              aria-label="Mensagem"
              placeholder="Mensagem"
              className="h-7 min-w-0 flex-1 font-mono text-xs"
              value={message}
              onChange={event => setMessage(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={target === "" || publisher.isPending}
            >
              Publicar
            </Button>
            {published && (
              <span role="status" className="text-xs text-success">
                {published}
              </span>
            )}
            {publisher.error && (
              <span role="alert" className="text-xs text-destructive">
                {publisher.error}
              </span>
            )}
          </>
        )}
      </form>
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={publisher.confirmation}
        confirmLabel="Publicar"
        statementSuffix=""
        pending={publisher.isPending}
        onConfirm={publisher.confirm}
        onCancel={publisher.dismiss}
      />
    </div>
  );
}

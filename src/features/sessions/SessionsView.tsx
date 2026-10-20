import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  commands,
  type Confirmation,
  type ConnectionConfig,
  type Engine,
  type KillAction,
  type SessionInfo,
  type SlowCommand
} from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { connected } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

type SessionsViewProps = { connection: ConnectionConfig };

type Kill = { session: SessionInfo; action: KillAction };

/** Off by default: refreshing is a query on the server, the user turns it on. */
const INTERVALS = [
  { label: "Desligada", ms: 0 },
  { label: "a cada 5 s", ms: 5000 },
  { label: "a cada 15 s", ms: 15000 },
  { label: "a cada 60 s", ms: 60000 }
];

/** What each action does on this engine, in its own words. */
export function actionLabel(engine: Engine, action: KillAction): string {
  if (action === "cancelQuery") {
    return engine === "mongo" ? "Encerrar operação" : "Cancelar query";
  }
  return engine === "redis" ? "Encerrar conexão" : "Encerrar sessão";
}

/** "45 s", "3 min", "2 h 5 min" */
export function duration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** Who is connected and what they run; a query or a session can be ended from here. */
export function SessionsView({ connection }: SessionsViewProps) {
  const [refreshMs, setRefreshMs] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pendingKill, setPendingKill] = useState<Kill | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: ["sessions", connection.id],
    queryFn: () => connected(connection.id, () => commands.listSessions(connection.id)),
    refetchInterval: refreshMs === 0 ? false : refreshMs
  });

  const kill = useMutation({
    mutationFn: ({ kill: { session, action }, confirmed }: { kill: Kill; confirmed: boolean }) =>
      commands.killSession(connection.id, session.id, action, confirmed),
    onSuccess: (response, { kill: request }) => {
      if (response.status === "needsConfirmation") {
        setPendingKill(request);
        setConfirmation(response.confirmation);
        return;
      }
      setConfirmation(null);
      setPendingKill(null);
      setNotice(
        `${actionLabel(connection.engine, request.action)}: comando enviado a ${request.session.id}`
      );
      sessions.refetch();
    },
    onError: () => {
      setConfirmation(null);
      setPendingKill(null);
    }
  });

  const list = sessions.data;
  const isRedis = connection.engine === "redis";

  return (
    <div className="flex h-full flex-col">
      {/* wraps rather than clips: zoomed in (Ctrl+=) the connection and the actions drop to a
          second line, whole; py-1 here and on the title keeps one line at 48px */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-foreground bg-background px-4 py-1">
        <h2 className="shrink-0 py-1 display-caps text-[1.75rem] leading-[1.15]">Sessões</h2>
        {connection.readOnly && <Badge variant="held">Somente leitura</Badge>}
        <ConnectionContext connectionId={connection.id} className="ml-auto" />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted px-3 py-2 text-xs">
        <Button
          size="sm"
          variant="outline"
          disabled={sessions.isFetching}
          onClick={() => {
            setNotice(null);
            sessions.refetch();
          }}
        >
          <RefreshCw /> Atualizar
        </Button>
        <label className="flex items-center gap-1.5">
          <span className="legend text-muted-foreground">Atualização automática</span>
          <NativeSelect
            className="h-7 text-xs"
            value={refreshMs}
            onChange={event => setRefreshMs(Number(event.target.value))}
          >
            {INTERVALS.map(option => (
              <option key={option.ms} value={option.ms}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        {sessions.isFetching && <span className="text-muted-foreground">atualizando…</span>}
        {connection.readOnly && (
          <span className="text-muted-foreground">
            Conexão somente leitura: encerrar query ou sessão está desligado.
          </span>
        )}
      </div>
      {notice && (
        <p role="status" className="border-b px-3 py-1.5 text-xs text-success">
          {notice}
        </p>
      )}
      {(sessions.isError || kill.isError) && (
        <p role="alert" className="border-b px-3 py-1.5 text-sm text-destructive">
          {errorMessage(sessions.error ?? kill.error)}
        </p>
      )}
      {sessions.isPending && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
      {list && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Lido com <code className="font-mono whitespace-pre-wrap">{list.statement}</code>
          </p>
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">Sessões de {connection.name}</caption>
            <thead>
              <tr className="sticky top-0 h-7 border-b border-foreground bg-muted text-left legend text-muted-foreground [&>th]:px-2">
                <th className="font-medium">Id</th>
                <th className="font-medium">Usuário</th>
                <th className="font-medium">Banco</th>
                <th className="font-medium">Estado</th>
                <th className="font-medium">Tempo</th>
                <th className="font-medium">Cliente</th>
                <th className="font-medium">{isRedis ? "Último comando" : "Query"}</th>
                <th className="font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {list.sessions.map(session => (
                <tr key={session.id} className="h-7 border-b align-top [&>td]:px-2">
                  <td className="py-1 whitespace-nowrap">
                    {session.id}
                    {session.own && (
                      <Badge variant="held" className="ml-1.5 font-sans">
                        Este app
                      </Badge>
                    )}
                  </td>
                  <td className="py-1">{session.user ?? "—"}</td>
                  <td className="py-1">{session.database ?? "—"}</td>
                  <td className="py-1">{session.state ?? "—"}</td>
                  <td className="py-1 whitespace-nowrap">{duration(session.seconds)}</td>
                  <td className="py-1">{session.client ?? "—"}</td>
                  <td className="max-w-[40ch] py-1 break-words whitespace-pre-wrap">
                    {session.query ?? "—"}
                  </td>
                  <td className="py-1 font-sans whitespace-nowrap">
                    {!connection.readOnly &&
                      list.actions.map(action => (
                        <Button
                          key={action}
                          size="xs"
                          variant="outline"
                          className="mr-1"
                          // the listing's own session: ending it would only cut the app's own query
                          disabled={session.own || kill.isPending}
                          title={
                            session.own ? "Sessão que o próprio app usou para listar" : undefined
                          }
                          aria-label={`${actionLabel(connection.engine, action)} ${session.id}`}
                          onClick={() => {
                            setNotice(null);
                            kill.mutate({ kill: { session, action }, confirmed: false });
                          }}
                        >
                          {actionLabel(connection.engine, action)}
                        </Button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.sessions.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">Nenhuma sessão.</p>
          )}
          {isRedis && <SlowLog entries={list.slowLog} />}
        </div>
      )}
      <ConfirmDialog
        connectionId={connection.id}
        confirmation={confirmation}
        confirmLabel={pendingKill ? actionLabel(connection.engine, pendingKill.action) : "Encerrar"}
        statementSuffix={
          connection.engine === "postgres" || connection.engine === "mysql" ? ";" : ""
        }
        pending={kill.isPending}
        onConfirm={() => pendingKill && kill.mutate({ kill: pendingKill, confirmed: true })}
        onCancel={() => {
          setConfirmation(null);
          setPendingKill(null);
        }}
      />
    </div>
  );
}

/** Redis' SLOWLOG: what took longest lately, by the server's own count. */
function SlowLog({ entries }: { entries: SlowCommand[] }) {
  return (
    <section aria-label="Comandos lentos" className="mt-6">
      <h3 className="mb-1 text-sm font-semibold">Comandos lentos (SLOWLOG GET 128)</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum comando no slowlog.</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="sticky top-0 h-7 border-b border-foreground bg-muted text-left legend text-muted-foreground [&>th]:px-2">
              <th className="font-medium">Id</th>
              <th className="font-medium">Início (UTC)</th>
              <th className="font-medium">Duração</th>
              <th className="font-medium">Comando</th>
              <th className="font-medium">Cliente</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {entries.map(entry => (
              <tr key={entry.id} className="h-7 border-b align-top [&>td]:px-2">
                <td className="py-1">{entry.id}</td>
                <td className="py-1 whitespace-nowrap">
                  {new Date(entry.startedAt * 1000).toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td className="py-1 whitespace-nowrap">
                  {entry.durationUs.toLocaleString("pt-BR")} µs
                </td>
                <td className="py-1 break-all">{entry.command}</td>
                <td className="py-1">{entry.client ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

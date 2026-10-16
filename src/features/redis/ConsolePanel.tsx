import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { connected } from "@/features/explorer/queries";
import { useConfirmed } from "@/features/redis/queries";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type ConsolePanelProps = {
  connectionId: string;
  db: number;
  /** the view focuses the prompt when Console is picked */
  promptRef?: RefObject<HTMLInputElement | null>;
};

type ConsoleLine = {
  id: string;
  command: string;
  output: string;
  failed: boolean;
  durationMs: number | null;
};

/** redis-cli style: one command per line, replies printed below it. */
export function ConsolePanel({ connectionId, db, promptRef }: ConsolePanelProps) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [input, setInput] = useState("");
  /** position while browsing earlier commands with ↑/↓; null = typing a new one */
  const [recall, setRecall] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typed = lines.map(line => line.command);

  const runner = useConfirmed<string>(async (command, confirmed) => {
    const append = (line: Omit<ConsoleLine, "id" | "command">) =>
      setLines(prev => [...prev, { id: crypto.randomUUID(), command, ...line }]);
    try {
      const response = await connected(connectionId, () =>
        commands.runRedisCommand(connectionId, db, command, confirmed)
      );
      if (response.status === "needsConfirmation") {
        return response.confirmation;
      }
      append({
        output: response.outcome.output,
        failed: false,
        durationMs: response.outcome.durationMs
      });
    } catch (err) {
      append({ output: errorMessage(err), failed: true, durationMs: null });
    }
    queryClient.invalidateQueries({ queryKey: ["history"] });
    return null;
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [lines]);

  function run(event: FormEvent) {
    event.preventDefault();
    const command = input.trim();
    if (command === "" || runner.isPending) {
      return;
    }
    setInput("");
    setRecall(null);
    runner.submit(command);
  }

  function browse(event: KeyboardEvent<HTMLInputElement>) {
    if (typed.length === 0 || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }
    event.preventDefault();
    const last = typed.length - 1;
    const current = recall ?? typed.length;
    const next = event.key === "ArrowUp" ? Math.max(0, current - 1) : current + 1;
    if (next > last) {
      setRecall(null);
      setInput("");
      return;
    }
    setRecall(next);
    setInput(typed[next]);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          Executa no db{db}. Bloqueantes, MULTI e SELECT não são aceitos; pub/sub tem seção própria.
        </span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setLines([])}>
          Limpar
        </Button>
      </div>
      <div
        role="log"
        aria-label="Saída do console"
        className={cn(
          "min-h-0 flex-1 overflow-auto",
          lines.length === 0
            ? // nothing run yet: the same construction grid as every other empty area
              "grid content-center justify-items-start gap-2 px-8 grid-paper"
            : "p-3 font-mono text-xs"
        )}
      >
        {lines.length === 0 && (
          <>
            <p aria-hidden className="display-caps text-3xl">
              Console vazio
            </p>
            <p className="max-w-[52ch] text-sm text-muted-foreground">
              Digite um comando no prompt abaixo e tecle Enter. ↑ e ↓ trazem os comandos anteriores.
            </p>
          </>
        )}
        {lines.map(line => (
          <div key={line.id} className="mb-2">
            <div className="text-muted-foreground">
              db{db}&gt; <span className="text-foreground">{line.command}</span>
              {line.durationMs !== null && <span className="ml-2">({line.durationMs} ms)</span>}
            </div>
            <pre className={cn("break-all whitespace-pre-wrap", line.failed && "text-destructive")}>
              {line.failed ? `(error) ${line.output}` : line.output}
            </pre>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={run}
        // the prompt input has no box of its own: the whole line shows where focus is
        className="flex items-center gap-2 border-t px-3 py-2 font-mono text-xs focus-within:shadow-[inset_0_2px_0_var(--ring)]"
      >
        <span className="text-muted-foreground">db{db}&gt;</span>
        <input
          ref={promptRef}
          aria-label="Comando Redis"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent outline-none"
          placeholder="GET user:1"
          value={input}
          onChange={event => {
            setInput(event.target.value);
            setRecall(null);
          }}
          onKeyDown={browse}
        />
        {runner.isPending && <span className="text-muted-foreground">executando…</span>}
      </form>
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={runner.confirmation}
        confirmLabel="Executar"
        statementSuffix=""
        pending={runner.isPending}
        onConfirm={runner.confirm}
        onCancel={runner.dismiss}
      />
    </div>
  );
}

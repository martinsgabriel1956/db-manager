import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Cell, ResultColumn, ScriptOutcome, ScriptStep, StepStatus } from "@/bindings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RowsView } from "@/features/editor/RowsView";
import { errorMessage } from "@/lib/errors";

/** The last statement's rows as the runner pages them through the cursor. */
export type LiveRows = {
  columns: ResultColumn[];
  rows: Cell[][];
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
};

type ScriptResultsProps = {
  connectionId: string;
  /** the executed text: each step's span is sliced out of it */
  sql: string;
  outcome: ScriptOutcome;
  /** the last statement's rows, live (null when the script stopped before it) */
  last: LiveRows | null;
  onLoadMore: () => void;
  /** a step was picked in the summary: [from, to) of the executed text */
  onSelectStatement: (from: number, to: number) => void;
  receipt: ReactNode;
  muted: boolean;
};

const STATUS: Record<StepStatus, string> = {
  done: "concluído",
  failed: "erro",
  cancelled: "cancelado",
  notRun: "não executado"
};

const RUN_TAB = "run";
const ROW_HEIGHT = 28;

/** First line of a statement, short enough for a tab. */
function label(text: string, max: number): string {
  const line = text.split("\n").find(part => part.trim() !== "") ?? text;
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function rowsText(step: ScriptStep): string {
  const { result, rowCount } = step;
  if (!result) {
    return rowCount === null ? "" : `${rowCount} linhas`;
  }
  if (result.kind === "command") {
    return `${result.rowsAffected} ${result.rowsAffected === 1 ? "linha afetada" : "linhas afetadas"}`;
  }
  const shown = result.batch.rows.length;
  if (rowCount === null) {
    return `${shown}+ linhas`;
  }
  return rowCount > shown ? `${shown} de ${rowCount} linhas` : `${rowCount} linhas`;
}

/**
 * The results of a script with more than one statement: "Execução", a log of every
 * statement, then one tab per result kept. Only the last statement pages through its
 * cursor; an earlier one shows its first batch and says how many rows there were.
 */
export function ScriptResults({
  connectionId,
  sql,
  outcome,
  last,
  onLoadMore,
  onSelectStatement,
  receipt,
  muted
}: ScriptResultsProps) {
  const { steps } = outcome;
  const total = steps.length;
  const tabs = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.result?.kind === "rows");
  const lastTab = tabs[tabs.length - 1];
  const [tab, setTab] = useState(() =>
    outcome.error || !lastTab ? RUN_TAB : String(lastTab.index)
  );
  const order = [RUN_TAB, ...tabs.map(({ index }) => String(index))];

  function onKeyDown(event: KeyboardEvent) {
    if (!event.altKey || (event.key !== "PageDown" && event.key !== "PageUp")) {
      return;
    }
    event.preventDefault();
    const step = event.key === "PageDown" ? 1 : -1;
    const at = order.indexOf(tab);
    setTab(order[(at + step + order.length) % order.length]);
  }

  function pick(index: number) {
    const [from, to] = steps[index].span;
    onSelectStatement(from, to);
    if (steps[index].result?.kind === "rows") {
      setTab(String(index));
    }
  }

  const text = (step: ScriptStep) => sql.slice(step.span[0], step.span[1]);

  return (
    <Tabs value={tab} onValueChange={setTab} onKeyDown={onKeyDown} className="flex h-full flex-col">
      <div className="flex min-w-0 items-center gap-3 border-b bg-background px-3">
        <TabsList aria-label="Resultados do script" className="min-w-0 overflow-x-auto">
          <TabsTrigger value={RUN_TAB} className="shrink-0">
            Execução
          </TabsTrigger>
          {tabs.map(({ step, index }) => (
            <TabsTrigger
              key={index}
              value={String(index)}
              aria-label={`comando ${index + 1} de ${total}, ${STATUS[step.status]}`}
              title={text(step)}
              className="max-w-56 shrink-0 truncate"
            >
              <span className="tabular-nums">{index + 1}</span> · {label(text(step), 40)}
            </TabsTrigger>
          ))}
        </TabsList>
        <span className="ml-auto hidden text-xs text-muted-foreground min-[1100px]:inline">
          Alt+PageDown/PageUp troca de resultado
        </span>
      </div>
      <TabsContent value={RUN_TAB} className="min-h-0 flex-1">
        <div className="flex h-full flex-col">
          <div
            role="status"
            className={`@container flex min-w-0 items-center gap-2 border-b bg-muted px-3 py-1 text-xs ${muted ? "text-muted-foreground" : ""}`}
          >
            {receipt}
          </div>
          {outcome.error && (
            <p
              role="alert"
              className="border-b px-3 py-1.5 font-mono text-sm whitespace-pre-wrap text-destructive"
            >
              {errorMessage(outcome.error)}
            </p>
          )}
          <StepList steps={steps} text={text} onPick={pick} />
        </div>
      </TabsContent>
      {tabs.map(({ step, index }) => {
        const isLast = index === total - 1;
        const result = step.result;
        if (result?.kind !== "rows") {
          return null;
        }
        const live = isLast ? last : null;
        // an earlier result kept only its first batch: no cursor to page through
        const truncated = !live && result.batch.hasMore;
        return (
          <TabsContent key={index} value={String(index)} className="min-h-0 flex-1">
            <RowsView
              connectionId={connectionId}
              sql={sql}
              columns={live?.columns ?? result.batch.columns}
              rows={live?.rows ?? result.batch.rows}
              hasMore={live?.hasMore ?? false}
              loadingMore={live?.loadingMore ?? false}
              loadError={live?.loadError ?? null}
              onLoadMore={onLoadMore}
              notice={
                truncated
                  ? `Mostrando as primeiras ${result.batch.rows.length} de ${step.rowCount ?? "?"} linhas. Rode o comando sozinho para ver todas.`
                  : null
              }
              exportStatement={isLast ? null : index}
              receipt={receipt}
              muted={muted}
            />
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

type StepListProps = {
  steps: ScriptStep[];
  text: (step: ScriptStep) => string;
  onPick: (index: number) => void;
};

/** Every statement of the script, one 28px row each; long scripts stay virtualized. */
function StepList({ steps, text, onPick }: StepListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  });
  const total = steps.length;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <ol
        aria-label="Comandos do script"
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map(item => {
          const step = steps[item.index];
          const failed = step.status === "failed" || step.status === "cancelled";
          return (
            <li
              key={item.key}
              className="absolute inset-x-0"
              style={{ top: item.start, height: ROW_HEIGHT }}
            >
              <button
                type="button"
                onClick={() => onPick(item.index)}
                aria-label={`comando ${item.index + 1} de ${total}, ${STATUS[step.status]}`}
                title={text(step)}
                className="grid h-full w-full grid-cols-[3rem_minmax(0,1fr)_7rem_10rem_5rem] items-center gap-2 border-b px-3 text-left text-sm tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="text-muted-foreground">{item.index + 1}</span>
                <span className="truncate font-mono text-xs">{label(text(step), 200)}</span>
                <span
                  className={failed ? "font-semibold text-destructive" : "text-muted-foreground"}
                >
                  {STATUS[step.status]}
                </span>
                <span className="text-right">{rowsText(step)}</span>
                <span className="text-right text-muted-foreground">
                  {step.status === "notRun" ? "" : `${step.durationMs} ms`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

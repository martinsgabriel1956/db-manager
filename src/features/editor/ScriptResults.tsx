import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Play } from "lucide-react";
import type { Cell, ResultColumn, ScriptOutcome, ScriptStep, StepStatus } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RowsView } from "@/features/editor/RowsView";
import type { StepMark } from "@/features/editor/SqlEditor";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

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
  /** marks [from, to) of the executed text in the editor; false when it is not there anymore */
  onMarkStatement: (from: number, to: number, kind: StepMark) => boolean;
  /** runs [from, to) of the executed text alone */
  onRunStatement: (from: number, to: number) => void;
  /** the run's receipt around a result text: the script's in Execução, each statement's in its tab */
  receipt: (text: string) => ReactNode;
  muted: boolean;
  /** lets the editor switch results with Alt+PageDown/PageUp without leaving the text */
  cycleRef?: RefObject<((step: number) => void) | null>;
};

const STATUS: Record<StepStatus, string> = {
  done: "concluído",
  failed: "erro",
  cancelled: "cancelado",
  notRun: "não executado"
};

const RUN_TAB = "run";
const ROW_HEIGHT = 28;
// the SQL takes what the counts leave: "1000 de 4210 linhas" is the widest of them
const COLUMNS = "grid-cols-[2.5rem_minmax(0,1fr)_6.5rem_8.5rem_4.5rem]";

/** First line of a statement, short enough for a tab. */
function label(text: string, max: number): string {
  const line = text.split("\n").find(part => part.trim() !== "") ?? text;
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * The backend words a script failure "comando N de M: <driver>. <what ran before>": the
 * position is said in the headline already, and what ran before (committed or not) belongs
 * in it too, in our words, not at the end of the driver's English.
 */
export function splitFailure(message: string): { driver: string; before: string | null } {
  const match =
    /^comando \d+ de \d+: ([\s\S]*)\. ((?:Nada rodou|O comando anterior|Os \d+ comandos anteriores)[\s\S]*)$/.exec(
      message
    );
  return match ? { driver: match[1], before: match[2] } : { driver: message, before: null };
}

function lines(count: number): string {
  return `${count} ${count === 1 ? "linha" : "linhas"}`;
}

function rowsText(step: ScriptStep): string {
  const { result, rowCount } = step;
  if (!result) {
    return rowCount === null ? "" : lines(rowCount);
  }
  if (result.kind === "command") {
    return `${result.rowsAffected} ${result.rowsAffected === 1 ? "linha afetada" : "linhas afetadas"}`;
  }
  const shown = result.batch.rows.length;
  if (rowCount === null) {
    return `${shown}+ linhas`;
  }
  return rowCount > shown ? `${shown} de ${lines(rowCount)}` : lines(rowCount);
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
  onMarkStatement,
  onRunStatement,
  receipt,
  muted,
  cycleRef
}: ScriptResultsProps) {
  const { steps } = outcome;
  const total = steps.length;
  const tabs = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.result?.kind === "rows");
  const lastTab = tabs[tabs.length - 1];
  const failedAt = steps.findIndex(step => step.status === "failed" || step.status === "cancelled");
  // rows the script changed: a SET or a BEGIN changes none and is not called a write
  const affected = steps.reduce(
    (sum, step) => sum + (step.result?.kind === "command" ? step.result.rowsAffected : 0),
    0
  );
  // a script that changed rows opens on them, the part that went through the confirmation
  const [tab, setTab] = useState(() =>
    outcome.error || !lastTab || affected > 0 ? RUN_TAB : String(lastTab.index)
  );
  // the statement shown in the editor, and whether it was still there to mark
  const [picked, setPicked] = useState<{ index: number; marked: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const order = [RUN_TAB, ...tabs.map(({ index }) => String(index))];

  // a script that stopped shows where, in the editor too
  useEffect(() => {
    if (outcome.error && failedAt >= 0) {
      const [from, to] = steps[failedAt].span;
      setPicked({ index: failedAt, marked: onMarkStatement(from, to, "failed") });
    }
    // once per result: the component is keyed per run
  }, []);

  /** the panel that had focus unmounts with its tab: the focus follows to the new tab */
  function show(value: string, focus: boolean) {
    setTab(value);
    if (focus) {
      requestAnimationFrame(() =>
        listRef.current?.querySelector<HTMLElement>("[role='tab'][data-state='active']")?.focus()
      );
    }
  }

  function cycle(step: number, focus: boolean) {
    const at = order.indexOf(tab);
    show(order[(at + step + order.length) % order.length], focus);
  }

  useEffect(() => {
    if (cycleRef) {
      cycleRef.current = step => cycle(step, false);
      return () => {
        cycleRef.current = null;
      };
    }
  });

  function onKeyDown(event: KeyboardEvent) {
    if (!event.altKey || (event.key !== "PageDown" && event.key !== "PageUp")) {
      return;
    }
    event.preventDefault();
    cycle(event.key === "PageDown" ? 1 : -1, true);
  }

  function pick(index: number) {
    const [from, to] = steps[index].span;
    const failed = index === failedAt && !!outcome.error;
    setPicked({ index, marked: onMarkStatement(from, to, failed ? "failed" : "picked") });
    if (steps[index].result?.kind === "rows") {
      show(String(index), true);
    }
  }

  function runAlone(index: number) {
    const [from, to] = steps[index].span;
    onRunStatement(from, to);
  }

  /**
   * Only after the script stopped, from where it stopped or later: after a run that went
   * through, "the rest" would run again writes that already went to the database.
   */
  function canRunRest(index: number) {
    return !!outcome.error && failedAt >= 0 && index >= failedAt && index < total - 1;
  }

  /** after a fix, the way on: this statement and everything after it, not the ones that ran */
  function runRest(index: number) {
    onRunStatement(steps[index].span[0], steps[total - 1].span[1]);
  }

  const text = (step: ScriptStep) => sql.slice(step.span[0], step.span[1]);
  const writesText =
    affected > 0 ? ` · ${affected} ${affected === 1 ? "linha afetada" : "linhas afetadas"}` : "";
  const failure = outcome.error ? splitFailure(errorMessage(outcome.error)) : null;
  const scriptText = outcome.error
    ? `Parou no comando ${failedAt + 1} de ${total}${writesText} · ${outcome.durationMs} ms`
    : `${total} comandos${writesText} · ${outcome.durationMs} ms`;
  const pickedHasTab = picked !== null && steps[picked.index].result?.kind === "rows";

  return (
    <Tabs value={tab} onValueChange={setTab} onKeyDown={onKeyDown} className="flex h-full flex-col">
      <div ref={listRef} className="flex min-w-0 items-center gap-3 border-b bg-background px-3">
        <TabsList
          aria-label="Resultados do script"
          aria-keyshortcuts="Alt+PageDown Alt+PageUp"
          className="min-w-0 overflow-x-auto"
        >
          <TabsTrigger value={RUN_TAB} className="shrink-0">
            Execução
          </TabsTrigger>
          {tabs.map(({ step, index }) => (
            <TabsTrigger
              key={index}
              value={String(index)}
              title={text(step)}
              className="max-w-56 shrink-0 truncate"
            >
              {/* spaces outside the sr-only spans: name computation trims inside them */}
              <span className="sr-only">comando</span>{" "}
              <span className="tabular-nums">{index + 1}</span>{" "}
              <span className="sr-only">de {total}</span> ·{" "}
              {/* the statement is data: mono, like the list in Execução */}
              <span className="font-mono text-xs">{label(text(step), 40)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {/* the tabs come first: the hint gives way (the Legenda has it, and why numbers skip) */}
        <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground max-[767px]:hidden">
          <span className="min-[1100px]:hidden">Alt+PgDn/PgUp</span>
          <span className="hidden min-[1100px]:inline">Alt+PageDown/PageUp troca de resultado</span>
        </span>
      </div>
      <TabsContent value={RUN_TAB} className="min-h-0 flex-1">
        {/* in a short panel the error and the notice would leave the list no height: below
            the list's floor of four rows, the whole tab scrolls */}
        <div className="flex h-full flex-col overflow-y-auto">
          <div
            role="status"
            className={`@container flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted px-3 py-1 text-xs ${muted ? "text-muted-foreground" : ""}`}
          >
            {receipt(scriptText)}
          </div>
          {outcome.error && (
            // the same error block as a single statement's: the headline in our words, the
            // driver's own below as data
            <div
              role="alert"
              className="grid gap-1 border-b border-foreground bg-background px-3 py-2"
            >
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="legend text-[0.75rem] text-destructive">Erro</span>
                <span>
                  O script parou no comando {failedAt + 1} de {total}.
                  {failure?.before && ` ${failure.before}.`}
                </span>
              </p>
              <p className="font-mono text-[11px] break-words whitespace-pre-wrap">
                {failure?.driver}
              </p>
            </div>
          )}
          {picked && !pickedHasTab && (
            <StepNotice
              index={picked.index}
              total={total}
              marked={picked.marked}
              onRun={() => runAlone(picked.index)}
              onRunRest={canRunRest(picked.index) ? () => runRest(picked.index) : undefined}
            />
          )}
          <StepList steps={steps} text={text} picked={picked?.index ?? null} onPick={pick} />
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
        const isPicked = picked?.index === index;
        const rows = live
          ? `${live.rows.length}${live.hasMore ? "+" : ""} ${live.rows.length === 1 && !live.hasMore ? "linha retornada" : "linhas retornadas"}`
          : rowsText(step);
        // the export re-runs the script up to this statement, and refuses one that writes on the way
        const writesBefore = steps
          .slice(0, index + 1)
          .some(earlier => earlier.result?.kind === "command");
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
                truncated || isPicked ? (
                  <StepNotice
                    index={index}
                    total={total}
                    marked={isPicked ? picked.marked : null}
                    onRun={() => runAlone(index)}
                    onRunRest={canRunRest(index) ? () => runRest(index) : undefined}
                  />
                ) : null
              }
              exportStatement={isLast ? null : index}
              exportBlocked={
                writesBefore
                  ? `O export reexecuta os comandos 1 a ${index + 1}, e o script altera dados antes deste: rode este comando sozinho para exportar.`
                  : null
              }
              exportTitle={`Reexecuta os comandos 1 a ${index + 1} e grava as linhas deste`}
              receipt={receipt(
                `Comando ${index + 1} de ${total} · ${rows} · ${step.durationMs} ms`
              )}
              muted={muted}
            />
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

type StepNoticeProps = {
  index: number;
  total: number;
  /** whether the editor shows it; null when it was not picked */
  marked: boolean | null;
  onRun: () => void;
  /** absent on the last statement, where it would be the same as running it alone */
  onRunRest?: () => void;
};

/**
 * What a picked or cut-short statement has to say, and the ways on from it: run it alone, or
 * from it to the end (after a failure, without re-running what already went through).
 */
function StepNotice({ index, total, marked, onRun, onRunRest }: StepNoticeProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1 text-sm text-muted-foreground">
      {marked !== null && (
        <span>
          Comando {index + 1} de {total}
          {marked
            ? " marcado no editor."
            : ": o editor mudou desde a execução e não o mostra mais."}
        </span>
      )}
      <Button size="xs" variant="outline" onClick={onRun}>
        <Play /> Rodar só este comando
      </Button>
      {onRunRest && (
        <Button size="xs" variant="outline" onClick={onRunRest}>
          <Play /> Rodar daqui até o fim
        </Button>
      )}
    </div>
  );
}

type StepListProps = {
  steps: ScriptStep[];
  text: (step: ScriptStep) => string;
  picked: number | null;
  onPick: (index: number) => void;
};

/**
 * Every statement of the script, one 28px row each, under a ruled header; long scripts stay
 * virtualized. One Tab stop, arrows between rows, like the connection tree.
 */
function StepList({ steps, text, picked, onPick }: StepListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(picked ?? 0);
  const virtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // the ruled header sits in the same scroller (sticky), so the columns scroll sideways
    // together in a narrow window; the rows start below it and never hide under it
    paddingStart: ROW_HEIGHT,
    scrollPaddingStart: ROW_HEIGHT
  });
  const total = steps.length;
  const items = virtualizer.getVirtualItems();
  // scrolled away, the active row is not rendered: the first one shown keeps the Tab stop
  const stop = items.some(item => item.index === active) ? active : (items[0]?.index ?? 0);

  function onKeyDown(event: KeyboardEvent) {
    const next =
      event.key === "ArrowDown"
        ? Math.min(total - 1, stop + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, stop - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? total - 1
              : null;
    if (next === null) {
      return;
    }
    event.preventDefault();
    setActive(next);
    virtualizer.scrollToIndex(next);
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-step="${next}"]`)?.focus()
    );
  }

  return (
    <div className="flex min-h-36 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div
          aria-hidden
          className={`sticky top-0 z-10 grid ${COLUMNS} h-7 min-w-[30rem] items-center gap-2 border-b border-foreground bg-muted px-3 legend text-muted-foreground`}
        >
          <span>Nº</span>
          <span>Comando</span>
          <span>Status</span>
          <span className="text-right">Linhas</span>
          <span className="text-right">Tempo</span>
        </div>
        <ol
          aria-label="Comandos do script"
          onKeyDown={onKeyDown}
          className="relative min-w-[30rem]"
          style={{ height: virtualizer.getTotalSize() - ROW_HEIGHT }}
        >
          {items.map(item => {
            const step = steps[item.index];
            const stopped = step.status === "failed" || step.status === "cancelled";
            const isPicked = item.index === picked;
            return (
              <li
                key={item.key}
                className="absolute inset-x-0"
                style={{ top: item.start - ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <button
                  type="button"
                  data-step={item.index}
                  tabIndex={item.index === stop ? 0 : -1}
                  onClick={() => {
                    setActive(item.index);
                    onPick(item.index);
                  }}
                  aria-current={isPicked || undefined}
                  title={text(step)}
                  className={cn(
                    `grid h-full w-full ${COLUMNS} items-center gap-2 border-b px-3 text-left text-sm tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`,
                    isPicked &&
                      "bg-select/10 shadow-[inset_3px_0_0_var(--select)] hover:bg-select/15",
                    step.status === "notRun" && "text-muted-foreground"
                  )}
                >
                  {/* spaces outside the sr-only spans: name computation trims inside them */}
                  <span className="text-muted-foreground">
                    <span className="sr-only">comando</span> {item.index + 1}{" "}
                    <span className="sr-only">de {total},</span>
                  </span>
                  <span className="truncate font-mono text-xs">
                    {label(text(step), 200)}
                    <span className="sr-only">,</span>
                  </span>
                  {/* the word first, then a rule: red under where it stopped, as in the editor;
                      what never ran is just quieter. The textures keep their grid meanings */}
                  <span className="flex">
                    <span
                      className={cn(
                        stopped &&
                          "font-semibold text-destructive shadow-[inset_0_-2px_0_var(--destructive)]",
                        // a write that went through stays in ink: it changed the database
                        step.status !== "failed" &&
                          step.status !== "cancelled" &&
                          step.result?.kind !== "command" &&
                          "text-muted-foreground"
                      )}
                    >
                      {STATUS[step.status]}
                    </span>
                  </span>
                  <span className="text-right">
                    {rowsText(step) && <span className="sr-only">,</span>} {rowsText(step)}
                  </span>
                  <span className="text-right text-muted-foreground">
                    {step.status === "notRun" ? (
                      ""
                    ) : (
                      <>
                        <span className="sr-only">,</span> {step.durationMs} ms
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import type { ExplainPlan, PlanNode } from "@/bindings";

type PlanRow = { node: PlanNode; depth: number; selfCost: number | null };

type PlanViewProps = {
  plan: ExplainPlan;
  /** the receipt line above the plan, as over a result grid */
  header: ReactNode;
};

/**
 * The tree depth first, each node with its own cost: its cost minus its children's.
 * ponytail: a Postgres nested loop reports its inner side per loop, so the loop's own
 * cost reads high there; weigh by loops if that misleads.
 */
export function planRows(root: PlanNode): PlanRow[] {
  const rows: PlanRow[] = [];
  const visit = (node: PlanNode, depth: number) => {
    const below = node.children.reduce((sum, child) => sum + (child.cost ?? 0), 0);
    const selfCost = node.cost === null ? null : Math.max(0, node.cost - below);
    rows.push({ node, depth, selfCost });
    node.children.forEach(child => visit(child, depth + 1));
  };
  visit(root, 0);
  return rows;
}

/**
 * Index of the row with the highest own cost; null when there is nothing to compare: a single
 * node, or no costs at all (SQLite).
 */
export function hottest(rows: PlanRow[]): number | null {
  if (rows.filter(row => row.selfCost !== null).length < 2) {
    return null;
  }
  let best: number | null = null;
  rows.forEach((row, index) => {
    if (row.selfCost !== null && (best === null || row.selfCost > rows[best].selfCost!)) {
      best = index;
    }
  });
  return best;
}

const number = (value: number | null, digits: number) =>
  value === null ? "" : value.toFixed(digits);

/** The plan as an indented table: the engine's own labels, costs and estimated rows. */
export function PlanView({ plan, header }: PlanViewProps) {
  const rows = planRows(plan.root);
  const hot = hottest(rows);
  const hasCost = rows.some(row => row.node.cost !== null || row.node.rows !== null);
  const analyzed = rows.some(row => row.node.actualRows !== null);
  const cell = "px-3 py-1 text-right align-top font-mono tabular-nums whitespace-nowrap";
  const heading = "legend px-3 py-1 text-[0.75rem] font-normal whitespace-nowrap";

  return (
    <div className="flex h-full flex-col">
      <div className="@container flex items-center gap-2 border-b bg-muted px-3 py-1 text-xs">
        {header}
      </div>
      {/* the exact command that ran, ANALYZE included */}
      <p className="truncate border-b px-3 py-1 font-mono text-xs" title={plan.sql}>
        {plan.sql}
      </p>
      <p className="border-b px-3 py-1 text-xs text-muted-foreground">
        {hasCost
          ? "Custo e linhas são estimativas do planejador, nas unidades do banco. Mais caro: o maior custo próprio (o do nó menos o dos filhos)."
          : "O SQLite não estima custo nem linhas: o plano mostra só os passos."}
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Plano de execução</caption>
          <thead className="sticky top-0 bg-background">
            <tr className="border-b">
              <th scope="col" className={`${heading} text-left`}>
                Nó
              </th>
              {hasCost && (
                <>
                  <th scope="col" className={`${heading} text-right`}>
                    Custo
                  </th>
                  <th scope="col" className={`${heading} text-right`}>
                    Linhas estimadas
                  </th>
                </>
              )}
              {analyzed && (
                <>
                  <th scope="col" className={`${heading} text-right`}>
                    Linhas reais
                  </th>
                  <th scope="col" className={`${heading} text-right`}>
                    Tempo (ms)
                  </th>
                  <th scope="col" className={`${heading} text-right`}>
                    Loops
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node, depth, selfCost }, index) => {
              const isHot = index === hot;
              return (
                <tr key={index} className={`border-b ${isHot ? "bg-warning/10" : ""}`}>
                  <td className="py-1 pr-3" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
                    <span className="sr-only">Nível {depth + 1}: </span>
                    {depth > 0 && (
                      <span aria-hidden className="text-muted-foreground">
                        └{" "}
                      </span>
                    )}
                    <span className={isHot ? "font-semibold" : undefined}>{node.label}</span>
                    {isHot && " "}
                    {isHot && (
                      // a word, not only a tint: the mark survives without color
                      <span
                        className="legend ml-1 text-[0.75rem] text-warning"
                        title={`Custo próprio ${number(selfCost, 2)}`}
                      >
                        Mais caro
                      </span>
                    )}
                    {node.details.map(detail => (
                      <span
                        key={detail}
                        className="block font-mono text-xs break-all text-muted-foreground"
                      >
                        {detail}
                      </span>
                    ))}
                  </td>
                  {hasCost && (
                    <>
                      <td className={cell}>{number(node.cost, 2)}</td>
                      <td className={cell}>{number(node.rows, 0)}</td>
                    </>
                  )}
                  {analyzed && (
                    <>
                      <td className={cell}>{number(node.actualRows, 0)}</td>
                      <td className={cell}>{number(node.actualMs, 3)}</td>
                      <td className={cell}>{number(node.loops, 0)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Database, Eye, Table2 } from "lucide-react";
import type { ConnectionConfig, RedisDatabase, SchemaInfo } from "@/bindings";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EnvTag } from "@/features/connections/EnvTag";
import type { RedisTarget, TableTarget } from "@/features/tabs/store";
import { cn } from "@/lib/utils";

type QuickOpenProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: ConnectionConfig[];
  onOpenTable: (target: TableTarget) => void;
  onOpenRedis: (target: RedisTarget) => void;
};

type Item = {
  key: string;
  label: string;
  detail: string;
  /** lower-cased text every query word is looked up in */
  haystack: string;
  icon: typeof Table2;
  connection: ConnectionConfig;
  open: () => void;
};

/** a long list is noise: refine the query instead */
const MAX_RESULTS = 50;

/**
 * Ctrl+P: every table, view, collection and Redis database the sidebar has already
 * listed. Never connects by itself, so a closed prod connection stays closed.
 */
export function QuickOpen({
  open,
  onOpenChange,
  connections,
  onOpenTable,
  onOpenRedis
}: QuickOpenProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const items: Item[] = [];
  for (const connection of connections) {
    const schemas = queryClient.getQueryData<SchemaInfo[]>(["schemas", connection.id]) ?? [];
    for (const schema of schemas) {
      for (const relation of schema.relations) {
        const target = { connectionId: connection.id, schema: schema.name, table: relation.name };
        items.push({
          key: `${connection.id}/${schema.name}/${relation.name}`,
          label: relation.name,
          detail: `${connection.name} · ${schema.name}`,
          haystack: `${relation.name} ${schema.name} ${connection.name}`.toLowerCase(),
          icon: relation.kind === "table" ? Table2 : Eye,
          connection,
          open: () => onOpenTable(target)
        });
      }
    }
    const databases =
      queryClient.getQueryData<RedisDatabase[]>(["redisDatabases", connection.id]) ?? [];
    for (const database of databases) {
      const target = { connectionId: connection.id, db: database.index };
      items.push({
        key: `${connection.id}/db${database.index}`,
        label: `db${database.index}`,
        detail: connection.name,
        haystack: `db${database.index} ${connection.name}`.toLowerCase(),
        icon: Database,
        connection,
        open: () => onOpenRedis(target)
      });
    }
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  const results = items
    .filter(item => words.every(word => item.haystack.includes(word)))
    // names that start with what was typed come first; the sort is stable otherwise
    .sort(
      (a, b) =>
        Number(!a.label.toLowerCase().startsWith(first)) -
        Number(!b.label.toLowerCase().startsWith(first))
    )
    .slice(0, MAX_RESULTS);
  const active = Math.min(selected, results.length - 1);

  function close() {
    setQuery("");
    setSelected(0);
    onOpenChange(false);
  }

  function choose(item: Item | undefined) {
    if (item) {
      item.open();
      close();
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((active + step + results.length) % Math.max(1, results.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : close())}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-24 translate-y-0 gap-0 p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Abrir tabela, coleção ou database</DialogTitle>
        <Input
          role="combobox"
          aria-label="Buscar tabela, coleção ou database"
          aria-expanded
          aria-controls="quick-open-results"
          aria-activedescendant={results[active] ? `quick-open-${active}` : undefined}
          placeholder="Tabela, coleção ou database… (várias palavras filtram juntas)"
          className="h-10 border-0 border-b border-foreground"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul id="quick-open-results" role="listbox" className="max-h-80 overflow-auto py-1">
          {results.map((item, index) => {
            const Icon = item.icon;
            return (
              <li
                key={item.key}
                id={`quick-open-${index}`}
                role="option"
                aria-selected={index === active}
                onClick={() => choose(item)}
                onMouseMove={() => setSelected(index)}
                className={cn(
                  "flex h-8 cursor-default items-center gap-2 px-3 text-[13px]",
                  index === active && "bg-select text-select-foreground"
                )}
              >
                <Icon aria-hidden className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate font-semibold">{item.label}</span>
                <span className="min-w-0 truncate text-xs opacity-80">{item.detail}</span>
                <EnvTag environment={item.connection.environment} className="ml-auto" />
              </li>
            );
          })}
        </ul>
        {results.length === 0 && (
          <p className="px-3 pb-3 text-sm text-muted-foreground">
            {items.length === 0
              ? "Nada carregado ainda. Expanda uma conexão na lateral para que as tabelas dela apareçam aqui."
              : "Nenhum resultado. Só aparecem as conexões já expandidas na lateral."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

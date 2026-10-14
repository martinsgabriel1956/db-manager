import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { ConnectionConfig, RedisDatabase, SchemaInfo } from "@/bindings";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EngineCode, EnvTag } from "@/features/connections/EnvTag";
import {
  browseSections,
  paletteEntries,
  searchEntries,
  tabEntryId,
  type PaletteEntry,
  type PaletteTarget
} from "@/features/palette/search";
import { useFocusReturn } from "@/features/tabs/focus";
import { useTabs } from "@/features/tabs/store";
import { cn } from "@/lib/utils";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: ConnectionConfig[];
  /** the active tab's connection: its matches rank first, production's always last */
  activeConnectionId: string | null;
  /** typed in when it opens, e.g. "abrir" from "Abrir uma conexão" */
  initialQuery?: string;
  /** the caller moves focus to what the pick opened */
  onSelect: (target: PaletteTarget) => void;
};

type PaletteBodyProps = Omit<CommandPaletteProps, "open" | "onOpenChange">;

/** Ctrl+K: go to a table, collection or Redis database already listed, or run an app action. */
export function CommandPalette({
  open,
  onOpenChange,
  connections,
  activeConnectionId,
  initialQuery = "",
  onSelect
}: CommandPaletteProps) {
  // Esc gives focus back to where it was; a pick leaves it to whatever the pick opened
  const picked = useRef(false);
  const focusReturn = useFocusReturn(() => picked.current);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[12vh] translate-y-0 gap-0 p-0 sm:max-w-xl"
        onOpenAutoFocus={() => {
          picked.current = false;
          focusReturn.onOpenAutoFocus();
        }}
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
      >
        <DialogTitle className="sr-only">Ir para</DialogTitle>
        {/* mounted per opening: the query starts fresh and the listings are read again */}
        {open && (
          <PaletteBody
            connections={connections}
            activeConnectionId={activeConnectionId}
            initialQuery={initialQuery}
            onSelect={target => {
              picked.current = true;
              onOpenChange(false);
              onSelect(target);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({
  connections,
  activeConnectionId,
  initialQuery = "",
  onSelect
}: PaletteBodyProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const listId = useId();

  const all = useMemo(() => {
    const schemas = queryClient
      .getQueriesData<SchemaInfo[]>({ queryKey: ["schemas"] })
      .flatMap(([key, data]) => (data ? [{ connectionId: String(key[1]), schemas: data }] : []));
    const databases = queryClient
      .getQueriesData<RedisDatabase[]>({ queryKey: ["redisDatabases"] })
      .flatMap(([key, data]) => (data ? [{ connectionId: String(key[1]), databases: data }] : []));
    return {
      entries: paletteEntries(connections, schemas, databases),
      loaded: new Set([...schemas, ...databases].map(listing => listing.connectionId)).size
    };
  }, [queryClient, connections]);

  // where you were: the other open tabs, newest first, then the ones just closed
  const tabs = useTabs(state => state.tabs);
  const activeId = useTabs(state => state.activeId);
  const closed = useTabs(state => state.closed);
  const recent = [...tabs.filter(tab => tab.id !== activeId).reverse(), ...[...closed].reverse()]
    .map(tabEntryId)
    .filter(id => id !== null);

  // before a word is typed the palette is a short launcher by kind; after, one ranked list
  const sections =
    query.trim() === "" ? browseSections(all.entries, activeConnectionId, recent) : null;
  const results = sections
    ? sections.flatMap(section => section.entries)
    : searchEntries(all.entries, query, activeConnectionId);
  const current = Math.min(active, results.length - 1);
  const optionId = (index: number) => `${listId}-${index}`;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length > 0) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current + step + results.length) % results.length);
      }
    } else if (event.key === "Enter" && results[current]) {
      event.preventDefault();
      onSelect(results[current].target);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-foreground px-3">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        {/* no autoFocus: the dialog focuses it after noting where focus was, to give it back */}
        <input
          role="combobox"
          aria-label="Ir para tabela, coleção, banco Redis ou ação"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={results[current] ? optionId(current) : undefined}
          aria-autocomplete="list"
          placeholder="Ir para tabela, coleção, db do Redis ou ação…"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={handleKeyDown}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="shrink-0 legend text-muted-foreground">Esc</kbd>
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Resultados"
        className="max-h-[min(24rem,55vh)] overflow-y-auto py-1"
      >
        {sections
          ? sections.map(section => {
              const offset = results.indexOf(section.entries[0]);
              const headingId = `${listId}-${section.group}`;
              return (
                <li key={section.group} role="presentation">
                  <div
                    id={headingId}
                    className="flex items-baseline justify-between px-3 pt-2.5 pb-1"
                  >
                    <span className="legend text-muted-foreground">{section.group}</span>
                    {/* the rest is one word away: say how much is behind the cap */}
                    {section.total > section.entries.length && (
                      <span className="text-xs text-muted-foreground">
                        {section.entries.length} de {section.total} · digite para ver todas
                      </span>
                    )}
                  </div>
                  <ul role="group" aria-labelledby={headingId}>
                    {section.entries.map((entry, index) => (
                      <PaletteOption
                        key={entry.id}
                        id={optionId(offset + index)}
                        entry={entry}
                        selected={offset + index === current}
                        onHover={() => setActive(offset + index)}
                        onPick={() => onSelect(entry.target)}
                      />
                    ))}
                  </ul>
                </li>
              );
            })
          : results.map((entry, index) => (
              <PaletteOption
                key={entry.id}
                id={optionId(index)}
                entry={entry}
                selected={index === current}
                onHover={() => setActive(index)}
                onPick={() => onSelect(entry.target)}
              />
            ))}
      </ul>
      {results.length === 0 && (
        <p className="px-3 pb-3 text-sm text-muted-foreground">Nada encontrado para “{query}”.</p>
      )}
      {/* the palette never connects on its own: say what it can and cannot see */}
      <p className="border-t bg-muted px-3 py-2 text-xs text-muted-foreground">
        {all.loaded === 0
          ? "Nenhuma conexão aberta ainda: escolha “Abrir conexão” para conectar e listar as tabelas."
          : `Lista as tabelas das conexões abertas (${all.loaded} de ${connections.length}). Para incluir outra, escolha “Abrir conexão”.`}{" "}
        ↑↓ escolhe, Enter abre.
      </p>
    </>
  );
}

type PaletteOptionProps = {
  id: string;
  entry: PaletteEntry;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
};

function PaletteOption({ id, entry, selected, onHover, onPick }: PaletteOptionProps) {
  const { connection } = entry;
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      onMouseMove={onHover}
      // keep focus in the input: picking must not blur it first
      onMouseDown={event => event.preventDefault()}
      onClick={onPick}
      ref={element => {
        if (selected) {
          element?.scrollIntoView?.({ block: "nearest" });
        }
      }}
      className={cn(
        "flex h-8 cursor-default items-center gap-2.5 px-3 text-[13px]",
        // where you are: the same blue fill as the active table in the tree
        selected && "bg-select text-select-foreground"
      )}
    >
      {connection ? (
        <EngineCode engine={connection.engine} />
      ) : (
        <span aria-hidden className="size-6 shrink-0" />
      )}
      <span className="min-w-0 truncate font-semibold">{entry.label}</span>
      <span className={cn("shrink-0 text-xs", !selected && "text-muted-foreground")}>
        {entry.kind}
      </span>
      {connection && (
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          {/* a row named after its connection does not repeat the name */}
          {entry.label !== connection.name && (
            <span className="min-w-0 truncate text-xs">{connection.name}</span>
          )}
          <EnvTag environment={connection.environment} />
        </span>
      )}
    </li>
  );
}

import type { ConnectionConfig, RedisDatabase, SchemaInfo } from "@/bindings";
import { isSqlEngine } from "@/features/connections/options";
import type { DiagramTarget, RedisTarget, Tab, TableTarget } from "@/features/tabs/store";

/** What a palette row opens. */
export type PaletteTarget =
  | { kind: "table"; target: TableTarget }
  | { kind: "redis"; target: RedisTarget }
  | { kind: "editor"; connectionId: string }
  | { kind: "diagram"; target: DiagramTarget }
  /** connects and lists the connection in the tree: only ever on the user's pick */
  | { kind: "connect"; connectionId: string }
  | { kind: "editConnection"; connectionId: string }
  | { kind: "newConnection" }
  | { kind: "history" }
  | { kind: "legend" };

/** The headings of the palette before anything is typed, in this order. */
export const PALETTE_GROUPS = [
  "Recentes",
  "Tabelas e coleções",
  "Bancos Redis",
  "Conexões",
  "Ações"
] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export type PaletteEntry = {
  id: string;
  group: PaletteGroup;
  /** the searched and displayed name: `schema.table`, `db3`, or the action */
  label: string;
  /** what kind of thing it is, in words: "tabela", "coleção", "ação"… */
  kind: string;
  connection: ConnectionConfig | null;
  target: PaletteTarget;
};

export type LoadedSchemas = { connectionId: string; schemas: SchemaInfo[] }[];
export type LoadedDatabases = { connectionId: string; databases: RedisDatabase[] }[];

export const MAX_RESULTS = 50;

/**
 * Everything the palette can open. Tables come only from what is already loaded:
 * the palette never connects on its own (prod included); "Abrir conexão" does,
 * because the user picked it.
 */
export function paletteEntries(
  connections: ConnectionConfig[],
  schemas: LoadedSchemas,
  databases: LoadedDatabases
): PaletteEntry[] {
  const byId = new Map(connections.map(connection => [connection.id, connection]));
  const entries: PaletteEntry[] = [];

  for (const { connectionId, schemas: list } of schemas) {
    const connection = byId.get(connectionId);
    if (!connection) {
      continue;
    }
    for (const schema of list) {
      for (const relation of schema.relations) {
        const kind =
          connection.engine === "mongo" ? "coleção" : relation.kind === "table" ? "tabela" : "view";
        entries.push({
          id: `table/${connectionId}/${schema.name}/${relation.name}`,
          group: "Tabelas e coleções",
          label: `${schema.name}.${relation.name}`,
          kind,
          connection,
          target: {
            kind: "table",
            target: { connectionId, schema: schema.name, table: relation.name }
          }
        });
      }
    }
  }

  for (const { connectionId, databases: list } of databases) {
    const connection = byId.get(connectionId);
    if (!connection) {
      continue;
    }
    for (const database of list) {
      entries.push({
        id: `redis/${connectionId}/${database.index}`,
        group: "Bancos Redis",
        label: `db${database.index}`,
        kind: database.keys === 1 ? "1 chave" : `${database.keys} chaves`,
        connection,
        target: { kind: "redis", target: { connectionId, db: database.index } }
      });
    }
  }

  // diagrams of the SQL schemas already listed
  for (const { connectionId, schemas: list } of schemas) {
    const connection = byId.get(connectionId);
    if (!connection || !isSqlEngine(connection.engine)) {
      continue;
    }
    for (const schema of list) {
      entries.push({
        id: `diagram/${connectionId}/${schema.name}`,
        group: "Tabelas e coleções",
        label: schema.name,
        kind: "diagrama ER",
        connection,
        target: { kind: "diagram", target: { connectionId, schema: schema.name } }
      });
    }
  }

  const loaded = new Set([...schemas, ...databases].map(listing => listing.connectionId));
  for (const connection of connections.filter(c => !loaded.has(c.id))) {
    entries.push({
      id: `connect/${connection.id}`,
      group: "Conexões",
      // the name leads: six rows of "Abrir conexão" would make you read the right edge
      label: connection.name,
      kind: "abrir conexão",
      connection,
      target: { kind: "connect", connectionId: connection.id }
    });
  }

  for (const connection of connections.filter(c => isSqlEngine(c.engine))) {
    entries.push({
      id: `editor/${connection.id}`,
      group: "Ações",
      label: "Nova query SQL",
      kind: "ação",
      connection,
      target: { kind: "editor", connectionId: connection.id }
    });
  }

  for (const connection of connections) {
    entries.push({
      id: `edit/${connection.id}`,
      group: "Conexões",
      label: connection.name,
      kind: "editar conexão",
      connection,
      target: { kind: "editConnection", connectionId: connection.id }
    });
  }

  entries.push(
    {
      id: "new-connection",
      group: "Ações",
      label: "Nova conexão",
      kind: "ação",
      connection: null,
      target: { kind: "newConnection" }
    },
    {
      id: "history",
      group: "Ações",
      label: "Histórico",
      kind: "ação",
      connection: null,
      target: { kind: "history" }
    },
    {
      id: "legend",
      group: "Ações",
      label: "Legenda e atalhos",
      kind: "ação",
      connection: null,
      target: { kind: "legend" }
    }
  );
  return entries;
}

/** Normalized for matching: lower case, accents dropped ("Histórico" matches "historico"). */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Every letter of `word` in `text`, in order: "usr" finds "users". */
function isSubsequence(word: string, text: string): boolean {
  let found = 0;
  for (const char of text) {
    if (char === word[found]) {
      found++;
    }
  }
  return found === word.length;
}

/**
 * Every word of the query must appear in the name or the connection name; a word that
 * does not may still match the name with letters skipped ("usr" → users), ranked after
 * every exact match. Names that start with the last word typed come first; then the
 * connection you are working in, then the rest, production last, even when it is the one
 * you are in: with two `users`, Enter on the first match never lands in production by
 * accident. The order is otherwise kept.
 */
export function searchEntries(
  entries: PaletteEntry[],
  query: string,
  activeConnectionId: string | null = null
): PaletteEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const last = words.at(-1) ?? "";
  const matches = entries.flatMap((entry, index) => {
    const haystack = fold(`${entry.label} ${entry.connection?.name ?? ""} ${entry.kind}`);
    const name = fold(entry.label);
    if (words.every(word => haystack.includes(word))) {
      return [{ entry, index, loose: false }];
    }
    if (words.every(word => haystack.includes(word) || isSubsequence(word, name))) {
      return [{ entry, index, loose: true }];
    }
    return [];
  });
  const rank = ({ entry, loose }: (typeof matches)[number]) => {
    if (loose) {
      return 2;
    }
    const name = fold(entry.label.split(".").pop() ?? entry.label);
    return name.startsWith(last) ? 0 : 1;
  };
  const place = ({ connection }: PaletteEntry) =>
    connection?.environment === "prod" ? 2 : connection?.id === activeConnectionId ? 0 : 1;
  return matches
    .sort((a, b) => rank(a) - rank(b) || place(a.entry) - place(b.entry) || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(({ entry }) => entry);
}

/** The palette row a tab reopens, by the same id `paletteEntries` gives it. */
export function tabEntryId(tab: Tab): string | null {
  switch (tab.kind) {
    case "table":
      return `table/${tab.connectionId}/${tab.schema}/${tab.table}`;
    case "redis":
      return `redis/${tab.connectionId}/${tab.db}`;
    case "diagram":
      return `diagram/${tab.connectionId}/${tab.schema}`;
    default:
      return null;
  }
}

/** Rows per heading before anything is typed: the rest is one word away. */
export const GROUP_LIMIT = 5;

export type PaletteSection = { group: PaletteGroup; entries: PaletteEntry[]; total: number };

/**
 * The palette before a query: where you were first (the `recent` entry ids, most recent
 * first, kept in that order), then one short section per kind, ranked like a search (the
 * connection you are in first, production last). Per-connection repeats wait for a word:
 * "Nova query SQL" shows only for the active connection, and "editar conexão" not at all.
 */
export function browseSections(
  entries: PaletteEntry[],
  activeConnectionId: string | null = null,
  recent: string[] = []
): PaletteSection[] {
  const recentEntries = recent
    .map(id => entries.find(entry => entry.id === id))
    .filter(entry => entry !== undefined)
    .slice(0, GROUP_LIMIT);
  const shown = entries.filter(
    entry =>
      !recentEntries.includes(entry) &&
      (entry.target.kind === "editor"
        ? entry.target.connectionId === activeConnectionId
        : entry.target.kind !== "editConnection")
  );
  return PALETTE_GROUPS.flatMap((group): PaletteSection[] => {
    if (group === "Recentes") {
      return recentEntries.length === 0
        ? []
        : [{ group, entries: recentEntries, total: recentEntries.length }];
    }
    const members = shown.filter(entry => entry.group === group);
    // ranked per heading: a long table list never pushes the actions past the result cap
    const inGroup = searchEntries(members, "", activeConnectionId);
    // production ranks last but is never cut from the connections: it is listed, not hidden
    const kept =
      group === "Conexões"
        ? [
            ...inGroup.slice(0, GROUP_LIMIT),
            ...inGroup.slice(GROUP_LIMIT).filter(entry => entry.connection?.environment === "prod")
          ]
        : inGroup.slice(0, GROUP_LIMIT);
    return inGroup.length === 0 ? [] : [{ group, entries: kept, total: members.length }];
  });
}

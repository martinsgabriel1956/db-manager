import { expect, test } from "vitest";
import {
  browseSections,
  GROUP_LIMIT,
  paletteEntries,
  searchEntries,
  MAX_RESULTS,
  type PaletteEntry
} from "@/features/palette/search";
import { devMongo, devPostgres, localRedis, prodPostgres, schemas } from "@/test/fakeBackend";

const connections = [prodPostgres, devPostgres, devMongo, localRedis];

function entries() {
  return paletteEntries(
    connections,
    [
      { connectionId: prodPostgres.id, schemas },
      {
        connectionId: devMongo.id,
        schemas: [{ name: "shop", relations: [{ name: "orders", kind: "table" }] }]
      },
      // a listing whose connection was deleted is ignored
      { connectionId: "gone", schemas }
    ],
    [
      {
        connectionId: localRedis.id,
        databases: [
          { index: 0, keys: 4 },
          { index: 1, keys: 1 }
        ]
      },
      { connectionId: "gone", databases: [{ index: 0, keys: 1 }] }
    ]
  );
}

function labels(list: PaletteEntry[]) {
  return list.map(entry => `${entry.label} (${entry.connection?.name ?? "-"})`);
}

test("only loaded listings become entries, plus the SQL editors and app actions", () => {
  const all = entries();
  expect(all.find(entry => entry.label === "public.users")?.kind).toBe("tabela");
  expect(all.find(entry => entry.label === "public.active_users")?.kind).toBe("view");
  expect(all.find(entry => entry.label === "shop.orders")?.kind).toBe("coleção");
  expect(all.find(entry => entry.label === "db1")?.kind).toBe("1 chave");
  expect(all.find(entry => entry.label === "db0")?.kind).toBe("4 chaves");
  // the dev Postgres was never expanded: no tables, but its editor is offered
  expect(
    all.some(entry => entry.connection?.id === devPostgres.id && entry.target.kind === "table")
  ).toBe(false);
  expect(
    all.filter(entry => entry.target.kind === "editor").map(entry => entry.connection?.id)
  ).toEqual([prodPostgres.id, devPostgres.id]);
  expect(all.slice(-3).map(entry => entry.label)).toEqual([
    "Nova conexão",
    "Histórico",
    "Legenda e atalhos"
  ]);
  expect(all.some(entry => entry.id.includes("gone"))).toBe(false);
});

test("every word must match the name, the connection or the kind, accents ignored", () => {
  expect(labels(searchEntries(entries(), "users prod"))).toEqual([
    "public.users (Postgres prod)",
    "public.active_users (Postgres prod)"
  ]);
  expect(labels(searchEntries(entries(), "historico"))).toEqual(["Histórico (-)"]);
  expect(labels(searchEntries(entries(), "colecao"))).toEqual(["shop.orders (Mongo dev)"]);
  expect(searchEntries(entries(), "nada disso")).toEqual([]);
});

test("names starting with the last word come first", () => {
  expect(labels(searchEntries(entries(), "act")).slice(0, 1)).toEqual([
    "public.active_users (Postgres prod)"
  ]);
  expect(labels(searchEntries(entries(), "u"))[0]).toBe("public.users (Postgres prod)");
});

test("the same table in prod and dev: the active connection first, production last", () => {
  const both = paletteEntries(
    connections,
    [
      { connectionId: prodPostgres.id, schemas },
      { connectionId: devPostgres.id, schemas }
    ],
    []
  );
  const tables = (active: string | null) =>
    labels(searchEntries(both, "users", active).filter(entry => entry.kind === "tabela"));

  expect(tables(null)).toEqual(["public.users (Postgres dev)", "public.users (Postgres prod)"]);
  // working in prod already, Enter still does not land in prod: getting there takes a step
  expect(tables(prodPostgres.id)).toEqual([
    "public.users (Postgres dev)",
    "public.users (Postgres prod)"
  ]);
});

test("an empty query lists everything, capped", () => {
  const many = Array.from({ length: MAX_RESULTS + 10 }, (_, index) => ({
    ...entries()[0],
    id: `x${index}`
  }));
  expect(searchEntries(many, "  ")).toHaveLength(MAX_RESULTS);
  expect(searchEntries(many, "users")).toHaveLength(MAX_RESULTS);
});

test("connections become explicit actions: open the closed ones, edit any, diagram the listed SQL schemas", () => {
  const all = entries();
  const of = (kind: string) =>
    all.filter(entry => entry.target.kind === kind).map(entry => entry.connection?.name ?? "-");
  // prod, Mongo and Redis are listed already; only the dev Postgres can still be opened
  expect(of("connect")).toEqual(["Postgres dev"]);
  expect(of("editConnection")).toEqual(["Postgres prod", "Postgres dev", "Mongo dev", "Cache"]);
  // MongoDB has no foreign keys: only the prod Postgres schemas get a diagram
  expect(all.filter(entry => entry.target.kind === "diagram").map(entry => entry.label)).toEqual([
    "public",
    "audit"
  ]);
  expect(labels(searchEntries(all, "abrir"))).toEqual(["Postgres dev (Postgres dev)"]);
  expect(all.find(entry => entry.target.kind === "connect")?.kind).toBe("abrir conexão");
});

test("before a query, the palette shows short sections by kind without per-connection repeats", () => {
  const sections = browseSections(entries(), devPostgres.id);
  expect(sections.map(section => section.group)).toEqual([
    "Tabelas e coleções",
    "Bancos Redis",
    "Conexões",
    "Ações"
  ]);
  const actions = sections.find(section => section.group === "Ações")!.entries;
  // one "Nova query SQL", for the connection you are in
  expect(labels(actions)).toEqual([
    "Nova query SQL (Postgres dev)",
    "Nova conexão (-)",
    "Histórico (-)",
    "Legenda e atalhos (-)"
  ]);
  const all = sections.flatMap(section => section.entries);
  expect(all.some(entry => entry.kind === "editar conexão")).toBe(false);
  expect(sections.every(section => section.entries.length <= GROUP_LIMIT)).toBe(true);
  // the cap says what it hides
  const tables = sections[0];
  expect(tables.total).toBeGreaterThanOrEqual(tables.entries.length);
});

test("letters typed in order find a name, after every exact match", () => {
  expect(labels(searchEntries(entries(), "usr"))[0]).toBe("public.users (Postgres prod)");
  // an exact match of the same word still ranks first
  const results = labels(searchEntries(entries(), "ord"));
  expect(results[0]).toBe("shop.orders (Mongo dev)");
});

test("before a query, where you were comes first and leaves its own group", () => {
  const all = entries();
  const sections = browseSections(all, null, [
    "table/mongo-1/shop/orders",
    "table/gone/x/y",
    "redis/redis-1/1"
  ]);
  expect(sections[0].group).toBe("Recentes");
  expect(labels(sections[0].entries)).toEqual(["shop.orders (Mongo dev)", "db1 (Cache)"]);
  const tables = sections.find(section => section.group === "Tabelas e coleções")!;
  expect(labels(tables.entries)).not.toContain("shop.orders (Mongo dev)");
});

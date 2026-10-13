import { beforeEach, expect, test } from "vitest";
import { INITIAL_TABS, useTabs, type EditorTab } from "@/features/tabs/store";

const users = { connectionId: "pg", schema: "public", table: "users" };

function state() {
  return useTabs.getState();
}

beforeEach(() => {
  useTabs.setState(INITIAL_TABS);
});

test("opening the same table twice focuses the existing tab", () => {
  state().openTable(users);
  state().openTable({ ...users, table: "orders" });
  state().openTable(users);

  expect(state().tabs).toHaveLength(2);
  expect(state().activeId).toBe(state().tabs[0].id);
});

test("a Redis database opens once per connection", () => {
  state().openRedis({ connectionId: "cache", db: 0 });
  state().openRedis({ connectionId: "cache", db: 3 });
  state().openRedis({ connectionId: "other", db: 0 });
  state().openRedis({ connectionId: "cache", db: 0 });

  expect(state().tabs).toHaveLength(3);
  expect(state().activeId).toBe(state().tabs[0].id);
});

test("a schema diagram opens once", () => {
  state().openDiagram({ connectionId: "pg", schema: "public" });
  state().openDiagram({ connectionId: "pg", schema: "app" });
  state().openDiagram({ connectionId: "pg", schema: "public" });

  expect(state().tabs).toHaveLength(2);
  expect(state().activeId).toBe(state().tabs[0].id);
});

test("editors are numbered per connection", () => {
  state().openEditor("pg");
  state().openEditor("pg", "SELECT 1");
  state().openEditor("other");

  const titles = state().tabs.map(tab => (tab as EditorTab).title);
  expect(titles).toEqual(["SQL 1", "SQL 2", "SQL 1"]);
  expect((state().tabs[1] as EditorTab).sql).toBe("SELECT 1");
  expect(state().activeId).toBe(state().tabs[2].id);
});

test("history is a single tab", () => {
  state().openHistory();
  state().openEditor("pg");
  state().openHistory();

  expect(state().tabs.filter(tab => tab.kind === "history")).toHaveLength(1);
  expect(state().activeId).toBe("history");
});

test("closing the active tab focuses its left neighbour", () => {
  state().openEditor("pg");
  state().openEditor("pg");
  state().openEditor("pg");
  const [first, second, third] = state().tabs;

  state().close(third.id);
  expect(state().activeId).toBe(second.id);

  state().activate(first.id);
  state().close(second.id);
  expect(state().activeId).toBe(first.id);

  state().close(first.id);
  expect(state().tabs).toEqual([]);
  expect(state().activeId).toBeNull();

  state().close("missing");
  expect(state().tabs).toEqual([]);
});

test("tabs of removed connections are dropped", () => {
  state().openTable(users);
  state().openHistory();
  state().openEditor("gone");

  state().keepConnections(["pg"]);

  expect(state().tabs.map(tab => tab.kind)).toEqual(["table", "history"]);
  expect(state().activeId).toBe(state().tabs[0].id);
  const before = state().tabs;
  state().keepConnections(["pg"]);
  expect(state().tabs).toBe(before);
});

test("editor text is kept per tab", () => {
  state().openEditor("pg");
  state().openTable(users);
  const editor = state().tabs[0];

  state().setSql(editor.id, "SELECT now()");

  expect((state().tabs[0] as EditorTab).sql).toBe("SELECT now()");
});

test("closing several tabs focuses the nearest open tab, left first", () => {
  state().openEditor("pg");
  state().openEditor("pg");
  state().openEditor("pg");
  state().openEditor("pg");
  const [first, second, third, fourth] = state().tabs;

  state().activate(third.id);
  state().closeTabs([second.id, third.id]);
  expect(state().tabs.map(tab => tab.id)).toEqual([first.id, fourth.id]);
  expect(state().activeId).toBe(first.id);

  // the active tab stays put when others close around it
  state().closeTabs([fourth.id]);
  expect(state().activeId).toBe(first.id);

  state().closeTabs([first.id]);
  expect(state().activeId).toBeNull();
});

test("closed tabs reopen most recent first, editor text included", () => {
  state().openEditor("pg", "UPDATE users SET name = 'x'");
  state().openTable(users);
  state().closeTabs(state().tabs.map(tab => tab.id));
  expect(state().tabs).toHaveLength(0);

  expect(state().reopenClosed()).toBe(true);
  expect(state().tabs.map(tab => tab.kind)).toEqual(["table"]);
  expect(state().reopenClosed()).toBe(true);
  expect((state().tabs[1] as EditorTab).sql).toBe("UPDATE users SET name = 'x'");
  expect(state().activeId).toBe(state().tabs[1].id);
  expect(state().reopenClosed()).toBe(false);
});

test("reopening a table that is open again goes to it instead of doubling it", () => {
  state().openTable(users);
  state().close(state().tabs[0].id);
  state().openTable(users);

  state().reopenClosed();
  expect(state().tabs).toHaveLength(1);
  expect(state().closed).toHaveLength(0);
});

test("closed tabs of a deleted connection cannot come back", () => {
  state().openTable(users);
  state().openEditor("other");
  state().closeTabs(state().tabs.map(tab => tab.id));
  state().keepConnections(["other"]);

  expect(state().closed.map(tab => tab.kind)).toEqual(["editor"]);
});

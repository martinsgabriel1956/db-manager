import { expect, test } from "vitest";
import type { KeyEntry, RedisValue } from "@/bindings";
import {
  entriesOf,
  isEditable,
  newKeyEdits,
  removeEdit,
  saveEdits,
  type Entry
} from "@/features/redis/entries";
import { buildKeyTree, uniqueKeys, type KeyNode } from "@/features/redis/keyTree";

function key(name: string, kind = "string"): KeyEntry {
  return { name, kind };
}

/** "folder(count)" / "key" outline, depth-first */
function outline(nodes: KeyNode[]): string[] {
  return nodes.flatMap(node =>
    node.kind === "folder"
      ? [`${node.name}/(${node.count})`, ...outline(node.children).map(line => `  ${line}`)]
      : [node.name]
  );
}

test("keys group by separator, folders first", () => {
  const tree = buildKeyTree(
    [key("user:2:name"), key("user"), key("queue"), key("user:1"), key("user:2:age"), key("a::b")],
    ":"
  );

  expect(outline(tree)).toEqual([
    "a/(1)",
    "  /(1)",
    "    b",
    "user/(3)",
    "  2/(2)",
    "    age",
    "    name",
    "  1",
    "queue",
    "user"
  ]);
  const user = tree.find(node => node.kind === "folder" && node.name === "user");
  expect(user?.kind === "folder" && user.id).toBe("user:");
});

test("a multi-character separator works and SCAN duplicates are dropped", () => {
  const keys = uniqueKeys([[key("a | b"), key("c")], [key("a | b", "hash")]]);
  expect(keys).toEqual([key("a | b", "hash"), key("c")]);
  expect(outline(buildKeyTree(keys, " | "))).toEqual(["a/(1)", "  b", "c"]);
});

const hash: RedisValue = {
  kind: "hash",
  entries: [
    { field: { text: "name", binary: false }, value: { text: "Ana", binary: false } },
    { field: { text: "\\xff", binary: true }, value: { text: "x", binary: false } }
  ]
};

test("collections become entries; binary ones are not editable", () => {
  if (hash.kind !== "hash") {
    throw new Error("hash fixture");
  }
  const [name, binary] = entriesOf(hash);
  expect(name).toMatchObject({ id: "name", index: 0, second: { text: "Ana" } });
  expect(isEditable(name)).toBe(true);
  expect(isEditable(binary)).toBe(false);

  const zset = entriesOf({
    kind: "zset",
    entries: [{ member: { text: "ana", binary: false }, score: "1.5" }]
  });
  expect(zset[0].second).toEqual({ text: "1.5", binary: false });
  const list = entriesOf({ kind: "list", items: [{ text: "a", binary: false }] });
  expect(list[0]).toMatchObject({ id: "0", second: null });
});

function entry(first: string, index = 0): Entry {
  return { id: first, index, first: { text: first, binary: false }, second: null };
}

test("saving adds the new element before removing a renamed one", () => {
  expect(saveEdits("hash", entry("name"), { first: "name", second: "Bia" })).toEqual([
    { op: "hashSet", field: "name", value: "Bia" }
  ]);
  expect(saveEdits("hash", entry("name"), { first: "full", second: "Bia" })).toEqual([
    { op: "hashSet", field: "full", value: "Bia" },
    { op: "hashDelete", field: "name" }
  ]);
  expect(saveEdits("zset", entry("ana"), { first: "bia", second: "2" })).toEqual([
    { op: "zsetAdd", member: "bia", score: "2" },
    { op: "zsetRemove", member: "ana" }
  ]);
  expect(saveEdits("set", entry("red"), { first: "blue", second: "" })).toEqual([
    { op: "setAdd", member: "blue" },
    { op: "setRemove", member: "red" }
  ]);
  expect(saveEdits("set", null, { first: "red", second: "" })).toEqual([
    { op: "setAdd", member: "red" }
  ]);
  expect(saveEdits("list", entry("a", 4), { first: "b", second: "" })).toEqual([
    { op: "listSet", index: 4, value: "b" }
  ]);
  expect(saveEdits("list", null, { first: "b", second: "" })).toEqual([
    { op: "listPush", value: "b" }
  ]);
});

test("removing and creating map to one command each", () => {
  expect(removeEdit("hash", entry("f"))).toEqual({ op: "hashDelete", field: "f" });
  expect(removeEdit("zset", entry("m"))).toEqual({ op: "zsetRemove", member: "m" });
  expect(removeEdit("set", entry("m"))).toEqual({ op: "setRemove", member: "m" });
  expect(removeEdit("list", entry("v"))).toEqual({ op: "listRemove", value: "v" });

  expect(newKeyEdits("string", { first: "v", second: "" }, null)).toEqual([
    { op: "setString", value: "v" }
  ]);
  expect(newKeyEdits("zset", { first: "m", second: "1" }, 60)).toEqual([
    { op: "zsetAdd", member: "m", score: "1" },
    { op: "expire", ttlSecs: 60 }
  ]);
});

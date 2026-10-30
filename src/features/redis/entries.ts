import type { KeyEdit, RedisText, RedisValue } from "@/bindings";

export type CollectionKind = "hash" | "list" | "set" | "zset";

/**
 * One element of a collection. `first` is the field (hash), item (list) or member
 * (set, zset); `second` is the hash value or the zset score.
 */
export type Entry = { id: string; index: number; first: RedisText; second: RedisText | null };

export type EntryDraft = { first: string; second: string };

export const COLUMN_LABELS: Record<CollectionKind, [string, string | null]> = {
  hash: ["Campo", "Valor"],
  list: ["Valor", null],
  set: ["Membro", null],
  zset: ["Membro", "Score"]
};

export function isCollection(
  value: RedisValue
): value is Extract<RedisValue, { kind: CollectionKind }> {
  return ["hash", "list", "set", "zset"].includes(value.kind);
}

function text(value: string): RedisText {
  return { text: value, binary: false };
}

export function entriesOf(value: Extract<RedisValue, { kind: CollectionKind }>): Entry[] {
  switch (value.kind) {
    case "hash":
      return value.entries.map((entry, index) => ({
        id: entry.field.text,
        index,
        first: entry.field,
        second: entry.value
      }));
    case "list":
      // the position is the item's identity (LSET addresses it by index)
      return value.items.map((item, index) => ({
        id: String(index),
        index,
        first: item,
        second: null
      }));
    case "set":
      return value.members.map((member, index) => ({
        id: member.text,
        index,
        first: member,
        second: null
      }));
    case "zset":
      return value.entries.map((entry, index) => ({
        id: entry.member.text,
        index,
        first: entry.member,
        second: text(entry.score)
      }));
  }
}

/** Binary parts are shown escaped and cannot be sent back. */
export function isEditable(entry: Entry): boolean {
  return !entry.first.binary && !entry.second?.binary;
}

/**
 * Edits that save `draft` over `original` (null = a new element). Renaming a field
 * or member adds the new one before removing the old: removing first could empty
 * the collection, and Redis drops an empty key together with its TTL.
 */
export function saveEdits(
  kind: CollectionKind,
  original: Entry | null,
  draft: EntryDraft
): KeyEdit[] {
  const renamed = original !== null && original.first.text !== draft.first;
  switch (kind) {
    case "hash": {
      const set: KeyEdit = { op: "hashSet", field: draft.first, value: draft.second };
      return renamed ? [set, { op: "hashDelete", field: original.first.text }] : [set];
    }
    case "zset": {
      const add: KeyEdit = { op: "zsetAdd", member: draft.first, score: draft.second };
      return renamed ? [add, { op: "zsetRemove", member: original.first.text }] : [add];
    }
    case "set": {
      const add: KeyEdit = { op: "setAdd", member: draft.first };
      return renamed ? [add, { op: "setRemove", member: original.first.text }] : [add];
    }
    case "list":
      return original === null
        ? [{ op: "listPush", value: draft.first }]
        : [{ op: "listSet", index: original.index, value: draft.first }];
  }
}

export function removeEdit(kind: CollectionKind, entry: Entry): KeyEdit {
  switch (kind) {
    case "hash":
      return { op: "hashDelete", field: entry.first.text };
    case "zset":
      return { op: "zsetRemove", member: entry.first.text };
    case "set":
      return { op: "setRemove", member: entry.first.text };
    case "list":
      return { op: "listRemove", value: entry.first.text };
  }
}

/** The command `removeEdit` runs, as the backend sends it (redis.rs), for the delete strip. */
export function removeCommand(kind: CollectionKind, key: string, entry: Entry): string {
  const member = entry.first.text;
  switch (kind) {
    case "hash":
      return `HDEL ${key} ${member}`;
    case "zset":
      return `ZREM ${key} ${member}`;
    case "set":
      return `SREM ${key} ${member}`;
    case "list":
      return `LREM ${key} 1 ${member}`;
  }
}

export type NewKeyKind = "string" | CollectionKind;

/** The edits that create a key with its first value (and optional TTL). */
export function newKeyEdits(
  kind: NewKeyKind,
  draft: EntryDraft,
  ttlSecs: number | null
): KeyEdit[] {
  const value: KeyEdit[] =
    kind === "string" ? [{ op: "setString", value: draft.first }] : saveEdits(kind, null, draft);
  return ttlSecs === null ? value : [...value, { op: "expire", ttlSecs }];
}

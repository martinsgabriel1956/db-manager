import type { KeyEntry } from "@/bindings";

export type KeyFolder = {
  kind: "folder";
  /** the prefix, separator included ("user:"); unique among folders */
  id: string;
  name: string;
  /** keys anywhere below */
  count: number;
  children: KeyNode[];
};

export type KeyLeaf = { kind: "key"; name: string; entry: KeyEntry };

export type KeyNode = KeyFolder | KeyLeaf;

type Draft = { folders: Map<string, Draft>; keys: KeyEntry[]; count: number };

function emptyDraft(): Draft {
  return { folders: new Map(), keys: [], count: 0 };
}

/**
 * Groups keys by separator: "user:1:name" sits in user ▸ 1. A name can be both a
 * key and a folder ("user" and "user:1"). Folders come first, then keys, by name.
 */
export function buildKeyTree(keys: KeyEntry[], separator: string): KeyNode[] {
  const root = emptyDraft();
  for (const entry of keys) {
    const parts = entry.name.split(separator);
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let child = folder.folders.get(part);
      if (!child) {
        child = emptyDraft();
        folder.folders.set(part, child);
      }
      child.count += 1;
      folder = child;
    }
    folder.keys.push(entry);
  }
  return toNodes(root, "", separator);
}

function toNodes(draft: Draft, prefix: string, separator: string): KeyNode[] {
  const folders: KeyNode[] = [...draft.folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, child]) => {
      const id = `${prefix}${name}${separator}`;
      return {
        kind: "folder",
        id,
        name,
        count: child.count,
        children: toNodes(child, id, separator)
      };
    });
  const leaves: KeyNode[] = [...draft.keys]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => ({ kind: "key", name: entry.name.slice(prefix.length), entry }));
  return [...folders, ...leaves];
}

/** SCAN may return a key more than once across pages. */
export function uniqueKeys(pages: KeyEntry[][]): KeyEntry[] {
  const byName = new Map<string, KeyEntry>();
  for (const key of pages.flat()) {
    byName.set(key.name, key);
  }
  return [...byName.values()];
}

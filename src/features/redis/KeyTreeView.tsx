import { useState } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { KeyNode } from "@/features/redis/keyTree";
import { cn } from "@/lib/utils";

type KeyTreeViewProps = {
  nodes: KeyNode[];
  selected: string | null;
  onSelect: (key: string) => void;
};

const KIND_STYLE: Record<string, string> = {
  string: "text-emerald-700 dark:text-emerald-300",
  hash: "text-sky-700 dark:text-sky-300",
  list: "text-amber-700 dark:text-amber-300",
  set: "text-violet-700 dark:text-violet-300",
  zset: "text-rose-700 dark:text-rose-300",
  stream: "text-teal-700 dark:text-teal-300"
};

export function KeyTreeView({ nodes, selected, onSelect }: KeyTreeViewProps) {
  return (
    <ul role="tree" aria-label="Chaves" className="grid text-sm">
      <TreeLevel nodes={nodes} selected={selected} onSelect={onSelect} />
    </ul>
  );
}

function TreeLevel({ nodes, selected, onSelect }: KeyTreeViewProps) {
  return nodes.map(node =>
    node.kind === "folder" ? (
      <FolderNode key={`folder:${node.id}`} node={node} selected={selected} onSelect={onSelect} />
    ) : (
      <li
        key={`key:${node.entry.name}`}
        role="treeitem"
        aria-selected={node.entry.name === selected}
      >
        <button
          type="button"
          title={node.entry.name}
          onClick={() => onSelect(node.entry.name)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted",
            node.entry.name === selected && "bg-muted font-medium"
          )}
        >
          <span
            className={cn(
              "w-10 shrink-0 font-mono text-[10px] uppercase",
              KIND_STYLE[node.entry.kind] ?? "text-muted-foreground"
            )}
          >
            {node.entry.kind}
          </span>
          <span className="truncate font-mono text-xs">{node.name || "(vazio)"}</span>
        </button>
      </li>
    )
  );
}

function FolderNode({
  node,
  selected,
  onSelect
}: Omit<KeyTreeViewProps, "nodes"> & { node: Extract<KeyNode, { kind: "folder" }> }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li role="treeitem" aria-expanded={open} aria-selected={false}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-muted"
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs">{node.name || "(vazio)"}</span>
        <span className="ml-auto text-xs text-muted-foreground">{node.count}</span>
      </button>
      {open && (
        <ul role="group" className="ml-3 grid border-l pl-1">
          <TreeLevel nodes={node.children} selected={selected} onSelect={onSelect} />
        </ul>
      )}
    </li>
  );
}

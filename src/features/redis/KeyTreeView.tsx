import { useState } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { KeyNode } from "@/features/redis/keyTree";
import { cn } from "@/lib/utils";

type KeyTreeViewProps = {
  nodes: KeyNode[];
  selected: string | null;
  onSelect: (key: string) => void;
};

/** 28px rows like every other table; the open key gets the "where you are" marker. */
const KEY_ROW =
  "flex h-7 w-full items-center rounded-[2px] px-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export function KeyTreeView({ nodes, selected, onSelect }: KeyTreeViewProps) {
  return (
    <ul aria-label="Chaves" className="grid grid-cols-1 text-sm">
      <TreeLevel nodes={nodes} selected={selected} onSelect={onSelect} />
    </ul>
  );
}

function TreeLevel({ nodes, selected, onSelect }: KeyTreeViewProps) {
  return nodes.map(node =>
    node.kind === "folder" ? (
      <FolderNode key={`folder:${node.id}`} node={node} selected={selected} onSelect={onSelect} />
    ) : (
      <li key={`key:${node.entry.name}`}>
        <button
          type="button"
          title={node.entry.name}
          aria-current={node.entry.name === selected || undefined}
          onClick={() => onSelect(node.entry.name)}
          className={cn(
            KEY_ROW,
            "gap-2",
            node.entry.name === selected &&
              "bg-select/10 font-medium shadow-[inset_3px_0_0_var(--select)] hover:bg-select/10"
          )}
        >
          <span className="w-11 shrink-0 label-caps text-muted-foreground">{node.entry.kind}</span>
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
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        className={cn(KEY_ROW, "gap-1")}
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs">{node.name || "(vazio)"}</span>
        <span className="ml-auto text-xs text-muted-foreground">{node.count}</span>
      </button>
      {open && (
        <ul className="ml-3 grid grid-cols-1 border-l pl-1">
          <TreeLevel nodes={node.children} selected={selected} onSelect={onSelect} />
        </ul>
      )}
    </li>
  );
}

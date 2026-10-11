import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { describeWrapper, type JsonValue } from "@/features/mongo/ejson";
import { cn } from "@/lib/utils";

type NodeProps = { name: string; value: JsonValue; depth: number };

/** Collapsible view of a document; Extended JSON wrappers show as typed values. */
export function DocumentTree({ document }: { document: Record<string, JsonValue> }) {
  return (
    <ul className="font-mono text-xs">
      {Object.entries(document).map(([name, value]) => (
        <TreeNode key={name} name={name} value={value} depth={0} />
      ))}
    </ul>
  );
}

function scalar(value: JsonValue): { text: string; className: string } {
  const wrapper = describeWrapper(value);
  if (wrapper !== null) {
    return { text: wrapper, className: "text-syntax-keyword" };
  }
  if (value === null) {
    return { text: "null", className: "text-muted-foreground italic" };
  }
  if (typeof value === "string") {
    return { text: JSON.stringify(value), className: "text-syntax-string" };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { text: String(value), className: "text-syntax-number" };
  }
  return { text: "", className: "" };
}

function TreeNode({ name, value, depth }: NodeProps) {
  const isContainer =
    value !== null && typeof value === "object" && describeWrapper(value) === null;
  // top-level fields open, nested containers closed
  const [open, setOpen] = useState(depth === 0);

  if (!isContainer) {
    const { text, className } = scalar(value);
    return (
      <li className="flex gap-2 py-0.5 pl-4">
        <span className="font-semibold">{name}:</span>
        <span className={cn("break-all", className)}>{text}</span>
      </li>
    );
  }

  const entries: [string, JsonValue][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const summary = Array.isArray(value) ? `Array(${value.length})` : `{${entries.length}}`;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-1 py-0.5 text-left hover:bg-muted"
      >
        <Chevron className="size-3 shrink-0" />
        <span className="font-semibold">{name}:</span>
        <span className="text-muted-foreground">{summary}</span>
      </button>
      {open && (
        <ul className="ml-2 border-l pl-2">
          {/* field names and array positions are the identity of a document's parts */}
          {entries.map(([key, item]) => (
            <TreeNode key={key} name={key} value={item} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

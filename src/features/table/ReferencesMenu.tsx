import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Link2 } from "lucide-react";
import { commands } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { connected } from "@/features/explorer/queries";
import { incomingKeys, incomingLabel, type IncomingKey } from "@/features/table/foreignKeys";
import { errorMessage } from "@/lib/errors";

type ReferencesMenuProps = {
  connectionId: string;
  schema: string;
  table: string;
  /** a stored row is selected; a new row references nothing yet */
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (incoming: IncomingKey) => void;
  /** when the word shows; the icon and the name (read aloud and on hover) always do */
  labelClassName: string;
};

/**
 * The reverse of following a key: rows of other tables whose foreign key points at the
 * selected row. Keys come from the ER diagram's catalog read, asked only when the menu opens.
 */
export function ReferencesMenu({
  connectionId,
  schema,
  table,
  enabled,
  open,
  onOpenChange,
  onPick,
  labelClassName
}: ReferencesMenuProps) {
  // ponytail: only this schema's tables are read (as in the ER diagram); a reference
  // from another schema is not listed, and the menu says so
  const tables = useQuery({
    queryKey: ["referencing", connectionId, schema],
    queryFn: () => connected(connectionId, () => commands.schemaDiagram(connectionId, schema)),
    enabled: open,
    staleTime: Infinity
  });
  const incoming = tables.data ? incomingKeys(tables.data, schema, table) : [];

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          disabled={!enabled}
          aria-label="Referências"
          aria-keyshortcuts="Alt+Shift+Enter"
          title="Linhas de outras tabelas que apontam para a linha selecionada (Alt+Shift+Enter)"
        >
          <Link2 /> <span className={labelClassName}>Referências</span> <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Chaves estrangeiras do schema {schema} que apontam para {table}
        </p>
        {tables.isPending && <DropdownMenuItem disabled>Lendo as chaves…</DropdownMenuItem>}
        {tables.isError && (
          <DropdownMenuItem disabled>{errorMessage(tables.error)}</DropdownMenuItem>
        )}
        {tables.isSuccess && incoming.length === 0 && (
          <DropdownMenuItem disabled>
            Nenhuma tabela deste schema aponta para {table}
          </DropdownMenuItem>
        )}
        {incoming.map(item => (
          <DropdownMenuItem key={`${item.table}/${item.key.name}`} onSelect={() => onPick(item)}>
            {incomingLabel(item)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

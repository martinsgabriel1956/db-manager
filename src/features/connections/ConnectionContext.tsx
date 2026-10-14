import { EnvTag } from "@/features/connections/EnvTag";
import { useConnections } from "@/features/connections/queries";
import { cn } from "@/lib/utils";

type ConnectionContextProps = { connectionId: string; className?: string };

/**
 * The connection and its environment, printed in every view header: knowing you are on
 * production must not depend on the tab, which can scroll out of sight.
 */
export function ConnectionContext({ connectionId, className }: ConnectionContextProps) {
  const connections = useConnections();
  const connection = connections.data?.find(candidate => candidate.id === connectionId);
  if (!connection) {
    return null;
  }
  // a span, not a <p>: it also sits inside the receipt's status line, itself a paragraph
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", className)}>
      <span className="min-w-0 truncate font-semibold">{connection.name}</span>
      <EnvTag environment={connection.environment} />
    </span>
  );
}

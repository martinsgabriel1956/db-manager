import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commands, type Confirmation, type SchemaChange } from "@/bindings";
import { connected, isConnectionQuery } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

type Target = { table: string; change: SchemaChange };
type Pending = Target & { confirmation: Confirmation };

/**
 * A structure change in two steps: the backend first answers with the exact DDL (always:
 * nothing runs unseen), then runs it once confirmed. The structure, the rows and the tree
 * of the connection are read again afterwards.
 */
export function useSchemaChange(
  connectionId: string,
  schema: string,
  onDone?: (target: Target) => void
) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  /** the statement that ran, said back under the structure */
  const [done, setDone] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: ({ table, change }: Target) =>
      connected(connectionId, () =>
        commands.alterSchema(connectionId, schema, table, change, false)
      ),
    onSuccess: (response, target) => {
      if (response.status === "needsConfirmation") {
        setPending({ ...target, confirmation: response.confirmation });
      }
    }
  });

  const run = useMutation({
    mutationFn: ({ table, change }: Pending) =>
      commands.alterSchema(connectionId, schema, table, change, true),
    onSuccess: (_, target) => {
      setDone(target.confirmation.statements.join(";\n"));
      setPending(null);
      review.reset();
      queryClient.invalidateQueries({
        predicate: query => isConnectionQuery(query.queryKey, connectionId)
      });
      queryClient.invalidateQueries({ queryKey: ["history"] });
      onDone?.(target);
    },
    onError: () => {
      setPending(null);
      queryClient.invalidateQueries({ queryKey: ["history"] });
    }
  });

  return {
    review: (table: string, change: SchemaChange) => {
      setDone(null);
      run.reset();
      review.mutate({ table, change });
    },
    reviewing: review.isPending,
    /** the form's problem (a missing type, what the engine cannot do): shown on the form */
    reviewError: review.error ? errorMessage(review.error) : null,
    /** the form waits behind the confirmation; cancelling it goes back to the form */
    confirmation: pending?.confirmation ?? null,
    confirm: () => pending && run.mutate(pending),
    running: run.isPending,
    runError: run.error ? errorMessage(run.error) : null,
    dismiss: () => setPending(null),
    reset: () => review.reset(),
    done
  };
}

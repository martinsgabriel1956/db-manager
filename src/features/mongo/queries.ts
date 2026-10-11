import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type Confirmation, type DocumentWrite, type FindRequest } from "@/bindings";
import { connected } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

export function useDocuments(connectionId: string, request: FindRequest) {
  return useQuery({
    queryKey: ["documents", connectionId, request],
    queryFn: () => connected(connectionId, () => commands.browseCollection(connectionId, request)),
    placeholderData: keepPreviousData
  });
}

export function useIndexes(connectionId: string, database: string, collection: string) {
  return useQuery({
    queryKey: ["indexes", connectionId, database, collection],
    queryFn: () =>
      connected(connectionId, () => commands.collectionIndexes(connectionId, database, collection)),
    staleTime: Infinity
  });
}

type PendingWrite = { write: DocumentWrite; onDone: () => void };

/**
 * Inserts/replaces/deletes one document. On prod the backend answers with the
 * statement to confirm first; `confirm` re-sends it confirmed.
 */
export function useDocumentWrite(connectionId: string, database: string, collection: string) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const mutation = useMutation({
    mutationFn: ({ write, confirmed }: { write: DocumentWrite; confirmed: boolean }) =>
      commands.writeDocument(connectionId, { database, collection, write }, confirmed),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["history"] })
  });

  async function send(next: PendingWrite, confirmed: boolean) {
    setPending(next);
    try {
      const response = await mutation.mutateAsync({ write: next.write, confirmed });
      if (response.status === "needsConfirmation") {
        setConfirmation(response.confirmation);
        return;
      }
      setConfirmation(null);
      setPending(null);
      queryClient.invalidateQueries({ queryKey: ["documents", connectionId] });
      next.onDone();
    } catch {
      setConfirmation(null);
    }
  }

  return {
    submit: (write: DocumentWrite, onDone: () => void) => send({ write, onDone }, false),
    confirmation,
    confirm: () => pending && send(pending, true),
    dismiss: () => {
      setConfirmation(null);
      setPending(null);
    },
    reset: () => mutation.reset(),
    isPending: mutation.isPending,
    error: mutation.error ? errorMessage(mutation.error) : null
  };
}

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type BrowseRequest } from "@/bindings";

// Every query reconnects first: connect is idempotent and cheap, and it keeps views
// working after the backend dropped the session (connection edited, app restarted).
export async function connected<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
  await commands.connectDatabase(connectionId);
  return work();
}

/** Query keys start with the scope and the connection id, so one predicate drops them all. */
export function isConnectionQuery(queryKey: readonly unknown[], connectionId: string) {
  return queryKey[1] === connectionId;
}

export function useSchemas(connectionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["schemas", connectionId],
    queryFn: () => connected(connectionId, () => commands.listSchemas(connectionId)),
    enabled,
    staleTime: Infinity
  });
}

/** Shared by the view and by whoever needs a table's structure once (fetchQuery). */
export function structureQuery(connectionId: string, schema: string, table: string) {
  return {
    queryKey: ["structure", connectionId, schema, table],
    queryFn: () =>
      connected(connectionId, () => commands.tableStructure(connectionId, schema, table)),
    staleTime: Infinity
  };
}

export function useStructure(connectionId: string, schema: string, table: string) {
  return useQuery(structureQuery(connectionId, schema, table));
}

export function useDdl(connectionId: string, schema: string, table: string) {
  return useQuery({
    queryKey: ["ddl", connectionId, schema, table],
    queryFn: () => connected(connectionId, () => commands.tableDdl(connectionId, schema, table)),
    staleTime: Infinity
  });
}

export function useCompletion(connectionId: string) {
  return useQuery({
    queryKey: ["completion", connectionId],
    queryFn: () => connected(connectionId, () => commands.completionTables(connectionId)),
    staleTime: Infinity
  });
}

export function useBrowse(connectionId: string, request: BrowseRequest) {
  return useQuery({
    queryKey: ["browse", connectionId, request],
    queryFn: () => connected(connectionId, () => commands.browseTable(connectionId, request)),
    placeholderData: keepPreviousData
  });
}

export function useDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => commands.disconnectDatabase(connectionId),
    onSuccess: (_, connectionId) =>
      queryClient.removeQueries({
        predicate: query => isConnectionQuery(query.queryKey, connectionId)
      })
  });
}

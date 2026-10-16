import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type Confirmation, type KeyEdit } from "@/bindings";
import { connected } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

export function useRedisDatabases(connectionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["redisDatabases", connectionId],
    queryFn: () => connected(connectionId, () => commands.redisDatabases(connectionId)),
    enabled,
    staleTime: Infinity
  });
}

/** SCAN pages: each "load more" continues from the previous cursor. */
export function useKeyScan(connectionId: string, db: number, pattern: string) {
  return useInfiniteQuery({
    queryKey: ["redisKeys", connectionId, db, pattern],
    queryFn: ({ pageParam }) =>
      connected(connectionId, () => commands.scanKeys(connectionId, db, pattern, pageParam)),
    initialPageParam: "0",
    getNextPageParam: page => (page.cursor === "0" ? undefined : page.cursor),
    staleTime: Infinity
  });
}

export function useKey(connectionId: string, db: number, key: string | null) {
  return useQuery({
    queryKey: ["redisKey", connectionId, db, key],
    queryFn: () => connected(connectionId, () => commands.readKey(connectionId, db, key ?? "")),
    enabled: key !== null
  });
}

/** The master the sentinels pointed to; asked only for connections behind Sentinel. */
export function useRedisMaster(connectionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["redisMaster", connectionId],
    queryFn: () => connected(connectionId, () => commands.redisMaster(connectionId)),
    enabled
  });
}

export function useServerInfo(connectionId: string) {
  return useQuery({
    queryKey: ["redisInfo", connectionId],
    queryFn: () => connected(connectionId, () => commands.serverInfo(connectionId))
  });
}

export function useServerModules(connectionId: string) {
  return useQuery({
    queryKey: ["redisModules", connectionId],
    queryFn: () => connected(connectionId, () => commands.serverModules(connectionId)),
    // managed services often refuse MODULE: say so once, do not retry
    retry: false
  });
}

/**
 * Sends `input`; when the backend asks for confirmation (`run` returns it), keeps
 * the input until the user confirms (re-sent with `confirmed: true`) or dismisses.
 */
export function useConfirmed<Input>(
  run: (input: Input, confirmed: boolean) => Promise<Confirmation | null>
) {
  const [waiting, setWaiting] = useState<{ input: Input; confirmation: Confirmation } | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(input: Input, confirmed: boolean) {
    setIsPending(true);
    setError(null);
    try {
      const confirmation = await run(input, confirmed);
      setWaiting(confirmation && { input, confirmation });
    } catch (err) {
      setWaiting(null);
      setError(errorMessage(err));
    } finally {
      setIsPending(false);
    }
  }

  return {
    submit: (input: Input) => send(input, false),
    confirmation: waiting?.confirmation ?? null,
    confirm: () => waiting && send(waiting.input, true),
    dismiss: () => setWaiting(null),
    clearError: () => setError(null),
    isPending,
    error
  };
}

export type PendingEdit = {
  key: string;
  edits: KeyEdit[];
  create?: boolean;
  onDone?: () => void;
};

/** Edits one key. Creating, renaming or deleting also refreshes the key tree. */
export function useKeyEdit(connectionId: string, db: number) {
  const queryClient = useQueryClient();
  return useConfirmed<PendingEdit>(async ({ key, edits, create = false, onDone }, confirmed) => {
    const response = await connected(connectionId, () =>
      commands.editKey(connectionId, { db, key, edits, create }, confirmed)
    );
    if (response.status === "needsConfirmation") {
      return response.confirmation;
    }
    const changesKeys = create || edits.some(edit => edit.op === "rename" || edit.op === "delete");
    if (changesKeys) {
      queryClient.invalidateQueries({ queryKey: ["redisKeys", connectionId, db] });
      queryClient.invalidateQueries({ queryKey: ["redisDatabases", connectionId] });
    }
    queryClient.invalidateQueries({ queryKey: ["redisKey", connectionId, db, key] });
    queryClient.invalidateQueries({ queryKey: ["history"] });
    onDone?.();
    return null;
  });
}

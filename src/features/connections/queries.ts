import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type ConnectionConfig, type SecretChange } from "@/bindings";

const CONNECTIONS_KEY = ["connections"] as const;

export type SaveConnectionInput = {
  config: ConnectionConfig;
  secret: SecretChange;
  sentinelSecret: SecretChange;
};

export function useConnections() {
  return useQuery({ queryKey: CONNECTIONS_KEY, queryFn: commands.listConnections });
}

export function useSaveConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ config, secret, sentinelSecret }: SaveConnectionInput) =>
      commands.saveConnection(config, secret, sentinelSecret),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY })
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => commands.deleteConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY })
  });
}

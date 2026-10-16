import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerInfo, useServerModules } from "@/features/redis/queries";
import { errorMessage } from "@/lib/errors";

/** INFO by section, with a filter over field names and values. */
export function InfoPanel({ connectionId }: { connectionId: string }) {
  const info = useServerInfo(connectionId);
  const modules = useServerModules(connectionId);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();

  const sections = (info.data ?? [])
    .map(section => ({
      ...section,
      entries: section.entries.filter(
        ([field, value]) =>
          needle === "" ||
          field.toLowerCase().includes(needle) ||
          value.toLowerCase().includes(needle)
      )
    }))
    .filter(section => section.entries.length > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted px-3 py-2">
        <Input
          aria-label="Filtrar INFO"
          placeholder="Filtrar (memory, clients…)"
          className="h-7 w-72 text-xs"
          value={filter}
          onChange={event => setFilter(event.target.value)}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Atualizar INFO"
          disabled={info.isFetching}
          onClick={() => {
            info.refetch();
            modules.refetch();
          }}
        >
          <RefreshCw />
        </Button>
      </div>
      {info.isPending && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
      {info.isError && (
        <p role="alert" className="p-4 text-sm text-destructive">
          {errorMessage(info.error)}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <section aria-label="Módulos" className="mb-4">
          <h3 className="mb-1 text-sm font-semibold">Módulos</h3>
          {modules.isError && (
            <p className="text-xs text-muted-foreground">
              MODULE LIST indisponível: {errorMessage(modules.error)}
            </p>
          )}
          {modules.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum módulo carregado.</p>
          )}
          {modules.data && modules.data.length > 0 && (
            <table className="w-full border-collapse text-xs md:w-1/2">
              <tbody className="font-mono">
                {modules.data.map(module => (
                  <tr key={module.name} className="h-7 border-b">
                    <td className="py-1 pr-4">{module.name}</td>
                    <td className="py-1 text-muted-foreground">versão {module.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map(section => (
            <section key={section.name} aria-label={section.name}>
              <h3 className="mb-1 text-sm font-semibold">{section.name}</h3>
              <table className="w-full border-collapse text-xs">
                <tbody className="font-mono">
                  {section.entries.map(([field, value]) => (
                    <tr key={field} className="h-7 border-b">
                      <td className="py-1 pr-4 text-muted-foreground">{field}</td>
                      <td className="py-1 break-all">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

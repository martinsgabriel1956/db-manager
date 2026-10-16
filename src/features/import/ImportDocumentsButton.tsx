import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Upload } from "lucide-react";
import { commands, type Confirmation, type DocumentImport } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { connected } from "@/features/explorer/queries";
import { ImportStatus, useImportRun } from "@/features/import/ImportRun";

type ImportDocumentsButtonProps = { connectionId: string; database: string; collection: string };

/**
 * Opens an NDJSON or JSON array file and inserts its documents with insertMany. The
 * backend answers the first call with the first document as it will be stored and
 * the count, signed in the confirmation before anything runs.
 */
export function ImportDocumentsButton({
  connectionId,
  database,
  collection
}: ImportDocumentsButtonProps) {
  const runner = useImportRun(["documents", connectionId], rows =>
    rows === 1 ? "1 documento importado" : `${rows.toLocaleString("pt-BR")} documentos importados`
  );
  const [review, setReview] = useState<{
    request: DocumentImport;
    confirmation: Confirmation;
  } | null>(null);

  async function pick() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON", extensions: ["json", "ndjson", "jsonl"] }]
    });
    if (!path) {
      return;
    }
    const request = { database, collection, path };
    try {
      const response = await connected(connectionId, () =>
        commands.importDocuments(connectionId, crypto.randomUUID(), request, false)
      );
      if (response.status === "needsConfirmation") {
        setReview({ request, confirmation: response.confirmation });
      }
    } catch (err) {
      runner.fail(err);
    }
  }

  return (
    <ImportStatus runner={runner}>
      <Button size="xs" variant="outline" onClick={pick}>
        <Upload /> Importar
      </Button>
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={review?.confirmation ?? null}
        confirmLabel="Importar"
        statementSuffix=""
        onConfirm={() => {
          if (review) {
            setReview(null);
            runner.run(runId =>
              connected(connectionId, () =>
                commands.importDocuments(connectionId, runId, review.request, true)
              )
            );
          }
        }}
        onCancel={() => setReview(null)}
      />
    </ImportStatus>
  );
}

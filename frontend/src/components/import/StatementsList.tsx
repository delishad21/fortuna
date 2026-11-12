"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";

export type StatementImport = {
  id: string;
  mode: string;
  status: string;
  createdAt: string;
  committedAt: string | null;
  rows: number;
};

export type Statement = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  inUse: boolean;
  imports: StatementImport[];
};

const OPEN = (status: string) =>
  !["committed", "discarded", "expired", "failed"].includes(status);

const day = (value: string) =>
  new Date(value).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function importLabel(draft: StatementImport) {
  const status = OPEN(draft.status)
    ? "Staged"
    : draft.status[0].toUpperCase() + draft.status.slice(1);
  const when = draft.committedAt || draft.createdAt;
  return `${status}${draft.mode === "trip" ? " trip import" : ""} · ${draft.rows} ${
    draft.rows === 1 ? "row" : "rows"
  } · ${day(when)}`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/chat/${path}`, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

/** Every uploaded statement, kept until it is deleted here. */
export function StatementsList() {
  const [statements, setStatements] = useState<Statement[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Statement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatements((await call<{ statements: Statement[] }>("statements")).statements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load statements");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (statement: Statement) => {
    setDeleting(true);
    setError("");
    try {
      await call(`statements/${encodeURIComponent(statement.id)}`, { method: "DELETE" });
      setStatements((current) => current?.filter((s) => s.id !== statement.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the statement");
    } finally {
      setDeleting(false);
      setPending(null);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-stroke px-5 py-3 text-sm font-medium text-dark dark:border-dark-3 dark:text-white">
        {statements
          ? `${statements.length} ${statements.length === 1 ? "statement" : "statements"}`
          : "Statements"}
      </div>
      {error && (
        <p
          role="alert"
          className="border-b border-stroke bg-red/5 px-5 py-3 text-sm text-red dark:border-dark-3"
        >
          {error}
        </p>
      )}
      {!statements ? (
        !error && (
          <p className="px-5 py-12 text-center text-sm text-dark-5 dark:text-dark-6">
            Loading…
          </p>
        )
      ) : !statements.length ? (
        <p className="px-5 py-12 text-center text-sm text-dark-5 dark:text-dark-6">
          No statements. Files you upload here or attach in chat appear here.
        </p>
      ) : (
        <ul className="divide-y divide-stroke dark:divide-dark-3">
          {statements.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-1 dark:hover:bg-dark-3/40"
            >
              <FileText className="mt-0.5 size-5 shrink-0 text-dark-5 dark:text-dark-6" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-dark dark:text-white" title={s.filename}>
                  {s.filename}
                </p>
                <p className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">
                  Uploaded {day(s.createdAt)} · {fileSize(s.sizeBytes)}
                </p>
                {s.imports.length > 0 ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.imports.map((draft) => (
                      <li key={draft.id}>
                        {OPEN(draft.status) ? (
                          <Link
                            href={`/imports/drafts/${draft.id}`}
                            className="inline-block whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:underline"
                          >
                            {importLabel(draft)}
                          </Link>
                        ) : (
                          <span className="inline-block whitespace-nowrap rounded-full bg-gray-2 px-2 py-0.5 text-xs text-dark-5 dark:bg-dark-3 dark:text-dark-6">
                            {importLabel(draft)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">Not imported</p>
                )}
              </div>
              <a
                href={`/api/chat/statements/${encodeURIComponent(s.id)}/content`}
                download={s.filename}
                aria-label={`Download ${s.filename}`}
                title="Download"
                className="shrink-0 rounded-md p-2 text-dark-5 transition-colors hover:bg-gray-2 hover:text-dark dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white"
              >
                <Download className="size-4" />
              </a>
              <button
                type="button"
                disabled={deleting || s.inUse}
                aria-label={`Delete ${s.filename}`}
                title={s.inUse ? "A staged import still uses it" : "Delete"}
                onClick={() => setPending(s)}
                className="shrink-0 rounded-md p-2 text-dark-5 transition-colors hover:bg-red/10 hover:text-red disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dark-5 dark:text-dark-6"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        isOpen={!!pending}
        onClose={() => setPending(null)}
        type="warning"
        title="Delete statement?"
        message={
          pending
            ? `${pending.filename}\n\nThe file is removed from Fortuna. Transactions imported from it stay. To use it again, upload it again.`
            : ""
        }
        confirmText="Delete statement"
        onConfirm={() => pending && void remove(pending)}
      />
    </Card>
  );
}

"use client";
import { useState } from "react";
import { Clock, FileText, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import {
  chatApi,
  Conversation,
  QueuedMessage,
  queueItems,
  queuedFiles,
} from "@/lib/chat/client";
/** Messages waiting for the current reply, in the order they will be sent. */
export function QueuedMessages({
  conversation,
  onChanged,
}: {
  conversation: Conversation;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(""),
    [files, setFiles] = useState<string[]>([]),
    [working, setWorking] = useState<string | null>(null),
    [error, setError] = useState<{ id: string; message: string } | null>(null);
  const items = queueItems(conversation);
  if (!items.length) return null;
  const path = (item: QueuedMessage) =>
    `/conversations/${conversation.id}/queue/${item.id}`;
  async function act(item: QueuedMessage, fn: () => Promise<unknown>) {
    setWorking(item.id);
    setError(null);
    try {
      await fn();
      setEditing(null);
      await onChanged();
    } catch (e) {
      setError({ id: item.id, message: (e as Error).message });
      await onChanged().catch(() => {});
    } finally {
      setWorking(null);
    }
  }
  const save = (item: QueuedMessage, text: string, attachmentIds: string[]) =>
    act(item, () =>
      chatApi(path(item), { method: "PUT", body: { text, attachmentIds } }),
    );
  return (
    <section aria-label="Queued messages" className="space-y-3">
      {items.map(({ item, marker, editable }) => {
        const failed = item.status === "failed";
        const attached = queuedFiles(conversation, item);
        const open = editing === item.id;
        return (
          <article
            key={item.id}
            aria-label={`${marker} message`}
            className={`space-y-2 rounded-xl border border-dashed px-4 py-3 ${
              failed
                ? "border-red bg-red/5"
                : "border-stroke bg-white/60 dark:border-stroke-dark dark:bg-dark-2/60"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  failed
                    ? "bg-red/10 text-red"
                    : "bg-gray-2 text-dark-5 dark:bg-dark-3 dark:text-dark-6"
                }`}
              >
                <Clock size={12} aria-hidden />
                {marker}
              </span>
              {editable && !open && (
                <span className="ml-auto flex gap-1">
                  {failed && (
                    <button
                      type="button"
                      disabled={working === item.id}
                      onClick={() =>
                        void save(item, item.text, item.attachmentIds)
                      }
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
                    >
                      <RotateCcw size={13} aria-hidden />
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={working === item.id}
                    onClick={() => {
                      setEditing(item.id);
                      setDraft(item.text);
                      setFiles(item.attachmentIds);
                      setError(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-gray-2 disabled:opacity-40 dark:hover:bg-dark-3"
                  >
                    <Pencil size={13} aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={working === item.id}
                    onClick={() =>
                      void act(item, () =>
                        chatApi(path(item), { method: "DELETE" }),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-gray-2 disabled:opacity-40 dark:hover:bg-dark-3"
                  >
                    <Trash2 size={13} aria-hidden />
                    Remove
                  </button>
                </span>
              )}
              {!editable && (
                <button
                  type="button"
                  disabled={working === item.id}
                  onClick={() =>
                    void act(item, () =>
                      chatApi(path(item), { method: "DELETE" }),
                    )
                  }
                  className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-gray-2 disabled:opacity-40 dark:hover:bg-dark-3"
                >
                  <Trash2 size={13} aria-hidden />
                  Remove
                </button>
              )}
            </div>
            {open ? (
              <div className="space-y-2">
                <label className="sr-only" htmlFor={`queued-${item.id}`}>
                  Edit queued message
                </label>
                <textarea
                  id={`queued-${item.id}`}
                  value={draft}
                  maxLength={16000}
                  rows={2}
                  onChange={(e) => setDraft(e.target.value)}
                  className="block w-full resize-y rounded-lg border border-stroke bg-white px-3 py-2 text-[15px] outline-none focus:border-primary dark:border-stroke-dark dark:bg-dark-2"
                />
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {queuedFiles(conversation, {
                      ...item,
                      attachmentIds: files,
                    }).map((f) => (
                      <span
                        key={f.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-stroke bg-gray-1 py-1 pl-2 pr-1 text-xs dark:border-stroke-dark dark:bg-dark-3"
                      >
                        <FileText size={13} aria-hidden />
                        {f.filename}
                        <button
                          type="button"
                          aria-label={`Remove ${f.filename}`}
                          onClick={() =>
                            setFiles((prev) => prev.filter((id) => id !== f.id))
                          }
                          className="rounded p-0.5 hover:bg-gray-2 dark:hover:bg-dark-2"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-lg px-3 py-1.5 text-sm hover:bg-gray-2 dark:hover:bg-dark-3"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      working === item.id ||
                      (!draft.trim() && !files.length && !item.reviewId)
                    }
                    onClick={() => void save(item, draft, files)}
                    className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {failed ? "Save and retry" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {item.text && (
                  <p className="whitespace-pre-wrap break-words leading-relaxed">
                    {item.text}
                  </p>
                )}
                {item.reviewTitle && (
                  <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                    Review: {item.reviewTitle}
                  </p>
                )}
                {attached.map((f) => (
                  <p
                    key={f.id}
                    className="text-sm text-dark-5 dark:text-dark-6"
                  >
                    Attachment: {f.filename}
                  </p>
                ))}
              </>
            )}
            {failed && item.error && (
              <p role="alert" className="text-sm text-red">
                {item.error}
              </p>
            )}
            {error?.id === item.id && (
              <p role="alert" className="text-sm text-red">
                {error.message}
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}

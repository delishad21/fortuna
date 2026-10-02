"use client";
import { useEffect, useState } from "react";
import { Bookmark, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { chatApi, ChatMemory } from "@/lib/chat/client";

/** Notes the assistant reuses across conversations; the user can read, edit and delete every one. */
export function MemoryPanel() {
  const [notes, setNotes] = useState<ChatMemory[] | null>(null),
    [draft, setDraft] = useState(""),
    [editing, setEditing] = useState<{ id: string; content: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    chatApi<ChatMemory[]>("/memories")
      .then((v) => setNotes(Array.isArray(v) ? v : []))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="memories"
      aria-labelledby="memories-title"
      className="mt-6 space-y-4 rounded-[10px] bg-white p-6 shadow-1 dark:bg-gray-dark"
    >
      <div>
        <h2
          id="memories-title"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <Bookmark size={18} className="text-primary" aria-hidden />
          Saved notes
        </h2>
        <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
          Fortuna reuses these in every conversation, e.g. how to tell your and
          your partner&apos;s journeys apart. It only saves a note when you ask
          it to.
        </p>
      </div>
      {notes === null && !error && (
        <p role="status" className="text-sm">
          Loading…
        </p>
      )}
      {notes?.length === 0 && (
        <p className="text-sm text-dark-5 dark:text-dark-6">
          No saved notes yet.
        </p>
      )}
      <ul className="divide-y divide-stroke dark:divide-stroke-dark">
        {notes?.map((note) => (
          <li key={note.id} className="flex items-start gap-3 py-3">
            {editing?.id === note.id ? (
              <form
                className="flex flex-1 flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await chatApi(`/memories/${note.id}`, {
                      method: "PUT",
                      body: { content: editing.content },
                    });
                    setEditing(null);
                  });
                }}
              >
                <label className="sr-only" htmlFor={`note-${note.id}`}>
                  Edit note
                </label>
                <textarea
                  id={`note-${note.id}`}
                  value={editing.content}
                  maxLength={500}
                  rows={2}
                  onChange={(e) =>
                    setEditing({ id: note.id, content: e.target.value })
                  }
                  className="flex-1 resize-none rounded-lg border border-stroke bg-transparent p-2 text-sm dark:border-stroke-dark"
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={busy || !editing.content.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <p className="flex-1 whitespace-pre-wrap break-words text-sm">
                  {note.content}
                </p>
                <button
                  type="button"
                  aria-label={`Edit note: ${note.content}`}
                  className="rounded p-1.5 text-dark-5 hover:bg-gray-2 dark:hover:bg-dark-3"
                  onClick={() =>
                    setEditing({ id: note.id, content: note.content })
                  }
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete note: ${note.content}`}
                  disabled={busy}
                  className="rounded p-1.5 text-red hover:bg-gray-2 dark:hover:bg-dark-3"
                  onClick={() =>
                    void run(() =>
                      chatApi(`/memories/${note.id}`, { method: "DELETE" }),
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await chatApi("/memories", {
              method: "POST",
              body: { content: draft },
            });
            setDraft("");
          });
        }}
      >
        <label className="sr-only" htmlFor="new-note">
          New note
        </label>
        <input
          id="new-note"
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note for Fortuna…"
          className="flex-1 rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm dark:border-stroke-dark"
        />
        <Button type="submit" disabled={busy || !draft.trim()}>
          Add note
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      )}
    </section>
  );
}

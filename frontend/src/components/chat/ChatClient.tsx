"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Paperclip,
  Send,
  Plus,
  Settings2,
  PanelLeft,
  X,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  chatApi,
  Conversation,
  ConversationSummary,
  Proposal,
  Block,
  Stream,
  emptyStream,
  mergeEvents,
  generatingRun,
} from "@/lib/chat/client";
import { BrandMark } from "@/components/ui/Brand";
import { TransactionReviewEditor } from "./TransactionReviewEditor";
import { ActionPreview, DataDetails } from "./ActionPreview";
import { ChatTransactions, asTransactions } from "./ChatTransactions";
import { ChatComponent } from "./ChatComponents";
export function ChatClient() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [list, setList] = useState<ConversationSummary[]>([]),
    [id, setId] = useState<string | null>(null),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [text, setText] = useState(""),
    [files, setFiles] = useState<
      Array<{ attachmentId: string; filename: string }>
    >([]),
    [stream, setStream] = useState<Stream>(emptyStream),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [proposal, setProposal] = useState<Proposal | null>(null);
  const streamRef = useRef(stream),
    selected = useRef(id),
    sendKey = useRef<string | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    inFlight = useRef(false);
  selected.current = id;
  streamRef.current = stream;
  const refreshList = useCallback(
    () => chatApi<ConversationSummary[]>("/conversations").then(setList),
    [],
  );
  const refresh = useCallback(async () => {
    if (!id) return;
    const value = await chatApi<Conversation>(`/conversations/${id}`);
    if (selected.current === id) setConversation(value);
  }, [id]);
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get(
      "conversation",
    );
    if (initial) setId(initial);
    void refreshList().catch((e) => setError(e.message));
  }, [refreshList]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    window.history.replaceState(null, "", url);
  }, [id]);
  useEffect(() => {
    setConversation(null);
    setStream(emptyStream());
    setError("");
    setFiles([]);
    setText("");
    sendKey.current = null;
    void refresh().catch((e) => setError(e.message));
  }, [id, refresh]);
  const run = conversation?.runs[0];
  useEffect(() => {
    streamRef.current = emptyStream();
    setStream(emptyStream());
  }, [run?.id]);
  useEffect(() => {
    if (!id) return;
    let stopped = false,
      polling = false;
    const poll = async () => {
      if (document.hidden || polling) return;
      polling = true;
      try {
        if (run && ["queued", "running"].includes(run.status)) {
          const result = await chatApi(
            `/runs/${run.id}/events?after=${streamRef.current.cursor}`,
          );
          if (stopped) return;
          setStream((prev) => mergeEvents(prev, result.events));
          if (!["queued", "running"].includes(result.status)) await refresh();
        } else await refresh();
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), 1500);
    const focus = () => void poll();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    void poll();
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [id, run?.id, run?.status, refresh]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [conversation?.messages.length, stream.text]);
  async function action(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function create() {
    if (
      (text || files.length) &&
      !window.confirm("Discard your unsent message and start a new chat?")
    )
      return;
    await action(async () => {
      const created = await chatApi<Conversation>("/conversations", {
        method: "POST",
        body: {},
      });
      setId(created.id);
      await refreshList();
    });
  }
  async function send() {
    if (!id || (!text.trim() && !files.length) || generatingRun(run)) return;
    await action(async () => {
      sendKey.current ||= crypto.randomUUID();
      await chatApi(`/conversations/${id}/messages`, {
        method: "POST",
        body: {
          text,
          attachmentIds: files.map((f) => f.attachmentId),
          idempotencyKey: sendKey.current,
        },
      });
      setText("");
      setFiles([]);
      sendKey.current = null;
      setStream(emptyStream());
      await refresh();
      await refreshList();
    });
  }
  async function upload(file: File) {
    if (!id) return;
    if (file.size > 25 * 1024 * 1024) {
      setError("Choose a statement smaller than 25 MB.");
      return;
    }
    await action(async () => {
      const form = new FormData();
      form.append("conversationId", id);
      form.append("file", file);
      const result = await chatApi("/files", { method: "POST", body: form });
      setFiles((prev) => [
        ...prev.filter((f) => f.attachmentId !== result.attachmentId),
        result,
      ]);
    });
  }
  function block(value: Block, index: number) {
    if (value.type === "review")
      return (
        <TransactionReviewEditor
          key={value.id}
          id={value.id}
          onSubmitted={refresh}
        />
      );
    if (value.type === "text")
      return (
        <p
          key={index}
          className="whitespace-pre-wrap break-words leading-relaxed"
        >
          {value.text}
        </p>
      );
    if (value.type === "attachment")
      return (
        <p key={index} className="text-sm text-dark-5 dark:text-dark-6">
          Statement: {value.filename}
        </p>
      );
    if (value.type === "component")
      return <ChatComponent key={index} block={value} />;
    if (value.type === "data") {
      const transactions = asTransactions(value.data);
      if (transactions)
        return (
          <ChatTransactions
            key={index}
            title={value.title}
            transactions={transactions}
          />
        );
      return (
        <details
          key={index}
          className="rounded-lg border border-stroke p-3 dark:border-stroke-dark"
        >
          <summary className="cursor-pointer font-medium capitalize">
            {value.title}
          </summary>
          <div className="mt-3 max-h-96 overflow-auto">
            <DataDetails value={value.data} />
          </div>
        </details>
      );
    }
    if (value.kind === "proposal") {
      const found = conversation?.runs
        .flatMap((r) => r.proposals)
        .find((p) => p.id === value.id);
      return (
        <Button
          key={index}
          variant="secondary"
          disabled={!found}
          onClick={() => found && setProposal(found)}
        >
          {found?.status === "applied" ? "Changes applied" : value.label}
        </Button>
      );
    }
    return (
      <Link
        key={index}
        href={
          value.kind === "draft"
            ? `/imports/drafts/${encodeURIComponent(value.id)}`
            : `/chat/transactions/${encodeURIComponent(value.id)}`
        }
        className="inline-block rounded-lg border border-primary px-4 py-2 text-primary"
      >
        {value.label}
      </Link>
    );
  }
  function conversationItem(item: ConversationSummary) {
    return (
      <div
        key={item.id}
        className={`group flex items-center rounded-lg ${id === item.id ? "bg-primary text-white" : "hover:bg-gray-2 dark:hover:bg-dark-3"}`}
      >
        <button
          aria-current={id === item.id ? "page" : undefined}
          className="min-w-0 flex-1 p-3 text-left text-sm"
          onClick={() => {
            if (
              (text || files.length) &&
              !window.confirm(
                "Discard your unsent message and switch conversations?",
              )
            )
              return;
            setId(item.id);
            setHistoryOpen(false);
          }}
        >
          <span className="line-clamp-2">{item.title}</span>
        </button>
        <button
          aria-label={`Delete ${item.title}`}
          className="m-1 rounded-lg p-2"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Delete this conversation? Your transactions and staged imports will remain.",
              )
            )
              void action(async () => {
                await chatApi(`/conversations/${item.id}`, {
                  method: "DELETE",
                });
                if (id === item.id) setId(null);
                await refreshList();
              });
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  }
  return (
    <div className="relative flex h-full min-h-0 text-dark dark:text-white">
      {historyOpen && (
        <aside
          className="absolute inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col border-r border-stroke bg-white shadow-lg dark:border-stroke-dark dark:bg-gray-dark lg:relative lg:shrink-0 lg:shadow-none"
          aria-label="Chat history"
        >
          <div className="flex items-center justify-between p-4">
            <h2 className="font-semibold">Conversations</h2>
            <button
              className="rounded-lg p-2 hover:bg-gray-2 dark:hover:bg-dark-3"
              aria-label="Close chat history"
              onClick={() => setHistoryOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <nav
            aria-label="Conversations"
            className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3"
          >
            {list.map((item) => conversationItem(item))}
            {!list.length && (
              <p className="p-3 text-sm text-dark-5">
                Your conversations will appear here.
              </p>
            )}
          </nav>
          <Link
            href="/settings?tab=ai"
            className="m-3 flex items-center gap-2 rounded-lg border-t border-stroke p-3 text-sm dark:border-stroke-dark"
          >
            <Settings2 size={18} />
            AI connection
          </Link>
        </aside>
      )}
      {historyOpen && (
        <button
          className="absolute inset-0 z-20 bg-black/30 lg:hidden"
          aria-label="Close chat history overlay"
          onClick={() => setHistoryOpen(false)}
        />
      )}
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-gray-dark"
        aria-label="Conversation"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-stroke px-4 py-3 dark:border-stroke-dark">
          <button
            aria-label="Toggle chat history"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
            className="rounded-lg p-2 hover:bg-gray-2 dark:hover:bg-dark-3"
          >
            <PanelLeft size={20} />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {conversation?.title || "Fortuna"}
          </h2>
          {id && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void create()}
              leftIcon={<Plus size={18} />}
            >
              New chat
            </Button>
          )}
        </header>
        {!id ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-6 px-5 py-8 md:px-10">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold">Conversations</h2>
                <Button
                  disabled={busy}
                  onClick={() => void create()}
                  leftIcon={<Plus size={18} />}
                >
                  New chat
                </Button>
              </div>
              {list.length ? (
                <nav aria-label="Recent conversations" className="space-y-1">
                  {list.map((item) => conversationItem(item))}
                </nav>
              ) : (
                <p className="text-dark-5 dark:text-dark-6">
                  Ask about your spending, review a statement, or prepare
                  changes to your transactions. You review consequential changes
                  before they’re applied.
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-8 md:px-10">
              {conversation?.messages.length === 0 && (
                <p className="text-dark-5 dark:text-dark-6">
                  Try “How much did I spend on food last month?” or attach a
                  statement to begin.
                </p>
              )}
              {conversation?.messages.map((message) => (
                <article
                  key={message.id}
                  className={`space-y-3 ${message.role === "user" ? "ml-auto max-w-[90%] rounded-2xl bg-gray-2 p-4 dark:bg-dark-3" : "max-w-full"}`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {message.role === "user" ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-3 dark:bg-dark-2">
                        <User size={18} />
                      </span>
                    ) : (
                      <BrandMark className="h-8 w-8" />
                    )}
                    {message.role === "user" ? "You" : "Fortuna"}
                  </div>
                  {message.blocks.map(block)}
                </article>
              ))}
              {run && ["queued", "running"].includes(run.status) && (
                <article className="space-y-3" aria-label="Assistant response">
                  <p role="status" className="text-sm capitalize text-primary">
                    {stream.activity}…
                  </p>
                  <p className="whitespace-pre-wrap">{stream.text}</p>
                  {stream.blocks
                    .filter(
                      (b) =>
                        b.type === "link" ||
                        b.type === "component" ||
                        (b.type === "data" && asTransactions(b.data)),
                    )
                    .map(block)}
                </article>
              )}
              {run?.status === "awaiting_confirmation" && (
                <p role="status" className="text-sm">
                  Review the pending changes, or send a new message to move on.
                </p>
              )}
              {run?.status === "failed" && (
                <p role="alert" className="text-red">
                  {run.error ||
                    "The assistant could not finish. You can try again."}
                </p>
              )}
              <div ref={bottom} />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="shrink-0 space-y-3 border-t border-stroke px-5 py-4 dark:border-stroke-dark md:px-10"
            >
              <p className="text-xs text-dark-5 dark:text-dark-6">
                Statements expire after 7 days unless you approve retaining them
                as parser fixtures.
              </p>
              {files.map((file) => (
                <div
                  key={file.attachmentId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">{file.filename}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFiles((prev) =>
                        prev.filter(
                          (f) => f.attachmentId !== file.attachmentId,
                        ),
                      );
                      sendKey.current = null;
                    }}
                    className="p-2 text-primary"
                  >
                    Remove attachment
                  </button>
                </div>
              ))}
              <label className="sr-only" htmlFor="chat-message">
                Message
              </label>
              <textarea
                id="chat-message"
                disabled={busy}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  sendKey.current = null;
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    if (!generatingRun(run)) void send();
                  }
                }}
                maxLength={16000}
                rows={2}
                placeholder="Ask Fortuna…"
                className="w-full resize-none rounded-lg border border-stroke bg-transparent p-3 focus:outline-primary dark:border-stroke-dark"
              />
              <div className="flex items-center justify-between gap-3">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) void upload(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || files.length >= 5 || generatingRun(run)}
                  leftIcon={<Paperclip size={16} />}
                  onClick={() => fileInput.current?.click()}
                >
                  Attach statement
                </Button>
                {generatingRun(run) ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await chatApi(`/runs/${run!.id}/cancel`, {
                          method: "POST",
                          body: {},
                        });
                        await refresh();
                      })
                    }
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={busy || (!text.trim() && !files.length)}
                    leftIcon={<Send size={16} />}
                  >
                    Send message
                  </Button>
                )}
              </div>
            </form>
          </>
        )}
        {error && (
          <p role="alert" className="px-5 pb-4 text-red">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="px-5 pb-4">
            {notice}
          </p>
        )}
      </section>
      {proposal && (
        <ActionPreview
          proposal={proposal}
          onRefresh={async () => {
            const fresh = await chatApi<Proposal>(
              `/proposals/${proposal.id}/refresh`,
              { method: "POST", body: {} },
            );
            setProposal(fresh);
            await refresh();
          }}
          onClose={() => setProposal(null)}
          onDecide={async (decision, duplicateOverride) => {
            const result = await chatApi(
              `/proposals/${proposal.id}/${decision}`,
              { method: "POST", body: { duplicateOverride } },
            );
            await refresh();
            setNotice(
              result.status === "applied"
                ? "Changes applied"
                : result.status === "stale"
                  ? "Records changed. Ask for a fresh preview; no changes were applied."
                  : "Proposal rejected.",
            );
          }}
        />
      )}
    </div>
  );
}

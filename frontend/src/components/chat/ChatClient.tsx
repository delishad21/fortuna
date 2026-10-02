"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Paperclip,
  ArrowUp,
  Square,
  FileText,
  Upload,
  Loader2,
  Plus,
  Settings2,
  PanelLeft,
  X,
  Trash2,
  Bookmark,
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
  stepLabel,
  PendingAttachment,
  IMAGE_UPLOAD_TYPES,
  IMAGE_UPLOAD_BYTES,
  attachmentContentPath,
} from "@/lib/chat/client";
import { BrandMark } from "@/components/ui/Brand";
import { TransactionReviewEditor } from "./TransactionReviewEditor";
import { ActionPreview } from "./ActionPreview";
import { ChatTransactions, asTransactions } from "./ChatTransactions";
import { ChatComponent } from "./ChatComponents";
import { Markdown } from "./Markdown";
import { ActivitySteps } from "./ActivitySteps";
/** A sent image, fetched through the owner-scoped chat proxy. */
function AttachedImage({ id, filename }: { id: string; filename: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <p className="text-sm text-dark-5 dark:text-dark-6">
        Image: {filename} (expired)
      </p>
    );
  return (
    <a
      href={attachmentContentPath(id)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, uncacheable attachment */}
      <img
        src={attachmentContentPath(id)}
        alt={filename}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-64 max-w-full rounded-lg border border-stroke object-contain dark:border-stroke-dark"
      />
    </a>
  );
}
export function ChatClient() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [list, setList] = useState<ConversationSummary[]>([]),
    [id, setId] = useState<string | null>(null),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [text, setText] = useState(""),
    [files, setFiles] = useState<PendingAttachment[]>([]),
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
    inFlight = useRef(false),
    keepComposer = useRef(false),
    dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false),
    [seconds, setSeconds] = useState(0),
    [blockedHint, setBlockedHint] = useState(false);
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
    if (keepComposer.current) keepComposer.current = false;
    else {
      setFiles([]);
      setText("");
      sendKey.current = null;
    }
    void refresh().catch((e) => setError(e.message));
  }, [id, refresh]);
  const run = conversation?.runs[0];
  const running = generatingRun(run);
  useEffect(() => {
    setBlockedHint(false);
    if (!running) return;
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [running, run?.id]);
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
  /** The open conversation, or a new one when typing or dropping files on the landing screen. */
  async function ensureConversation() {
    if (id) return id;
    const created = await chatApi<Conversation>("/conversations", {
      method: "POST",
      body: {},
    });
    keepComposer.current = true;
    setId(created.id);
    void refreshList();
    return created.id;
  }
  async function send() {
    if ((!text.trim() && !files.length) || generatingRun(run)) return;
    await action(async () => {
      const target = await ensureConversation();
      sendKey.current ||= crypto.randomUUID();
      await chatApi(`/conversations/${target}/messages`, {
        method: "POST",
        body: {
          text,
          attachmentIds: files.map((f) => f.attachmentId),
          idempotencyKey: sendKey.current,
        },
      });
      setText("");
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setFiles([]);
      sendKey.current = null;
      setStream(emptyStream());
      await refresh();
      await refreshList();
    });
  }
  async function upload(chosen: File[]) {
    if (!chosen.length) return;
    const room = 5 - files.length;
    if (chosen.length > room) {
      setError(`You can attach ${room} more file${room === 1 ? "" : "s"}.`);
      return;
    }
    for (const file of chosen) {
      const image = file.type.startsWith("image/");
      if (image && !IMAGE_UPLOAD_TYPES.includes(file.type)) {
        setError(
          `${file.name}: use a PNG, JPEG, WebP or GIF image. HEIC photos aren't supported yet.`,
        );
        return;
      }
      if (file.size > (image ? IMAGE_UPLOAD_BYTES : 25 * 1024 * 1024)) {
        setError(
          `${file.name}: choose ${image ? "an image smaller than 10" : "a statement smaller than 25"} MB.`,
        );
        return;
      }
    }
    await action(async () => {
      const target = await ensureConversation();
      for (const file of chosen) {
        const form = new FormData();
        form.append("conversationId", target);
        form.append("file", file);
        const result = await chatApi("/files", { method: "POST", body: form });
        const preview =
          result.kind === "image" ? URL.createObjectURL(file) : undefined;
        setFiles((prev) => [
          ...prev.filter((f) => f.attachmentId !== result.attachmentId),
          { ...result, preview },
        ]);
        sendKey.current = null;
      }
    });
  }
  function removeFile(file: PendingAttachment) {
    if (file.preview) URL.revokeObjectURL(file.preview);
    setFiles((prev) =>
      prev.filter((f) => f.attachmentId !== file.attachmentId),
    );
    sendKey.current = null;
  }
  function block(value: Block, index: number, role = "assistant") {
    if (value.type === "review")
      return (
        <TransactionReviewEditor
          key={value.id}
          id={value.id}
          onSubmitted={refresh}
        />
      );
    if (value.type === "text")
      return role === "assistant" ? (
        <Markdown key={index} text={value.text} />
      ) : (
        <p
          key={index}
          className="whitespace-pre-wrap break-words leading-relaxed"
        >
          {value.text}
        </p>
      );
    if (value.type === "activity")
      return <ActivitySteps key={index} steps={value.steps} />;
    if (value.type === "attachment")
      return value.mediaType === "image" ? (
        <AttachedImage key={index} id={value.id} filename={value.filename} />
      ) : (
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
      if (value.title === "Submitted transaction review")
        return (
          <p
            key={index}
            className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
          >
            Submitted review: {value.data?.title || "Transactions"}
            {Array.isArray(value.data?.rows) &&
              ` · ${value.data.rows.length} rows`}
          </p>
        );
      // Raw tool data from older replies is for the model, not the reader.
      return null;
    }
    if (value.type === "memory")
      return (
        <p
          key={index}
          className="flex flex-wrap items-center gap-2 rounded-md bg-gray-1 px-3 py-2 text-sm dark:bg-dark-2"
        >
          <Bookmark size={14} className="text-primary" aria-hidden />
          <span className="font-medium">
            {value.action === "saved" ? "Remembered" : "Forgot"}:
          </span>
          <span
            className={
              value.action === "forgotten" ? "line-through text-dark-5" : ""
            }
          >
            {value.content}
          </span>
          <Link
            href="/settings?tab=ai#memories"
            className="ml-auto text-xs text-primary"
          >
            Manage
          </Link>
        </p>
      );
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
  const generating = generatingRun(run);
  const currentStep = [...stream.steps].reverse().find((s) => !s.done);
  const workingOn = currentStep
    ? stepLabel(currentStep.name)
    : stream.text
      ? "Writing a reply"
      : "Thinking";
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const fileTypes = [".pdf", ".csv", ".txt", ...IMAGE_UPLOAD_TYPES].join(",");
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      void upload(Array.from(e.dataTransfer.files));
    },
  };
  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="mx-auto w-full max-w-3xl px-4 pb-4 md:px-6"
    >
      <div className="rounded-xl border border-stroke bg-white shadow-sm transition-colors focus-within:border-primary dark:border-stroke-dark dark:bg-dark-2">
        {generating && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 border-b border-stroke px-4 py-2 text-sm dark:border-stroke-dark"
          >
            <Loader2
              size={15}
              className="shrink-0 animate-spin text-primary"
              aria-hidden
            />
            <span className="font-medium">Fortuna is working</span>
            <span className="min-w-0 truncate text-dark-5 dark:text-dark-6">
              · {workingOn}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-xs text-dark-5 dark:text-dark-6">
              {elapsed}
            </span>
          </div>
        )}
        {generating && blockedHint && (
          <p className="px-4 pt-2 text-xs text-dark-5 dark:text-dark-6">
            Your draft is kept. Send it when Fortuna finishes, or stop this
            reply first.
          </p>
        )}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {files.some((f) => f.preview) && (
              <ul className="flex flex-wrap gap-2" aria-label="Attached images">
                {files
                  .filter((f) => f.preview)
                  .map((file) => (
                    <li key={file.attachmentId} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                      <img
                        src={file.preview}
                        alt={file.filename}
                        className="h-14 w-14 rounded-lg border border-stroke object-cover dark:border-stroke-dark"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${file.filename}`}
                        onClick={() => removeFile(file)}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-dark p-0.5 text-white shadow"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {files
              .filter((f) => !f.preview)
              .map((file) => (
                <span
                  key={file.attachmentId}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-stroke bg-gray-1 py-1 pl-2 pr-1 text-xs dark:border-stroke-dark dark:bg-dark-3"
                >
                  <FileText size={13} aria-hidden />
                  <span className="truncate">{file.filename}</span>
                  <button
                    type="button"
                    aria-label="Remove attachment"
                    title={`Remove ${file.filename}`}
                    onClick={() => removeFile(file)}
                    className="rounded p-0.5 hover:bg-gray-2 dark:hover:bg-dark-2"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
          </div>
        )}
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
              if (generating) setBlockedHint(true);
              else void send();
            }
          }}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (!pasted.length) return;
            e.preventDefault();
            void upload(pasted);
          }}
          maxLength={16000}
          rows={2}
          placeholder={
            generating
              ? "Fortuna is working. You can draft your next message here."
              : id
                ? "Reply to Fortuna…"
                : "Ask Fortuna about your money…"
          }
          className="block max-h-60 min-h-[3rem] w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-dark-5 dark:placeholder:text-dark-6"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <input
            ref={fileInput}
            type="file"
            accept={fileTypes}
            multiple
            aria-label="Attach files"
            className="hidden"
            onChange={(e) => {
              void upload(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Attach file"
            title="Attach statements, screenshots or photos"
            disabled={busy || files.length >= 5 || generating}
            onClick={() => fileInput.current?.click()}
            className="rounded-lg p-2 text-dark-5 hover:bg-gray-2 hover:text-dark disabled:opacity-40 dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white"
          >
            <Paperclip size={18} />
          </button>
          <span className="hidden min-w-0 flex-1 truncate text-xs text-dark-5 dark:text-dark-6 sm:block">
            Enter to send · Shift+Enter for a new line · Drop files to attach
          </span>
          <span className="flex-1 sm:hidden" />
          {generating ? (
            <button
              type="button"
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
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-dark px-3.5 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-dark"
            >
              <Square size={12} fill="currentColor" aria-hidden />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send message"
              title="Send message"
              disabled={busy || (!text.trim() && !files.length)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 px-1 text-center text-[11px] text-dark-5 dark:text-dark-6">
        Fortuna only changes your records after you approve. Attachments expire
        after 7 days.
      </p>
    </form>
  );
  return (
    <div className="relative flex h-full min-h-0 text-dark dark:text-white">
      {historyOpen && (
        <aside
          className="absolute inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col border-r border-stroke bg-white shadow-lg dark:border-stroke-dark dark:bg-gray-dark lg:relative lg:shrink-0 lg:shadow-none"
          aria-label="Chat history"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold">Conversations</h2>
            <button
              className="rounded-lg p-1.5 hover:bg-gray-2 dark:hover:bg-dark-3"
              aria-label="Close chat history"
              onClick={() => setHistoryOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <nav
            aria-label="Conversations"
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2"
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
            className="m-2 flex items-center gap-2 rounded-lg border-t border-stroke p-3 text-sm dark:border-stroke-dark"
          >
            <Settings2 size={16} />
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
        className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gray-1 dark:bg-[#020d1a]"
        aria-label="Conversation"
        {...dropProps}
      >
        {dragging && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px]"
          >
            <p className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-primary shadow dark:bg-dark-2">
              <Upload size={16} aria-hidden />
              Drop files to attach
            </p>
          </div>
        )}
        <header className="flex shrink-0 items-center gap-2 border-b border-stroke bg-white px-3 py-2 dark:border-stroke-dark dark:bg-gray-dark">
          <button
            aria-label="Toggle chat history"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-2 dark:hover:bg-dark-3"
          >
            <PanelLeft size={18} className="shrink-0" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {conversation?.title || "New conversation"}
          </h2>
          {id && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void create()}
              leftIcon={<Plus size={16} />}
            >
              New chat
            </Button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!id ? (
            <div className="mx-auto w-full max-w-3xl space-y-8 px-4 pb-6 pt-12 md:px-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <BrandMark className="h-12 w-12" />
                <p className="text-xl font-semibold">
                  What would you like to understand?
                </p>
                <p className="max-w-md text-sm text-dark-5 dark:text-dark-6">
                  Ask about your spending, drop in a statement or screenshot, or
                  prepare changes to your transactions.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-dark-5 dark:text-dark-6">
                    Conversations
                  </h2>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void create()}
                    leftIcon={<Plus size={16} />}
                  >
                    New chat
                  </Button>
                </div>
                {list.length ? (
                  <nav
                    aria-label="Recent conversations"
                    className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke bg-white dark:divide-stroke-dark dark:border-stroke-dark dark:bg-gray-dark"
                  >
                    {list.map((item) => conversationItem(item))}
                  </nav>
                ) : (
                  <p className="text-sm text-dark-5 dark:text-dark-6">
                    Your conversations will appear here.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-6">
              {conversation?.messages.length === 0 && (
                <p className="text-center text-sm text-dark-5 dark:text-dark-6">
                  Try “How much did I spend on food last month?” or drop in a
                  statement to begin.
                </p>
              )}
              {conversation?.messages.map((message) =>
                message.role === "user" ? (
                  <article
                    key={message.id}
                    aria-label="Your message"
                    className="space-y-2 rounded-xl border border-stroke bg-white px-4 py-3 dark:border-stroke-dark dark:bg-dark-2"
                  >
                    {message.blocks.map((b, i) => block(b, i, "user"))}
                  </article>
                ) : (
                  <article
                    key={message.id}
                    aria-label="Fortuna"
                    className="flex gap-3"
                  >
                    <BrandMark className="mt-0.5 h-6 w-6 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-3">
                      {message.blocks.map((b, i) => block(b, i, "assistant"))}
                    </div>
                  </article>
                ),
              )}
              {run && ["queued", "running"].includes(run.status) && (
                <article className="flex gap-3" aria-label="Assistant response">
                  <BrandMark className="mt-0.5 h-6 w-6 shrink-0 animate-pulse" />
                  <div className="min-w-0 flex-1 space-y-3">
                    {stream.steps.length > 0 ? (
                      <ActivitySteps steps={stream.steps} live />
                    ) : (
                      <p
                        role="status"
                        className="text-sm capitalize text-dark-5 dark:text-dark-6"
                      >
                        {stream.activity}…
                      </p>
                    )}
                    {stream.text && <Markdown text={stream.text} />}
                    {stream.blocks
                      .filter(
                        (b) =>
                          b.type === "link" ||
                          b.type === "component" ||
                          b.type === "memory" ||
                          (b.type === "data" && asTransactions(b.data)),
                      )
                      .map((b, i) => block(b, i))}
                  </div>
                </article>
              )}
              {run?.status === "awaiting_confirmation" && (
                <p
                  role="status"
                  className="text-center text-xs text-dark-5 dark:text-dark-6"
                >
                  Review the pending changes, or send a new message to move on.
                </p>
              )}
              {run?.status === "failed" && (
                <p
                  role="alert"
                  className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red"
                >
                  {run.error ||
                    "The assistant could not finish. You can try again."}
                </p>
              )}
              <div ref={bottom} />
            </div>
          )}
        </div>
        {(error || notice) && (
          <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
            {error && (
              <p role="alert" className="pb-2 text-sm text-red">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="pb-2 text-sm">
                {notice}
              </p>
            )}
          </div>
        )}
        <div className="shrink-0 pt-2">{composer}</div>
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

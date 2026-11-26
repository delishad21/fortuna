"use client";

import { useEffect, useState } from "react";
import { BellRing, Mail, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  createSource,
  deleteSource,
  getSourceSuggestions,
  updateSource,
} from "@/app/actions/sources";
import { cardDisplay, type Account } from "@/lib/accountTypes";
import {
  SOURCE_CHANNELS,
  SOURCE_KINDS,
  joinList,
  sendersLabel,
  sendersPlaceholder,
  sourceKindLabel,
  sourceTarget,
  sourceTitle,
  splitList,
  type SourceChannel,
  type SourceInput,
  type SourceKind,
  type SourceSuggestion,
  type TransactionSource,
} from "@/lib/sourceTypes";

interface ManageSourcesModalProps {
  isOpen: boolean;
  sources: TransactionSource[];
  accounts: Account[];
  onClose: () => void;
  /** Reloads sources after a change. */
  onChanged: () => Promise<void>;
  onError: (title: string, message: string) => void;
  onConfirm: (title: string, message: string, action: () => Promise<void>) => void;
}

const fieldLabel =
  "text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";

type Draft = {
  kind: SourceKind;
  /** "account:<id>" or "card:<id>". */
  target: string;
  name: string;
  senders: string;
  subjectPatterns: string;
  textPatterns: string;
  identifiers: string;
  channel: SourceChannel;
  enabled: boolean;
  notes: string;
};

const emptyDraft = (accounts: Account[]): Draft => ({
  kind: "notification",
  target: accounts[0] ? `account:${accounts[0].id}` : "",
  name: "",
  senders: "",
  subjectPatterns: "",
  textPatterns: "",
  identifiers: "",
  channel: "main",
  enabled: false,
  notes: "",
});

const draftOf = (source: TransactionSource | SourceSuggestion): Draft => ({
  kind: source.kind,
  target: source.cardId ? `card:${source.cardId}` : `account:${source.accountId}`,
  name: source.name || "",
  senders: joinList(source.senders),
  subjectPatterns: joinList(source.subjectPatterns),
  textPatterns: joinList(source.textPatterns),
  identifiers: joinList(source.identifiers),
  channel: source.channel,
  // A suggestion is never turned on for the user.
  enabled: "enabled" in source ? source.enabled : false,
  notes: source.notes || "",
});

const inputOf = (draft: Draft): SourceInput => {
  const [type, id] = draft.target.split(":");
  return {
    kind: draft.kind,
    ...(type === "card" ? { cardId: id } : { accountId: id, cardId: null }),
    name: draft.name.trim() || null,
    senders: splitList(draft.senders),
    subjectPatterns: draft.kind === "email" ? splitList(draft.subjectPatterns) : [],
    textPatterns: splitList(draft.textPatterns),
    identifiers: splitList(draft.identifiers),
    channel: draft.channel,
    enabled: draft.enabled,
    notes: draft.notes.trim() || null,
  };
};

export function SourceKindIcon({ kind, className = "h-4 w-4" }: { kind: SourceKind; className?: string }) {
  return kind === "email" ? <Mail className={className} /> : <BellRing className={className} />;
}

export function ManageSourcesModal({
  isOpen,
  sources,
  accounts,
  onClose,
  onChanged,
  onError,
  onConfirm,
}: ManageSourcesModalProps) {
  const openAccounts = accounts.filter((account) => !account.archived);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [suggestions, setSuggestions] = useState<SourceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    getSourceSuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  }, [isOpen, sources]);

  if (!isOpen) return null;

  const run = async (title: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      await onChanged();
      return true;
    } catch (error) {
      onError(title, error instanceof Error ? error.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    const input = inputOf(editing.draft);
    const ok = await run("Save Failed", () =>
      editing.id ? updateSource(editing.id, input) : createSource(input),
    );
    if (ok) setEditing(null);
  };

  const byAccount = openAccounts
    .map((account) => ({ account, sources: sources.filter((source) => source.accountId === account.id) }))
    .filter((group) => group.sources.length > 0);
  const elsewhere = sources.filter((source) => !openAccounts.some((account) => account.id === source.accountId));

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-2 rounded-lg shadow-[var(--shadow-card-2)] w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-stroke dark:border-dark-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-dark dark:text-white">
                Manage Sources
              </h2>
              <p className="text-sm text-dark-5 dark:text-dark-6 mt-0.5">
                Bank app notifications and alert emails the assistant watches
                for each account or card. Only enabled sources are watched.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {editing ? (
            <SourceForm
              draft={editing.draft}
              accounts={openAccounts}
              isNew={!editing.id}
              busy={busy}
              onChange={(draft) => setEditing({ ...editing, draft })}
              onCancel={() => setEditing(null)}
              onSave={save}
            />
          ) : (
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                disabled={openAccounts.length === 0}
                onClick={() => setEditing({ id: null, draft: emptyDraft(openAccounts) })}
              >
                Add Source
              </Button>
            </div>
          )}

          {!editing && suggestions.length > 0 && (
            <div className="space-y-3">
              <h3 className={fieldLabel}>Suggested</h3>
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.key}
                  className="rounded-lg border border-dashed border-stroke dark:border-dark-3 p-4 flex flex-wrap items-center gap-3"
                >
                  <SourceKindIcon kind={suggestion.kind} className="h-5 w-5 text-dark-5 dark:text-dark-6" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-dark dark:text-white">
                      {suggestion.name} · {suggestion.accountName}
                    </div>
                    <div className="text-xs text-dark-5 dark:text-dark-6">
                      {suggestion.senders.join(", ")} · {suggestion.why}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={() => setEditing({ id: null, draft: draftOf(suggestion) })}
                  >
                    Add…
                  </Button>
                </div>
              ))}
            </div>
          )}

          {byAccount.map((group) => (
            <div key={group.account.id} className="space-y-2">
              <h3 className={fieldLabel}>{group.account.name}</h3>
              {group.sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  busy={busy}
                  onEdit={() => setEditing({ id: source.id, draft: draftOf(source) })}
                  onToggle={() =>
                    void run("Save Failed", () => updateSource(source.id, { enabled: !source.enabled }))
                  }
                  onDelete={() =>
                    onConfirm(
                      "Delete Source",
                      `Delete ${sourceTitle(source)}? The assistant stops watching it; transactions it reported stay.`,
                      async () => {
                        await run("Delete Failed", () => deleteSource(source.id));
                      },
                    )
                  }
                />
              ))}
            </div>
          ))}
          {elsewhere.length > 0 && (
            <div className="space-y-2">
              <h3 className={fieldLabel}>On archived accounts</h3>
              {elsewhere.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  busy={busy}
                  onEdit={() => setEditing({ id: source.id, draft: draftOf(source) })}
                  onToggle={() =>
                    void run("Save Failed", () => updateSource(source.id, { enabled: !source.enabled }))
                  }
                  onDelete={() =>
                    void run("Delete Failed", () => deleteSource(source.id))
                  }
                />
              ))}
            </div>
          )}
          {sources.length === 0 && !editing && (
            <div className="text-sm text-dark-5 dark:text-dark-6">
              No sources yet.
            </div>
          )}
        </div>

        <div className="p-6 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function SourceRow({
  source,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  source: TransactionSource;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-stroke dark:border-dark-3 p-4 flex flex-wrap items-center gap-3">
      <SourceKindIcon kind={source.kind} className="h-5 w-5 text-dark-5 dark:text-dark-6" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-dark dark:text-white">
            {sourceTitle(source)}
          </span>
          <span className="rounded-full border border-stroke dark:border-dark-3 px-2 py-0.5 text-xs text-dark-5 dark:text-dark-6">
            {source.channel === "backup" ? "Backup" : "Main"}
          </span>
          {!source.enabled && (
            <span className="rounded-full border border-stroke dark:border-dark-3 px-2 py-0.5 text-xs text-dark-5 dark:text-dark-6">
              Off
            </span>
          )}
        </div>
        <div className="text-xs text-dark-5 dark:text-dark-6 truncate">
          {sourceKindLabel(source.kind)} · {sourceTarget(source)} · {source.senders.join(", ")}
          {source.identifiers.length ? ` · ${source.identifiers.join(", ")}` : ""}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-dark dark:text-white">
        <Checkbox
          checked={source.enabled}
          disabled={busy}
          onChange={onToggle}
          aria-label={source.enabled ? "Turn off" : "Turn on"}
        />
        Enabled
      </label>
      <Button variant="ghost" size="sm" leftIcon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
        Edit
      </Button>
      <button
        type="button"
        aria-label={`Delete ${sourceTitle(source)}`}
        onClick={onDelete}
        disabled={busy}
        className="h-9 w-9 shrink-0 rounded-lg border border-stroke dark:border-dark-3 text-red hover:border-red transition-colors flex items-center justify-center"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function SourceForm({
  draft,
  accounts,
  isNew,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  accounts: Account[];
  isNew: boolean;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const targets = accounts.flatMap((account) => [
    { value: `account:${account.id}`, label: account.name, color: account.color },
    ...account.cards.map((card) => ({
      value: `card:${card.id}`,
      label: `${account.name} · ${cardDisplay(card)}`,
      color: account.color,
    })),
  ]);
  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <div className="grid gap-1.5">
      <label className={fieldLabel}>{label}</label>
      {input}
      {hint && <p className="text-xs text-dark-5 dark:text-dark-6">{hint}</p>}
    </div>
  );
  return (
    <div className="rounded-lg border border-stroke dark:border-dark-3 p-4 grid gap-4">
      <label className={fieldLabel}>{isNew ? "New source" : "Edit source"}</label>
      <div className="grid gap-4 sm:grid-cols-2">
        {field(
          "Kind",
          <Select
            value={draft.kind}
            options={SOURCE_KINDS.map((option) => ({ ...option }))}
            onChange={(kind) => set({ kind: kind as SourceKind })}
            menuStrategy="fixed"
            menuPlacement="auto"
          />,
        )}
        {field(
          "Reports",
          <Select
            value={draft.target}
            options={targets}
            onChange={(target) => set({ target })}
            menuStrategy="fixed"
            menuPlacement="auto"
          />,
          "The account, or one of its cards.",
        )}
        {field(
          "Name",
          <TextInput
            aria-label="Name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={draft.kind === "email" ? "e.g. UOB alert emails" : "e.g. UOB TMRW app"}
            maxLength={80}
          />,
        )}
        {field(
          "Channel",
          <Select
            value={draft.channel}
            options={SOURCE_CHANNELS.map((option) => ({ ...option }))}
            onChange={(channel) => set({ channel: channel as SourceChannel })}
            menuStrategy="fixed"
            menuPlacement="auto"
          />,
          "When the main and backup channels report the same purchase, it is saved once.",
        )}
      </div>
      {field(
        sendersLabel(draft.kind),
        <TextInput
          aria-label={sendersLabel(draft.kind)}
          value={draft.senders}
          onChange={(e) => set({ senders: e.target.value })}
          placeholder={sendersPlaceholder(draft.kind)}
        />,
        "Separate several with commas.",
      )}
      {draft.kind === "email" &&
        field(
          "Subject contains",
          <TextInput
            aria-label="Subject contains"
            value={draft.subjectPatterns}
            onChange={(e) => set({ subjectPatterns: e.target.value })}
            placeholder="e.g. Transaction Alerts"
          />,
          "Optional. Any of them, separated by commas.",
        )}
      <div className="grid gap-4 sm:grid-cols-2">
        {field(
          "Text contains",
          <TextInput
            aria-label="Text contains"
            value={draft.textPatterns}
            onChange={(e) => set({ textPatterns: e.target.value })}
            placeholder="e.g. You made a payment"
          />,
          "Optional.",
        )}
        {field(
          "Identifiers",
          <TextInput
            aria-label="Identifiers"
            value={draft.identifiers}
            onChange={(e) => set({ identifiers: e.target.value })}
            placeholder="e.g. card ending 1234"
          />,
          "What in a message ties it to this account or card.",
        )}
      </div>
      {field(
        "Notes",
        <TextInput
          aria-label="Notes"
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
          maxLength={1000}
        />,
      )}
      <label className="flex items-center gap-2 text-sm text-dark dark:text-white">
        <Checkbox checked={draft.enabled} onChange={(enabled) => set({ enabled })} aria-label="Enabled" />
        Enabled: the assistant watches it
      </label>
      <div className="flex items-center justify-between">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          disabled={busy || !draft.target || splitList(draft.senders).length === 0}
        >
          {isNew ? "Add Source" : "Save"}
        </Button>
      </div>
    </div>
  );
}

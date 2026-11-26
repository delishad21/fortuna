"use client";

import { useState } from "react";
import {
  WalletCards,
  Plus,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  Archive,
  ArchiveRestore,
  Merge,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { ColorSelect } from "@/components/ui/ColorSelect";
import { Select } from "@/components/ui/Select";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import {
  addAccountIdentifier,
  addCard,
  confirmAccount,
  createAccount,
  deleteAccount,
  deleteCard,
  mergeAccount,
  removeAccountIdentifier,
  setAccountImage,
  setCardImage,
  updateAccount,
  updateCard,
} from "@/app/actions/accounts";
import {
  ACCOUNT_TYPES,
  CARD_NETWORKS,
  autoCreatedFromDisplay,
  cardDisplay,
  type Account,
  type AccountCard,
  type AccountType,
  type CardNetwork,
} from "@/lib/accountTypes";

interface ManageAccountsModalProps {
  isOpen: boolean;
  accounts: Account[];
  onClose: () => void;
  /** Reloads accounts (and identifiers) after a change. */
  onChanged: () => Promise<void>;
  onError: (title: string, message: string) => void;
  onConfirm: (title: string, message: string, action: () => Promise<void>) => void;
}

const fieldLabel =
  "text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";
const iconButton =
  "h-9 w-9 shrink-0 rounded-lg border border-stroke dark:border-dark-3 text-red hover:border-red hover:text-red-light transition-colors flex items-center justify-center";

const typeLabel = (type: AccountType) =>
  ACCOUNT_TYPES.find((option) => option.value === type)?.label || type;
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

export function AccountAvatar({
  account,
  size = 36,
}: {
  account: Pick<Account, "color" | "imageUrl">;
  size?: number;
}) {
  if (account.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={account.imageUrl}
        alt=""
        className="shrink-0 rounded-full border border-stroke object-cover dark:border-dark-3"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        color: account.color,
        backgroundColor: `color-mix(in srgb, ${account.color} 14%, transparent)`,
      }}
    >
      <WalletCards style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

export function ManageAccountsModal({
  isOpen,
  accounts,
  onClose,
  onChanged,
  onError,
  onConfirm,
}: ManageAccountsModalProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAccount, setNewAccount] = useState({
    name: "",
    institution: "",
    type: "savings" as AccountType,
    color: "#6366f1",
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  /** Runs a change, reloads, and shows the server's message if it fails. */
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

  const review = accounts.filter((account) => account.autoCreated && !account.archived);
  const active = accounts.filter((account) => !account.autoCreated && !account.archived);
  const archived = accounts.filter((account) => account.archived);

  const handleCreate = async () => {
    if (!newAccount.name.trim()) return;
    const ok = await run("Create Failed", () =>
      createAccount({
        name: newAccount.name.trim(),
        institution: newAccount.institution.trim() || null,
        type: newAccount.type,
        color: newAccount.color,
      }),
    );
    if (ok) {
      setNewAccount({ name: "", institution: "", type: "savings", color: "#6366f1" });
      setShowAddForm(false);
    }
  };

  const renderAccount = (account: Account) => (
    <AccountPanel
      key={account.id}
      account={account}
      accounts={accounts}
      expanded={expandedId === account.id}
      busy={busy}
      onToggle={() =>
        setExpandedId((current) => (current === account.id ? null : account.id))
      }
      run={run}
      reload={onChanged}
      onConfirm={onConfirm}
    />
  );

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-2 rounded-lg shadow-[var(--shadow-card-2)] w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-stroke dark:border-dark-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-light-5 dark:bg-green-dark/40 text-green flex items-center justify-center">
              <WalletCards className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-dark dark:text-white">
                Manage Accounts
              </h2>
              <p className="text-sm text-dark-5 dark:text-dark-6 mt-0.5">
                Accounts, their cards, and the statement identifiers imports
                match on.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {showAddForm ? (
            <div className="rounded-lg border border-stroke dark:border-dark-3 p-4">
              <div className="grid gap-4">
                <label className={fieldLabel}>New account</label>
                <div className="flex flex-wrap items-center gap-3">
                  <ColorSelect
                    value={newAccount.color}
                    onChange={(color) => setNewAccount({ ...newAccount, color })}
                  />
                  <TextInput
                    aria-label="Name"
                    value={newAccount.name}
                    onChange={(e) =>
                      setNewAccount({ ...newAccount, name: e.target.value })
                    }
                    placeholder="Name, e.g. UOB One"
                    maxLength={80}
                    className="flex-1 min-w-[160px]"
                  />
                  <TextInput
                    aria-label="Institution"
                    value={newAccount.institution}
                    onChange={(e) =>
                      setNewAccount({ ...newAccount, institution: e.target.value })
                    }
                    placeholder="Institution, e.g. UOB"
                    className="flex-1 min-w-[140px]"
                  />
                  <Select
                    value={newAccount.type}
                    options={ACCOUNT_TYPES.map((option) => ({ ...option }))}
                    onChange={(type) =>
                      setNewAccount({ ...newAccount, type: type as AccountType })
                    }
                    menuStrategy="fixed"
                    menuPlacement="auto"
                    className="w-40"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowAddForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={handleCreate}
                    disabled={busy || !newAccount.name.trim()}
                  >
                    Add Account
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setShowAddForm(true)}
              >
                Add Account
              </Button>
            </div>
          )}

          {review.length > 0 && (
            <div className="space-y-3">
              <h3 className={fieldLabel}>Needs review</h3>
              {review.map((account) => (
                <ReviewRow
                  key={account.id}
                  account={account}
                  targets={active}
                  busy={busy}
                  run={run}
                  onEdit={() => setExpandedId(account.id)}
                  expanded={expandedId === account.id}
                  panel={renderAccount(account)}
                />
              ))}
            </div>
          )}

          <div className="space-y-3">
            {review.length > 0 && <h3 className={fieldLabel}>Accounts</h3>}
            {active.map(renderAccount)}
            {active.length === 0 && (
              <div className="text-sm text-dark-5 dark:text-dark-6">
                No accounts yet.
              </div>
            )}
          </div>

          {archived.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowArchived((prev) => !prev)}
                className={`${fieldLabel} flex items-center gap-1 hover:text-dark dark:hover:text-white`}
              >
                {showArchived ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Archived ({archived.length})
              </button>
              {showArchived && archived.map(renderAccount)}
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

type Run = (title: string, work: () => Promise<unknown>) => Promise<boolean>;

/** An automatically created account: keep it, or merge it into an existing one. */
function ReviewRow({
  account,
  targets,
  busy,
  run,
  onEdit,
  expanded,
  panel,
}: {
  account: Account;
  targets: Account[];
  busy: boolean;
  run: Run;
  onEdit: () => void;
  expanded: boolean;
  panel: React.ReactNode;
}) {
  const [merging, setMerging] = useState(false);
  const [targetId, setTargetId] = useState("");

  if (expanded) return <>{panel}</>;

  return (
    <div className="rounded-lg border border-orange/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <AccountAvatar account={account} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-dark dark:text-white">
            {account.name}
          </div>
          <div className="text-xs text-dark-5 dark:text-dark-6">
            {autoCreatedFromDisplay(account.autoCreatedFrom)} ·{" "}
            {plural(account.transactionCount, "transaction")}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Merge className="h-4 w-4" />}
          onClick={() => setMerging((prev) => !prev)}
          disabled={targets.length === 0}
        >
          Merge into…
        </Button>
        <Button
          variant="success"
          size="sm"
          leftIcon={<Check className="h-4 w-4" />}
          disabled={busy}
          onClick={() => void run("Keep Failed", () => confirmAccount(account.id))}
        >
          Keep
        </Button>
      </div>
      {merging && (
        <MergePicker
          targets={targets}
          targetId={targetId}
          setTargetId={setTargetId}
          busy={busy}
          onMerge={() =>
            void run("Merge Failed", () => mergeAccount(account.id, targetId))
          }
          onCancel={() => setMerging(false)}
        />
      )}
    </div>
  );
}

function MergePicker({
  targets,
  targetId,
  setTargetId,
  busy,
  onMerge,
  onCancel,
}: {
  targets: Account[];
  targetId: string;
  setTargetId: (id: string) => void;
  busy: boolean;
  onMerge: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Select
        value={targetId}
        options={targets.map((target) => ({
          value: target.id,
          label: target.name,
          color: target.color,
        }))}
        onChange={setTargetId}
        placeholder="Choose an account"
        size="sm"
        menuStrategy="fixed"
        menuPlacement="auto"
        className="w-64"
      />
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={busy || !targetId}
        onClick={onMerge}
      >
        Merge
      </Button>
      <p className="w-full text-xs text-dark-5 dark:text-dark-6">
        Its identifiers, cards and transactions move to the chosen account, and
        this account is deleted.
      </p>
    </div>
  );
}

function AccountPanel({
  account,
  accounts,
  expanded,
  busy,
  onToggle,
  run,
  reload,
  onConfirm,
}: {
  account: Account;
  accounts: Account[];
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  run: Run;
  reload: () => Promise<void>;
  onConfirm: ManageAccountsModalProps["onConfirm"];
}) {
  const [draft, setDraft] = useState({
    name: account.name,
    institution: account.institution || "",
    type: account.type,
    color: account.color,
  });
  const [newIdentifier, setNewIdentifier] = useState("");
  const [merging, setMerging] = useState(false);
  const [targetId, setTargetId] = useState("");

  const dirty =
    draft.name !== account.name ||
    draft.institution !== (account.institution || "") ||
    draft.type !== account.type ||
    draft.color !== account.color;
  const identifierOwner = newIdentifier.trim()
    ? accounts.find(
        (other) =>
          other.id !== account.id &&
          other.identifiers.some((item) => item.identifier === newIdentifier.trim()),
      )
    : undefined;
  const mergeTargets = accounts.filter(
    (other) => other.id !== account.id && !other.archived,
  );

  const summary = [
    account.institution,
    typeLabel(account.type),
    plural(account.transactionCount, "transaction"),
    account.cards.length ? plural(account.cards.length, "card") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border border-stroke dark:border-dark-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-gray-1 dark:hover:bg-dark-3/50 rounded-lg"
      >
        <AccountAvatar account={account} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-dark dark:text-white">
            {account.name}
          </div>
          <div className="truncate text-xs text-dark-5 dark:text-dark-6">
            {summary}
          </div>
          {!expanded && account.identifiers.length > 0 && (
            <div className="mt-1 truncate text-xs text-dark-5 dark:text-dark-6">
              {account.identifiers.map((item) => item.identifier).join(", ")}
            </div>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-dark-5 dark:text-dark-6" />
        ) : (
          <ChevronRight className="h-4 w-4 text-dark-5 dark:text-dark-6" />
        )}
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-stroke p-4 dark:border-dark-3">
          {account.autoCreated && (
            <p className="text-xs text-dark-5 dark:text-dark-6">
              {autoCreatedFromDisplay(account.autoCreatedFrom)}
            </p>
          )}

          <div className="grid gap-2">
            <label className={fieldLabel}>Details</label>
            <div className="flex flex-wrap items-center gap-3">
              <ColorSelect
                value={draft.color}
                onChange={(color) => setDraft({ ...draft, color })}
              />
              <TextInput
                aria-label="Name"
                value={draft.name}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Name"
                className="flex-1 min-w-[160px]"
              />
              <TextInput
                aria-label="Institution"
                value={draft.institution}
                onChange={(e) => setDraft({ ...draft, institution: e.target.value })}
                placeholder="Institution"
                className="flex-1 min-w-[140px]"
              />
              <Select
                value={draft.type}
                options={ACCOUNT_TYPES.map((option) => ({ ...option }))}
                onChange={(type) => setDraft({ ...draft, type: type as AccountType })}
                menuStrategy="fixed"
                menuPlacement="auto"
                className="w-40"
              />
              <Button
                variant={dirty ? "success" : "secondary"}
                size="sm"
                disabled={busy || !dirty || !draft.name.trim()}
                onClick={() =>
                  void run("Save Failed", () =>
                    updateAccount(account.id, {
                      name: draft.name.trim(),
                      institution: draft.institution.trim() || null,
                      type: draft.type,
                      color: draft.color,
                    }),
                  )
                }
              >
                Save
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <label className={fieldLabel}>Image</label>
            <ImageUploadField
              imageUrl={account.imageUrl}
              fallback={<AccountAvatar account={account} size={48} />}
              onUpload={async (base64) => {
                await setAccountImage(account.id, base64);
                await reload();
              }}
              onRemove={async () => {
                await setAccountImage(account.id, null);
                await reload();
              }}
            />
          </div>

          <div className="grid gap-2">
            <label className={fieldLabel}>Statement identifiers</label>
            <div className="flex flex-wrap gap-2">
              {account.identifiers.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-full border border-stroke py-1 pl-3 pr-1 text-sm text-dark dark:border-dark-3 dark:text-white"
                >
                  {item.identifier}
                  <button
                    type="button"
                    onClick={() =>
                      void run("Remove Failed", () => removeAccountIdentifier(item.id))
                    }
                    disabled={busy}
                    className="rounded-full p-0.5 text-dark-5 hover:text-red dark:text-dark-6"
                    title="Remove identifier"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
              {account.identifiers.length === 0 && (
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  No identifiers.
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <TextInput
                aria-label="New identifier"
                value={newIdentifier}
                onChange={(e) => setNewIdentifier(e.target.value)}
                placeholder="Identifier, e.g. 21431251342"
                className="flex-1"
              />
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                disabled={busy || !newIdentifier.trim()}
                onClick={async () => {
                  const ok = await run("Add Failed", () =>
                    addAccountIdentifier(account.id, newIdentifier.trim()),
                  );
                  if (ok) setNewIdentifier("");
                }}
              >
                {identifierOwner ? "Move here" : "Add"}
              </Button>
            </div>
            {identifierOwner && (
              <p className="text-xs text-orange">
                This identifier belongs to {identifierOwner.name}. Adding it moves
                it and its transactions here.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <label className={fieldLabel}>Cards</label>
            {account.cards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                busy={busy}
                run={run}
                reload={reload}
                onConfirm={onConfirm}
              />
            ))}
            <NewCardRow accountId={account.id} busy={busy} run={run} />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-stroke pt-4 dark:border-dark-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              leftIcon={
                account.archived ? (
                  <ArchiveRestore className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )
              }
              onClick={() =>
                void run(account.archived ? "Unarchive Failed" : "Archive Failed", () =>
                  updateAccount(account.id, { archived: !account.archived }),
                )
              }
            >
              {account.archived ? "Unarchive" : "Archive"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Merge className="h-4 w-4" />}
              disabled={mergeTargets.length === 0}
              onClick={() => setMerging((prev) => !prev)}
            >
              Merge into…
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              leftIcon={<Trash2 className="h-4 w-4" />}
              onClick={() =>
                onConfirm(
                  "Delete Account",
                  `Delete ${account.name}? Accounts with transactions can't be deleted; archive or merge them instead.`,
                  async () => {
                    await run("Delete Failed", () => deleteAccount(account.id));
                  },
                )
              }
            >
              Delete
            </Button>
          </div>
          {merging && (
            <MergePicker
              targets={mergeTargets}
              targetId={targetId}
              setTargetId={setTargetId}
              busy={busy}
              onMerge={() =>
                void run("Merge Failed", () => mergeAccount(account.id, targetId))
              }
              onCancel={() => setMerging(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

const networkOptions = [
  { value: "", label: "No network" },
  ...CARD_NETWORKS.map((option) => ({ ...option })),
];

function CardRow({
  card,
  busy,
  run,
  reload,
  onConfirm,
}: {
  card: AccountCard;
  busy: boolean;
  run: Run;
  reload: () => Promise<void>;
  onConfirm: ManageAccountsModalProps["onConfirm"];
}) {
  const [draft, setDraft] = useState({
    last4: card.last4,
    network: card.network || "",
    nickname: card.nickname || "",
  });
  const dirty =
    draft.last4 !== card.last4 ||
    draft.network !== (card.network || "") ||
    draft.nickname !== (card.nickname || "");

  return (
    <div className="rounded-lg border border-stroke p-3 dark:border-dark-3">
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          aria-label="Last 4 digits"
          value={draft.last4}
          inputMode="numeric"
          maxLength={4}
          onChange={(e) =>
            setDraft({ ...draft, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })
          }
          placeholder="Last 4"
          className="w-24"
        />
        <Select
          value={draft.network}
          options={networkOptions}
          onChange={(network) => setDraft({ ...draft, network })}
          menuStrategy="fixed"
          menuPlacement="auto"
          className="w-40"
        />
        <TextInput
          aria-label="Nickname"
          value={draft.nickname}
          onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
          placeholder="Nickname"
          className="flex-1 min-w-[140px]"
        />
        <Button
          variant={dirty ? "success" : "secondary"}
          size="sm"
          disabled={busy || !dirty || draft.last4.length !== 4}
          onClick={() =>
            void run("Save Failed", () =>
              updateCard(card.id, {
                last4: draft.last4,
                network: (draft.network || null) as CardNetwork | null,
                nickname: draft.nickname.trim() || null,
              }),
            )
          }
        >
          Save
        </Button>
        <button
          type="button"
          onClick={() =>
            onConfirm("Delete Card", `Delete ${cardDisplay(card)}?`, async () => {
              await run("Delete Failed", () => deleteCard(card.id));
            })
          }
          className={iconButton}
          title="Delete card"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3">
        <ImageUploadField
          imageUrl={card.imageUrl}
          canRemove={Boolean(card.imageId)}
          size={36}
          fallback={
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stroke text-xs text-dark-5 dark:border-dark-3 dark:text-dark-6">
              {card.last4}
            </span>
          }
          onUpload={async (base64) => {
            await setCardImage(card.id, base64);
            await reload();
          }}
          onRemove={async () => {
            await setCardImage(card.id, null);
            await reload();
          }}
        />
        {!card.imageId && card.imageUrl && (
          <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
            Uses the account&apos;s image.
          </p>
        )}
      </div>
    </div>
  );
}

function NewCardRow({
  accountId,
  busy,
  run,
}: {
  accountId: string;
  busy: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState({ last4: "", network: "", nickname: "" });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <TextInput
        aria-label="New card last 4 digits"
        value={draft.last4}
        inputMode="numeric"
        maxLength={4}
        onChange={(e) =>
          setDraft({ ...draft, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })
        }
        placeholder="Last 4"
        className="w-24"
      />
      <Select
        value={draft.network}
        options={networkOptions}
        onChange={(network) => setDraft({ ...draft, network })}
        menuStrategy="fixed"
        menuPlacement="auto"
        className="w-40"
      />
      <TextInput
        aria-label="New card nickname"
        value={draft.nickname}
        onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
        placeholder="Nickname"
        className="flex-1 min-w-[140px]"
      />
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<Plus className="h-4 w-4" />}
        disabled={busy || draft.last4.length !== 4}
        onClick={async () => {
          const ok = await run("Add Card Failed", () =>
            addCard(accountId, {
              last4: draft.last4,
              network: (draft.network || null) as CardNetwork | null,
              nickname: draft.nickname.trim() || null,
            }),
          );
          if (ok) setDraft({ last4: "", network: "", nickname: "" });
        }}
      >
        Add Card
      </Button>
    </div>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import {
  Archive,
  ChevronRight,
  Clock,
  Code2,
  FileText,
  Landmark,
  ListChecks,
  Receipt,
  RefreshCw,
  Tag,
  Trash2,
  Upload,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  NEEDS_APPROVAL,
  Proposal,
  proposalState,
  proposalSummary,
  timeLeft,
} from "@/lib/chat/client";

const ICONS: Record<string, LucideIcon> = {
  edit_transactions: ListChecks,
  create_account: Landmark,
  create_category: Tag,
  update_import_rule: Wand2,
  retain_fixture: Archive,
  commit_drafts: Upload,
  restage_draft: RefreshCw,
  discard_draft: Trash2,
};
const STATE_STYLE: Record<string, string> = {
  [NEEDS_APPROVAL]: "bg-primary text-white",
  Applied: "bg-green/10 text-green",
};

function CardBody({
  Icon,
  title,
  detail,
  color,
  state,
}: {
  Icon: LucideIcon;
  title: string;
  detail?: string;
  color?: string | null;
  state?: string;
}) {
  return (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon size={17} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {detail && (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-dark-5 dark:text-dark-6">
            {color && (
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
            )}
            <span className="truncate">{detail}</span>
          </span>
        )}
        {state && (
          <span className="mt-0.5 block text-xs font-medium text-dark-5 dark:text-dark-6 sm:hidden">
            {state}
          </span>
        )}
      </span>
      {state && (
        <span
          className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline ${
            STATE_STYLE[state] ||
            "bg-gray-2 text-dark-5 dark:bg-dark-3 dark:text-dark-6"
          }`}
        >
          {state}
        </span>
      )}
      <ChevronRight size={16} aria-hidden className="shrink-0 text-dark-5" />
    </>
  );
}

const CARD =
  "flex w-full max-w-2xl items-center gap-3 rounded-xl border border-stroke bg-white px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-gray-1 disabled:opacity-60 dark:border-stroke-dark dark:bg-dark-2 dark:hover:bg-dark-3";

/** A proposal the user can open, approve or reject. */
export function ProposalCard({
  proposal,
  label,
  onOpen,
  onReject,
}: {
  proposal: Proposal | undefined;
  label: string;
  onOpen: (proposal: Proposal) => void;
  onReject?: (proposal: Proposal) => Promise<void>;
}) {
  if (!proposal)
    return (
      <button type="button" disabled className={CARD} aria-label={label}>
        <CardBody
          Icon={ListChecks}
          title={label}
          detail="No longer available"
        />
      </button>
    );
  const summary = proposalSummary(proposal);
  const Icon =
    ICONS[proposal.kind] ||
    (proposal.kind.includes("parser") ? Code2 : ListChecks);
  if (proposalState(proposal).pending)
    return (
      <PendingProposalCard
        proposal={proposal}
        Icon={Icon}
        summary={summary}
        onOpen={onOpen}
        onReject={onReject}
      />
    );
  return (
    <button
      type="button"
      className={CARD}
      aria-label={`${label}: ${summary.title}, ${summary.detail}. ${summary.state}`}
      onClick={() => onOpen(proposal)}
    >
      <CardBody Icon={Icon} {...summary} />
    </button>
  );
}

/** Waiting for the user: set apart from link cards, with its actions on the card. */
function PendingProposalCard({
  proposal,
  Icon,
  summary,
  onOpen,
  onReject,
}: {
  proposal: Proposal;
  Icon: LucideIcon;
  summary: ReturnType<typeof proposalSummary>;
  onOpen: (proposal: Proposal) => void;
  onReject?: (proposal: Proposal) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const left = timeLeft(proposal.expiresAt);
  return (
    <section
      data-approval={proposal.id}
      tabIndex={-1}
      aria-label={`${NEEDS_APPROVAL}: ${summary.title}`}
      className="w-full max-w-2xl scroll-mt-4 rounded-xl border-2 border-primary bg-primary/5 p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
        <span className="rounded-full bg-primary px-2 py-0.5 text-white">
          {NEEDS_APPROVAL}
        </span>
        {left && (
          <span className="flex items-center gap-1 font-normal text-dark-5 dark:text-dark-6">
            <Clock size={12} aria-hidden />
            {left}
          </span>
        )}
      </p>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon size={17} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {summary.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-dark-5 dark:text-dark-6">
            {summary.color && (
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: summary.color }}
              />
            )}
            <span className="truncate">{summary.detail}</span>
          </span>
        </span>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {onReject && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void onReject(proposal)
                .catch((e) => setError((e as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            Reject
          </Button>
        )}
        <Button size="sm" disabled={busy} onClick={() => onOpen(proposal)}>
          Review and approve
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red">
          {error}
        </p>
      )}
    </section>
  );
}

/** A link to a staged import or a saved transaction; opens in place when onOpen is given. */
export function LinkCard({
  href,
  label,
  kind,
  onOpen,
}: {
  href: string;
  label: string;
  kind: "draft" | "transaction";
  onOpen?: () => void;
}) {
  const body = (
    <CardBody
      Icon={kind === "draft" ? FileText : Receipt}
      title={label}
      detail={
        kind === "draft"
          ? "Staged import · review before it is saved"
          : "Saved transaction"
      }
    />
  );
  if (onOpen)
    return (
      <button type="button" className={CARD} onClick={onOpen}>
        {body}
      </button>
    );
  return (
    <Link href={href} className={CARD}>
      {body}
    </Link>
  );
}

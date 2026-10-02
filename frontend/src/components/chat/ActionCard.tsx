"use client";
import Link from "next/link";
import {
  Archive,
  ChevronRight,
  Code2,
  FileText,
  Landmark,
  ListChecks,
  Receipt,
  Tag,
  Upload,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { Proposal, proposalSummary } from "@/lib/chat/client";

const ICONS: Record<string, LucideIcon> = {
  edit_transactions: ListChecks,
  create_account: Landmark,
  create_category: Tag,
  update_import_rule: Wand2,
  retain_fixture: Archive,
  commit_drafts: Upload,
};
const STATE_STYLE: Record<string, string> = {
  "Needs approval": "bg-primary/10 text-primary",
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
}: {
  proposal: Proposal | undefined;
  label: string;
  onOpen: (proposal: Proposal) => void;
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

/** A link to a staged import or a saved transaction. */
export function LinkCard({
  href,
  label,
  kind,
}: {
  href: string;
  label: string;
  kind: "draft" | "transaction";
}) {
  return (
    <Link href={href} className={CARD}>
      <CardBody
        Icon={kind === "draft" ? FileText : Receipt}
        title={label}
        detail={
          kind === "draft"
            ? "Staged import · review before it is saved"
            : "Saved transaction"
        }
      />
    </Link>
  );
}

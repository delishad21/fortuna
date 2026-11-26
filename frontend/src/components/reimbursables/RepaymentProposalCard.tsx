"use client";

import { useState } from "react";
import { confirmRepaymentLinks } from "@/app/actions/reimbursables";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDay } from "@/components/analytics/parts";
import { MATCH_LABELS, type RepaymentProposal } from "@/lib/reimbursables";

/**
 * Money in that looks like a repayment: the items Fortuna proposes it pays
 * back, to confirm. A partial payment leaves the rest outstanding.
 */
export function RepaymentProposalCard({
  proposal,
  markReviewed = true,
  onConfirmed,
  onError,
}: {
  proposal: RepaymentProposal;
  markReviewed?: boolean;
  onConfirmed: (message: string) => Promise<void> | void;
  onError: (err: unknown) => void;
}) {
  const [saving, setSaving] = useState(false);
  const total = proposal.links.reduce((sum, link) => sum + link.amount, 0);

  const confirm = async () => {
    setSaving(true);
    try {
      const result = await confirmRepaymentLinks(
        proposal.transactionId,
        proposal.links.map((link) => ({ transactionId: link.transactionId, amount: link.amount })),
        markReviewed,
      );
      await onConfirmed(
        `Linked ${formatCurrency(total)} to ${proposal.links.length === 1 ? "1 item" : `${proposal.links.length} items`} for ${proposal.person.name}.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`,
      );
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-stroke p-3 dark:border-dark-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-dark dark:text-white">
          Looks like a repayment from <span className="font-medium">{proposal.person.name}</span>
          <span className="text-dark-5 dark:text-dark-6"> · {MATCH_LABELS[proposal.match]}</span>
        </p>
        <Button size="sm" disabled={saving} onClick={() => void confirm()}>
          {saving ? "Linking…" : "Confirm links"}
        </Button>
      </div>
      <ul className="flex flex-col gap-1 text-xs text-dark-5 dark:text-dark-6">
        {proposal.links.map((link) => (
          <li key={link.transactionId} className="flex justify-between gap-3">
            <span className="truncate">
              {formatDay(link.date, "d MMM")} · {link.label || link.description}
              {link.amount < link.outstanding - 0.005 ? ` (of ${formatCurrency(link.outstanding)} owed)` : ""}
            </span>
            <span className="shrink-0 tabular-nums">{formatCurrency(link.amount)}</span>
          </li>
        ))}
      </ul>
      {proposal.remainingOnItems > 0.005 || proposal.unallocated > 0.005 || proposal.marksReimbursement ? (
        <p className="text-xs text-dark-5 dark:text-dark-6">
          {[
            proposal.remainingOnItems > 0.005 ? `${formatCurrency(proposal.remainingOnItems)} stays outstanding on these items` : null,
            proposal.unallocated > 0.005 ? `${formatCurrency(proposal.unallocated)} of the payment isn't linked` : null,
            proposal.marksReimbursement ? "It will be marked a Reimbursement" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

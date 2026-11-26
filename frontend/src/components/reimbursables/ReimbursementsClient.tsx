"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  clearTransactionsReimbursable,
  createReimbursementPerson,
  deleteReimbursementPerson,
  getOutstandingReimbursements,
  getRepaymentProposals,
  updateReimbursementPerson,
} from "@/app/actions/reimbursables";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/TextInput";
import { EmptyText, SectionCard, Segmented, StatCard, formatCurrency, formatDay, formatMonth } from "@/components/analytics/parts";
import { RepaymentProposalCard } from "./RepaymentProposalCard";
import {
  describeShare,
  type OutstandingReimbursements,
  type PersonBalance,
  type RepaymentProposalWithRepayment,
} from "@/lib/reimbursables";
import { cn } from "@/lib/utils";

/**
 * What people owe for spending paid for them: each person's balance (their
 * items less the repayments linked to them) by month, their open items,
 * money in that looks like their repayments, and their names.
 */
export function ReimbursementsClient({ initial }: { initial: OutstandingReimbursements }) {
  const [summary, setSummary] = useState(initial);
  const [personId, setPersonId] = useState(initial.people[0]?.person.id || "");
  const [detail, setDetail] = useState<PersonBalance | null>(null);
  const [show, setShow] = useState<"open" | "all">("open");
  const [proposals, setProposals] = useState<RepaymentProposalWithRepayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const fail = (err: unknown, fallback: string) => setError(err instanceof Error ? err.message : fallback);

  const loadPerson = useCallback(async (id: string, items: "open" | "all") => {
    if (!id) {
      setDetail(null);
      setProposals([]);
      return;
    }
    setLoading(true);
    try {
      const [balance, repayments] = await Promise.all([
        getOutstandingReimbursements({ person: id, items }),
        getRepaymentProposals({ person: id }),
      ]);
      setDetail(balance.people[0] || null);
      setProposals(repayments.proposals);
    } catch (err) {
      fail(err, "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPerson(personId, show);
  }, [personId, show, loadPerson]);

  const refresh = async (message?: string) => {
    if (message) setNotice(message);
    setError(null);
    try {
      setSummary(await getOutstandingReimbursements({ items: "none" }));
    } catch {}
    await loadPerson(personId, show);
  };

  const addPerson = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const { person } = await createReimbursementPerson(name);
      setNewName("");
      setSummary(await getOutstandingReimbursements({ items: "none" }));
      setPersonId(person.id);
    } catch (err) {
      fail(err, "Failed to add");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error ? <div className="rounded-lg bg-red/10 px-4 py-3 text-sm text-red">{error}</div> : null}
      {notice ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-green/10 px-4 py-3 text-sm text-dark dark:text-white">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-dark-5 dark:text-dark-6">
            Owed to you in total: <span className="font-semibold tabular-nums text-dark dark:text-white">{formatCurrency(summary.outstanding)}</span>
          </p>
          <Link
            href={`/reimbursements/backfill${detail ? `?person=${encodeURIComponent(detail.person.name)}` : ""}`}
            className="text-sm font-medium text-primary"
          >
            Review past items
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {summary.people.map((entry) => (
            <button
              key={entry.person.id}
              type="button"
              onClick={() => setPersonId(entry.person.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
                entry.person.id === personId
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-stroke text-dark hover:border-primary dark:border-dark-3 dark:text-white",
              )}
            >
              {entry.person.name}
              <span className="tabular-nums text-xs">{formatCurrency(entry.outstanding)}</span>
            </button>
          ))}
          <div className="flex items-center gap-2">
            <div className="w-44">
              <TextInput
                value={newName}
                placeholder="Add someone"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addPerson();
                }}
              />
            </div>
            <Button variant="secondary" size="sm" disabled={!newName.trim()} onClick={() => void addPerson()}>
              Add
            </Button>
          </div>
        </div>
        {summary.people.length === 0 ? (
          <p className="text-sm text-dark-5 dark:text-dark-6">
            Add the people you pay for, then mark their items reimbursable from a transaction, or review your past items for them.
          </p>
        ) : null}
      </Card>

      {detail ? (
        <div className={cn("flex flex-col gap-6", loading && "opacity-60")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={`${detail.person.name} owes`} value={formatCurrency(detail.outstanding)} tone={detail.outstanding > 0 ? "primary" : "default"} sub={`${detail.openItems} open item${detail.openItems === 1 ? "" : "s"}`} />
            <StatCard label="Spent for them" value={formatCurrency(detail.owed)} sub={`${detail.itemCount} item${detail.itemCount === 1 ? "" : "s"}`} />
            <StatCard label="Repaid" value={formatCurrency(detail.repaid)} tone="good" />
          </div>

          {proposals.length > 0 ? (
            <SectionCard title={`Possible repayments (${proposals.length})`}>
              <div className="divide-y divide-stroke dark:divide-stroke-dark">
                {proposals.map((proposal) => (
                  <div key={proposal.transactionId} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-dark dark:text-white">{proposal.repayment.label || proposal.repayment.description}</p>
                        <p className="text-xs text-dark-5 dark:text-dark-6">{formatDay(proposal.repayment.date, "d MMM yyyy")}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-green">+{formatCurrency(proposal.repayment.amountIn)}</span>
                    </div>
                    <RepaymentProposalCard
                      proposal={proposal}
                      markReviewed={proposal.repayment.reviewStatus === "to_review"}
                      onConfirmed={(message) => refresh(message)}
                      onError={(err) => fail(err, "Failed to link")}
                    />
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="By month">
            {detail.months.length === 0 ? (
              <EmptyText>Nothing marked for {detail.person.name} yet.</EmptyText>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    <th className="py-2 font-semibold">Month</th>
                    <th className="py-2 text-right font-semibold">Spent for them</th>
                    <th className="py-2 text-right font-semibold">Repaid</th>
                    <th className="py-2 text-right font-semibold">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stroke dark:divide-stroke-dark">
                  {[...detail.months].reverse().map((month) => (
                    <tr key={month.month} className="text-dark dark:text-white">
                      <td className="py-2">{formatMonth(month.month)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCurrency(month.owed)}</td>
                      <td className="py-2 text-right tabular-nums text-green">{formatCurrency(month.repaid)}</td>
                      <td className={cn("py-2 text-right font-medium tabular-nums", month.outstanding > 0.005 && "text-primary")}>
                        {formatCurrency(month.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>

          <SectionCard
            title={show === "open" ? "Open items" : "All items"}
            action={
              <Segmented
                options={[
                  { value: "open", label: "Open" },
                  { value: "all", label: "All" },
                ]}
                value={show}
                onChange={setShow}
              />
            }
          >
            {!detail.items?.length ? (
              <EmptyText>{show === "open" ? `${detail.person.name} owes nothing right now.` : "No items."}</EmptyText>
            ) : (
              <div className="divide-y divide-stroke dark:divide-stroke-dark">
                {[...detail.items].reverse().map((item) => (
                  <div key={item.id} className="flex items-start gap-3 py-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: item.category?.color || "#9ca3af" }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-dark dark:text-white">{item.label || item.description}</p>
                      <p className="text-xs text-dark-5 dark:text-dark-6">
                        {formatDay(item.date, "d MMM yyyy")} · {item.category?.name || "Uncategorized"} · {formatCurrency(item.amountOut)}, owes{" "}
                        {describeShare(item.share)}
                        {item.note ? ` · ${item.note}` : ""}
                      </p>
                      {item.repayments.length ? (
                        <p className="text-xs text-dark-5 dark:text-dark-6">
                          Repaid {item.repayments.map((repayment) => `${formatCurrency(repayment.amount)} on ${formatDay(repayment.date, "d MMM")}`).join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-dark dark:text-white">{formatCurrency(item.outstanding)}</p>
                      <p className="text-xs text-dark-5 dark:text-dark-6">of {formatCurrency(item.owed)}</p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-primary"
                      onClick={async () => {
                        try {
                          await clearTransactionsReimbursable([item.id]);
                          await refresh(`${item.label || item.description} unmarked.`);
                        } catch (err) {
                          fail(err, "Failed to unmark");
                        }
                      }}
                    >
                      Unmark
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <PersonSettings
            key={detail.person.id}
            balance={detail}
            onSaved={async (message) => refresh(message)}
            onRemoved={async (message) => {
              setNotice(message);
              const next = await getOutstandingReimbursements({ items: "none" });
              setSummary(next);
              setPersonId(next.people[0]?.person.id || "");
            }}
            onError={(err) => fail(err, "Failed to save")}
          />
        </div>
      ) : null}
    </div>
  );
}

function PersonSettings({
  balance,
  onSaved,
  onRemoved,
  onError,
}: {
  balance: PersonBalance;
  onSaved: (message: string) => Promise<void>;
  onRemoved: (message: string) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const { person } = balance;
  const [name, setName] = useState(person.name);
  const [aliases, setAliases] = useState(person.aliases.join(", "));
  const [saving, setSaving] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setSaving(true);
    try {
      await work();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Names">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-dark-5 dark:text-dark-6">
          Money in naming {person.name} or one of these names (as whole words, e.g. the full name on a PayNow transfer) is offered as their repayment.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" />
          <TextInput
            value={aliases}
            placeholder="Other names, separated by commas"
            onChange={(event) => setAliases(event.target.value)}
            aria-label="Other names"
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {balance.itemCount === 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void run(async () => {
                await deleteReimbursementPerson(person.id);
                await onRemoved(`${person.name} removed.`);
              })}
            >
              Remove
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void run(async () => {
                await updateReimbursementPerson(person.id, { archived: !person.archived });
                await onRemoved(person.archived ? `${person.name} restored.` : `${person.name} archived; their items stay marked.`);
              })}
            >
              {person.archived ? "Restore" : "Archive"}
            </Button>
          )}
          <Button
            size="sm"
            disabled={saving || !name.trim()}
            onClick={() => void run(async () => {
              await updateReimbursementPerson(person.id, {
                name: name.trim(),
                aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
              });
              await onSaved("Names saved.");
            })}
          >
            Save
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { applyReimbursableBackfill, getReimbursableBackfill } from "@/app/actions/reimbursables";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { TextInput } from "@/components/ui/TextInput";
import { EmptyText, SectionCard, formatCurrency, formatDay } from "@/components/analytics/parts";
import { ShareFields, isShareError, shareFields, shareFromFields, shareOf, type ShareMode } from "./ReimbursableEditor";
import { MATCH_LABELS, owedFor, type BackfillItem, type BackfillProposal } from "@/lib/reimbursables";
import { cn } from "@/lib/utils";

type Row = BackfillItem & { tick: boolean; mode: ShareMode; value: string };

/** What the row's share comes to, or null while the share isn't valid. */
const owedOf = (row: Row) => {
  const share = shareFromFields(row.mode, row.value);
  return isShareError(share) ? null : owedFor(row.amountOut, shareOf(share));
};

/**
 * Marking a person's past items reimbursable, reviewed before anything is
 * written: items whose label names them and expenses their repayments are
 * already linked to, each with a suggested share and why, and recent
 * unlinked repayments that pay off those items exactly. Apply writes what
 * stays ticked.
 */
export function BackfillClient({ people, initialPerson }: { people: string[]; initialPerson: string }) {
  const [name, setName] = useState(initialPerson);
  const [proposal, setProposal] = useState<BackfillProposal | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [linkTicks, setLinkTicks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async (person: string) => {
    if (!person.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getReimbursableBackfill(person.trim());
      setProposal(result);
      setRows(result.items.map((item) => ({ ...item, tick: item.selected, ...shareFields(item.share) })));
      setLinkTicks(new Set(result.links.filter((group) => group.selected).map((group) => group.repayment.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialPerson) void load(initialPerson);
  }, [initialPerson, load]);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((previous) => previous.map((row) => (row.transactionId === id ? { ...row, ...patch } : row)));

  const totals = useMemo(() => {
    const ticked = rows.filter((row) => row.tick);
    const owed = ticked.reduce((sum, row) => sum + (owedOf(row) ?? 0), 0);
    const outstanding = ticked.reduce((sum, row) => sum + Math.max((owedOf(row) ?? 0) - row.repaid, 0), 0);
    return { count: ticked.length, owed, outstanding, invalid: ticked.some((row) => owedOf(row) === null) };
  }, [rows]);

  const apply = async () => {
    if (!proposal) return;
    setApplying(true);
    setError(null);
    try {
      const items = rows
        .filter((row) => row.tick)
        .map((row) => {
          const share = shareFromFields(row.mode, row.value);
          if (isShareError(share)) throw new Error(`${row.label || row.description}: ${share.error}`);
          return { transactionId: row.transactionId, share };
        });
      const links = proposal.links
        .filter((group) => linkTicks.has(group.repayment.id))
        .map((group) => ({
          repaymentId: group.repayment.id,
          links: group.links.map((link) => ({ transactionId: link.transactionId, amount: link.amount })),
        }));
      const result = await applyReimbursableBackfill({ person: proposal.person.name, items, links });
      setDone(
        `Marked ${result.marked} item${result.marked === 1 ? "" : "s"} for ${result.person.name} and linked ${result.linked} repayment link${result.linked === 1 ? "" : "s"}.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`,
      );
      await load(proposal.person.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  };

  const groups: Array<{ key: BackfillItem["source"]; title: string }> = [
    { key: "labelled", title: "Labelled for them" },
    { key: "linked", title: "Already paid back by them" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56">
            <TextInput
              value={name}
              placeholder="Name in your labels, e.g. Madeline"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(name);
              }}
            />
          </div>
          <Button size="sm" disabled={!name.trim() || loading} onClick={() => void load(name)}>
            {loading ? "Looking…" : "Find items"}
          </Button>
          {people
            .filter((person) => person !== name)
            .map((person) => (
              <button
                key={person}
                type="button"
                onClick={() => {
                  setName(person);
                  void load(person);
                }}
                className="rounded-full border border-stroke px-3 py-1 text-sm text-dark hover:border-primary dark:border-dark-3 dark:text-white"
              >
                {person}
              </button>
            ))}
        </div>
        <p className="text-xs text-dark-5 dark:text-dark-6">Nothing changes until you press Apply.</p>
      </Card>

      {error ? <div className="rounded-lg bg-red/10 px-4 py-3 text-sm text-red">{error}</div> : null}
      {done ? (
        <div className="rounded-lg bg-green/10 px-4 py-3 text-sm text-dark dark:text-white">
          {done} <Link href="/reimbursements" className="font-medium text-primary">See what they owe</Link>
        </div>
      ) : null}

      {proposal ? (
        <div className={cn("flex flex-col gap-6", loading && "opacity-60")}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-dark dark:text-white">
              {totals.count} of {rows.length} ticked for {proposal.person.name}
              {"createsPerson" in proposal.person ? " (added to your people)" : ""} · {formatCurrency(totals.owed)} owed,{" "}
              <span className="font-semibold">{formatCurrency(totals.outstanding)}</span> still outstanding
              {linkTicks.size ? ` · ${linkTicks.size} repayment${linkTicks.size === 1 ? "" : "s"} to link` : ""}
              {proposal.alreadyMarked ? ` · ${proposal.alreadyMarked} already marked` : ""}
            </p>
            <Button disabled={applying || totals.invalid || (!totals.count && !linkTicks.size)} onClick={() => void apply()}>
              {applying ? "Applying…" : "Apply"}
            </Button>
          </Card>

          {rows.length === 0 && proposal.links.length === 0 ? (
            <EmptyText>No unmarked items name {proposal.person.name}.</EmptyText>
          ) : null}

          {groups.map((group) => {
            const list = rows.filter((row) => row.source === group.key);
            if (!list.length) return null;
            const allTicked = list.every((row) => row.tick);
            return (
              <SectionCard
                key={group.key}
                title={`${group.title} (${list.length})`}
                action={
                  <label className="flex items-center gap-2 text-sm text-dark-5 dark:text-dark-6">
                    <Checkbox
                      checked={allTicked}
                      indeterminate={!allTicked && list.some((row) => row.tick)}
                      onChange={(on) => setRows((previous) => previous.map((row) => (row.source === group.key ? { ...row, tick: on } : row)))}
                      aria-label="Tick all"
                    />
                    Tick all
                  </label>
                }
              >
                <div className="divide-y divide-stroke dark:divide-stroke-dark">
                  {[...list].reverse().map((row) => {
                    const owed = owedOf(row);
                    return (
                      <div key={row.transactionId} className={cn("flex flex-col gap-2 py-3 md:flex-row md:items-center", !row.tick && "opacity-70")}>
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div className="pt-0.5">
                            <Checkbox checked={row.tick} onChange={(on) => update(row.transactionId, { tick: on })} aria-label={`Tick ${row.label || row.description}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-dark dark:text-white">{row.label || row.description}</p>
                            <p className="text-xs text-dark-5 dark:text-dark-6">
                              {formatDay(row.date, "d MMM yyyy")} · {row.category?.name || "Uncategorized"} · {formatCurrency(row.amountOut)}
                              {row.repaid > 0.005 ? ` · ${formatCurrency(row.repaid)} repaid` : ""}
                            </p>
                            <p className={cn("text-xs", row.confidence === "low" ? "text-amber-700 dark:text-amber-300" : "text-dark-5 dark:text-dark-6")}>
                              {row.confidence === "low" ? "Check: " : ""}
                              {row.reason}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3 md:w-80 md:justify-end">
                          <ShareFields
                            mode={row.mode}
                            value={row.value}
                            onMode={(mode) => update(row.transactionId, { mode })}
                            onValue={(value) => update(row.transactionId, { value })}
                          />
                          <span className="w-20 text-right text-sm font-semibold tabular-nums text-dark dark:text-white">
                            {owed === null ? "—" : formatCurrency(owed)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            );
          })}

          {proposal.links.length ? (
            <SectionCard title={`Repayments to link (${proposal.links.length})`}>
              <div className="divide-y divide-stroke dark:divide-stroke-dark">
                {proposal.links.map((group) => (
                  <div key={group.repayment.id} className="flex items-start gap-3 py-3">
                    <div className="pt-0.5">
                      <Checkbox
                        checked={linkTicks.has(group.repayment.id)}
                        onChange={(on) =>
                          setLinkTicks((previous) => {
                            const next = new Set(previous);
                            if (on) next.add(group.repayment.id);
                            else next.delete(group.repayment.id);
                            return next;
                          })
                        }
                        aria-label={`Link ${group.repayment.label || group.repayment.description}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-3">
                        <p className="truncate text-sm font-medium text-dark dark:text-white">{group.repayment.label || group.repayment.description}</p>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-green">+{formatCurrency(group.repayment.amountIn)}</span>
                      </div>
                      <p className="text-xs text-dark-5 dark:text-dark-6">
                        {formatDay(group.repayment.date, "d MMM yyyy")} · {MATCH_LABELS[group.match]}
                        {group.marksReimbursement ? " · will be marked a Reimbursement" : ""}
                      </p>
                      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-dark-5 dark:text-dark-6">
                        {group.links.map((link) => (
                          <li key={link.transactionId} className="flex justify-between gap-3">
                            <span className="truncate">{formatDay(link.date, "d MMM")} · {link.label || link.description}</span>
                            <span className="shrink-0 tabular-nums">{formatCurrency(link.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

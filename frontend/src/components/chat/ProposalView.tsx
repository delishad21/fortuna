"use client";
import {
  ArrowRight,
  ArrowLeftRight,
  Receipt,
  Link2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import {
  Proposal,
  CategoryChip,
  FieldDiff,
  LinkedSummary,
  PreviewReferences,
  TransactionSide,
  categoryChip,
  fieldText,
  formatMoney,
  groupTransactionChanges,
  linkageView,
  ruleSummary,
  shortDate,
  signedAmount,
  summaryLabel,
  summaryValue,
  transactionTitle,
  FIELD_LABELS,
} from "@/lib/chat/client";
import { TransactionCard } from "@/components/transactions/TransactionCard";

const NEUTRAL = "#9CA3AF";

export function CategoryBadge({ value }: { value: CategoryChip | null }) {
  if (!value) return <span className="text-dark-5 dark:text-dark-6">None</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: value.color || NEUTRAL }}
      />
      {value.name}
    </span>
  );
}

function LinkedRow({
  link,
}: {
  link: ReturnType<typeof linkageView>["links"][number];
}) {
  const s = link.summary;
  return (
    <li className="flex items-center justify-between gap-3 rounded-md bg-gray-1 px-3 py-2 text-sm dark:bg-dark-2">
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {s
            ? transactionTitle(s)
            : link.staged
              ? "Staged import row"
              : "Saved transaction"}
        </span>
        <span className="block truncate text-xs text-dark-5 dark:text-dark-6">
          {s
            ? `${shortDate(s.date)} · ${s.description || ""}`
            : `#${link.id.slice(-6)}`}
          {link.staged && " · not imported yet"}
        </span>
      </span>
      {link.amount !== null && (
        <span className="shrink-0 font-semibold tabular-nums text-primary">
          {formatMoney(link.amount, s?.currency || "SGD")}
        </span>
      )}
    </li>
  );
}

function LinkageValue({
  value,
  references,
}: {
  value: any;
  references: PreviewReferences;
}) {
  const view = linkageView(value, references);
  const Icon =
    view.kind === "internal"
      ? ArrowLeftRight
      : view.kind === "reimbursement"
        ? Receipt
        : view.kind === "reimbursed"
          ? Link2
          : null;
  return (
    <div className="space-y-2">
      <span className="inline-flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        {view.label}
      </span>
      {view.links.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-dark-5 dark:text-dark-6">
            {view.kind === "reimbursement" ? "Pays back" : "Paid back by"}
          </p>
          <ul className="space-y-1">
            {view.links.map((link) => (
              <LinkedRow key={link.id} link={link} />
            ))}
          </ul>
        </div>
      )}
      {view.leftover && (
        <p className="text-xs text-dark-5 dark:text-dark-6">
          Leftover goes to <CategoryBadge value={view.leftover} />
        </p>
      )}
    </div>
  );
}

function FieldValue({
  diff,
  side,
  currency,
  references,
}: {
  diff: FieldDiff;
  side: "before" | "after";
  currency: string;
  references: PreviewReferences;
}) {
  const value = diff[side];
  if (diff.key === "category")
    return <CategoryBadge value={categoryChip(value)} />;
  if (diff.key === "linkage")
    return <LinkageValue value={value} references={references} />;
  if (diff.key === "accountIdentifier" && value)
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full"
          style={{
            backgroundColor: references.accounts?.[String(value)] || NEUTRAL,
          }}
        />
        {String(value)}
      </span>
    );
  return (
    <span className="break-words">
      {fieldText(diff.key, value, currency, formatMoney)}
    </span>
  );
}

function DiffRows({
  diffs,
  currency,
  references,
}: {
  diffs: FieldDiff[];
  currency: string;
  references: PreviewReferences;
}) {
  return (
    <dl className="divide-y divide-stroke dark:divide-stroke-dark">
      {diffs.map((diff) => (
        <div
          key={diff.key}
          className="grid grid-cols-1 gap-1.5 py-2.5 text-sm sm:grid-cols-[7rem_1fr_auto_1fr] sm:items-start sm:gap-3"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-dark-5 dark:text-dark-6 sm:pt-0.5">
            {FIELD_LABELS[diff.key] || diff.key}
          </dt>
          <dd className="text-dark-5 dark:text-dark-6">
            <span className="sr-only">Before: </span>
            <FieldValue
              diff={diff}
              side="before"
              currency={currency}
              references={references}
            />
          </dd>
          <ArrowRight
            className="hidden h-4 w-4 text-dark-5 sm:mt-0.5 sm:block"
            aria-hidden
          />
          <dd className="font-medium">
            <span className="sr-only">After: </span>
            <FieldValue
              diff={diff}
              side="after"
              currency={currency}
              references={references}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function asCard(t: TransactionSide, references: PreviewReferences) {
  return {
    id: t.id,
    date: String(t.date || ""),
    description: t.description || "",
    label: t.label || undefined,
    amountIn: t.amountIn == null ? null : Number(t.amountIn),
    amountOut: t.amountOut == null ? null : Number(t.amountOut),
    balance: null,
    currency: t.currency,
    accountIdentifier: t.accountIdentifier,
    linkage: null,
    accentColor: t.accountIdentifier
      ? references.accounts?.[t.accountIdentifier] || undefined
      : undefined,
  };
}

function TransactionEdits({ preview }: { preview: any }) {
  const references: PreviewReferences = preview.references || {};
  const groups = groupTransactionChanges(preview.changes || []);
  if (!groups.length)
    return <p className="text-sm text-dark-5">Nothing would change.</p>;
  return (
    <div className="space-y-4">
      {groups.map((group, index) => {
        const currency = group.transactions[0]?.currency || "SGD";
        return (
          <section
            key={index}
            aria-label={`Change ${index + 1}`}
            className="overflow-hidden rounded-lg border border-stroke dark:border-stroke-dark"
          >
            <header className="flex items-baseline justify-between gap-3 bg-gray-1 px-4 py-2.5 dark:bg-dark-2">
              <h3 className="text-sm font-semibold">
                {group.transactions.length === 1
                  ? "1 transaction"
                  : `${group.transactions.length} transactions`}
              </h3>
              <span className="text-xs text-dark-5 dark:text-dark-6">
                {group.diffs.length}{" "}
                {group.diffs.length === 1 ? "field" : "fields"} change
              </span>
            </header>
            <div className="px-4">
              <DiffRows
                diffs={group.diffs}
                currency={currency}
                references={references}
              />
            </div>
            <ul
              aria-label="Affected transactions"
              className="max-h-80 divide-y divide-stroke overflow-y-auto border-t border-stroke dark:divide-stroke-dark dark:border-stroke-dark"
            >
              {group.transactions.map((t) => (
                <li key={t.id}>
                  <TransactionCard
                    compact
                    transaction={asCard(t, references)}
                    accentColor={asCard(t, references).accentColor}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SummaryList({
  value,
  hide = [],
}: {
  value: Record<string, unknown>;
  hide?: string[];
}) {
  const entries = Object.entries(value || {}).filter(
    ([k, v]) => !hide.includes(k) && v !== undefined,
  );
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {entries.map(([key, item]) => (
        <div
          key={key}
          className="flex justify-between gap-3 border-b border-stroke py-1.5 dark:border-stroke-dark"
        >
          <dt className="text-dark-5 dark:text-dark-6">{summaryLabel(key)}</dt>
          <dd className="text-right font-medium">{summaryValue(item)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "warning" | "ok";
  children: React.ReactNode;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <p
      className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
        tone === "error"
          ? "bg-red/10 text-red"
          : tone === "warning"
            ? "bg-orange/10 text-orange-dark dark:text-orange"
            : "bg-green/10 text-green dark:text-green-light"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function MiniTransaction({ t }: { t: LinkedSummary & { filename?: string } }) {
  const { income, value } = signedAmount(t);
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{transactionTitle(t)}</p>
      <p className="truncate text-xs text-dark-5 dark:text-dark-6">
        {shortDate(t.date)}
        {t.filename ? ` · ${t.filename}` : ""}
      </p>
      <p
        className={`text-sm font-semibold ${income ? "text-green" : "text-red"}`}
      >
        {income ? "+" : "−"}
        {formatMoney(value, t.currency || "SGD")}
      </p>
    </div>
  );
}

function CommitDrafts({ preview }: { preview: any }) {
  return (
    <div className="space-y-4">
      {(preview.drafts || []).map((draft: any) => (
        <section
          key={draft.draftId}
          className="space-y-3 rounded-lg border border-stroke p-4 dark:border-stroke-dark"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate font-semibold">
              {draft.filename || "Staged import"}
            </h3>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${draft.valid ? "bg-green/10 text-green" : "bg-red/10 text-red"}`}
            >
              {draft.valid ? "Ready" : "Blocked"}
            </span>
          </div>
          {draft.summary && <SummaryList value={draft.summary} />}
          {(draft.errors || []).map((e: any, i: number) => (
            <Notice key={`e${i}`} tone="error">
              {e.message || summaryValue(e)}
            </Notice>
          ))}
          {(draft.warnings || []).map((w: any, i: number) => (
            <Notice key={`w${i}`} tone="warning">
              {w.message || summaryValue(w)}
            </Notice>
          ))}
        </section>
      ))}
      {Array.isArray(preview.duplicates) && preview.duplicates.length > 0 && (
        <section className="space-y-3 rounded-lg border border-orange p-4">
          <h3 className="font-semibold">
            {preview.duplicates.length} possible{" "}
            {preview.duplicates.length === 1 ? "duplicate" : "duplicates"}
          </h3>
          <ul className="space-y-3">
            {preview.duplicates.map((d: any, i: number) => (
              <li
                key={i}
                className="grid grid-cols-1 gap-3 rounded-md bg-gray-1 p-3 text-sm dark:bg-dark-2 sm:grid-cols-2"
              >
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-dark-5">
                    Importing
                  </p>
                  <MiniTransaction t={d.row || {}} />
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-dark-5">
                    Matches
                    {d.score != null
                      ? ` · ${Math.round(Number(d.score) * (Number(d.score) <= 1 ? 100 : 1))}%`
                      : ""}
                  </p>
                  <MiniTransaction t={d.match || {}} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RuleCard({ rule, label }: { rule: any; label?: string }) {
  const summary = ruleSummary(rule);
  if (!summary) return null;
  return (
    <section className="space-y-3 rounded-lg border border-stroke p-4 dark:border-stroke-dark">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">
          {label && (
            <span className="mr-2 text-xs font-medium uppercase tracking-wide text-dark-5">
              {label}
            </span>
          )}
          {summary.name}
        </h3>
        <span className="text-xs text-dark-5 dark:text-dark-6">
          {summary.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-dark-5">
            When
          </p>
          <ul className="space-y-1">
            {summary.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-dark-5">
            Then
          </p>
          <ul className="space-y-1 font-medium">
            {summary.effects.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-xs text-dark-5 dark:text-dark-6">
        Applies to future imports only.
      </p>
    </section>
  );
}

function SettingsChange({ kind, preview }: { kind: string; preview: any }) {
  const after = preview.after || {};
  if (kind === "create_account")
    return (
      <section className="rounded-lg border border-stroke p-4 dark:border-stroke-dark">
        <p className="mb-2 text-xs uppercase tracking-wide text-dark-5">
          New account
        </p>
        <CategoryBadge
          value={{ name: after.accountIdentifier, color: after.color }}
        />
      </section>
    );
  if (kind === "create_category")
    return (
      <section className="rounded-lg border border-stroke p-4 dark:border-stroke-dark">
        <p className="mb-2 text-xs uppercase tracking-wide text-dark-5">
          New category
        </p>
        <CategoryBadge value={{ name: after.name, color: after.color }} />
      </section>
    );
  return (
    <div className="space-y-3">
      {preview.before && <RuleCard rule={preview.before} label="Current" />}
      <RuleCard
        rule={{ ...(preview.before || {}), ...after }}
        label={preview.before ? "New" : undefined}
      />
    </div>
  );
}

function ParserChange({ kind, preview }: { kind: string; preview: any }) {
  const details = preview.details || {};
  if (kind === "retain_fixture")
    return (
      <ul className="space-y-2">
        {(details.files || (Array.isArray(details) ? details : [])).map(
          (f: any) => (
            <li
              key={f.filename}
              className="flex justify-between gap-3 rounded-md border border-stroke px-3 py-2 text-sm dark:border-stroke-dark"
            >
              <span className="truncate font-medium">{f.filename}</span>
              <span className="shrink-0 text-dark-5">
                {f.retained
                  ? "Already kept"
                  : `Expires ${shortDate(f.expiresAt)}`}
              </span>
            </li>
          ),
        )}
      </ul>
    );
  return (
    <div className="space-y-4">
      <SummaryList
        value={details}
        hide={["testReport", "sourceCode", "specification", "versions"]}
      />
      {details.testReport && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-dark-5">
            Test results
          </p>
          <SummaryList value={details.testReport} />
        </div>
      )}
    </div>
  );
}

/** Readable body for any approval proposal; never raw JSON. */
export function ProposalView({ proposal }: { proposal: Proposal }) {
  const preview = proposal.preview || {};
  if (proposal.kind === "edit_transactions" || preview.changes)
    return <TransactionEdits preview={preview} />;
  if (proposal.kind === "commit_drafts")
    return <CommitDrafts preview={preview} />;
  if (
    ["create_account", "create_category", "update_import_rule"].includes(
      proposal.kind,
    )
  )
    return <SettingsChange kind={proposal.kind} preview={preview} />;
  if (
    [
      "retain_fixture",
      "approve_parser",
      "activate_parser",
      "rollback_parser",
    ].includes(proposal.kind)
  )
    return <ParserChange kind={proposal.kind} preview={preview} />;
  const { title: _title, ...rest } = preview;
  return <SummaryList value={rest} />;
}

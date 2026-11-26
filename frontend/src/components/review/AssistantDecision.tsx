import { formatCurrency, formatDay } from "@/components/analytics/parts";
import { decidedByLabel } from "@/lib/entrySource";
import {
  transactionTypeLabel,
  type AssistantDecision as Decision,
  type EntryClassification,
  type ReviewPrecedent,
} from "@/lib/reviewTypes";

/**
 * How an assistant entry was classified: which step decided, what the
 * assistant itself sent, and the past entries it based that on.
 */
export function AssistantDecision({
  classification,
  decision,
  transactionType,
  merchant,
  precedents,
}: {
  classification: EntryClassification | null | undefined;
  decision: Decision | null | undefined;
  transactionType?: string | null;
  merchant?: string | null;
  precedents?: ReviewPrecedent[];
}) {
  const decidedBy = classification?.decidedBy;
  const by = decidedByLabel(decidedBy);
  const byDetail =
    decidedBy === "rule" && classification?.ruleName
      ? ` “${classification.ruleName}”`
      : decidedBy === "structural" && classification?.structural?.reason
        ? `: ${classification.structural.reason}`
        : "";
  const type = transactionTypeLabel(transactionType ?? decision?.transactionType);
  const shownMerchant = merchant ?? decision?.merchant;
  const confidence = typeof decision?.confidence === "number" ? `${Math.round(decision.confidence * 100)}%` : null;
  const rows = (
    [
      ["Decided by", by ? `${by}${byDetail}` : null],
      ["Type", type],
      ["Merchant", shownMerchant],
      ["Assistant's category", decision?.category],
      ["Confidence", confidence],
    ] as [string, string | null | undefined][]
  ).filter((row): row is [string, string] => Boolean(row[1]));
  if (!rows.length && !decision?.reason && !precedents?.length) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-stroke p-3 text-xs dark:border-dark-3">
      {rows.length ? (
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="shrink-0 text-dark-5 dark:text-dark-6">{label}:</dt>
              <dd className="font-medium text-dark dark:text-white">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {classification?.conflict ? (
        <p className="text-dark-5 dark:text-dark-6">
          The rule set {classification.conflict.rule}; the assistant chose {classification.conflict.assistant}.
        </p>
      ) : null}
      {decision?.reason ? (
        <p className="text-dark dark:text-white">
          <span className="text-dark-5 dark:text-dark-6">Reason: </span>
          {decision.reason}
        </p>
      ) : null}
      {precedents?.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-dark-5 dark:text-dark-6">Based on</span>
          <ul className="flex flex-col gap-1">
            {precedents.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-dark dark:text-white">
                  {formatDay(item.date, "d MMM yyyy")} · {item.label || item.description} · {item.category || "Uncategorized"}
                </span>
                <span className="shrink-0 tabular-nums text-dark-5 dark:text-dark-6">
                  {(item.amountIn ?? 0) > 0 ? `+${formatCurrency(item.amountIn ?? 0)}` : `-${formatCurrency(item.amountOut ?? 0)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

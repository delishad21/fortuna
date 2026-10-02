"use client";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  chatApi,
  ComponentBlock,
  ComponentRow,
  changeLabel,
  fetchTransactionPage,
  formatMoney,
  groupLabel,
  periodLabel,
} from "@/lib/chat/client";
import { ChatTransactions, asTransactions } from "./ChatTransactions";

const PRIMARY = "#5750F1";
const OTHER = "#9CA3AF";

function Frame({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-stroke p-4 dark:border-stroke-dark">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">{title}</h3>
        {aside && (
          <span className="text-sm text-dark-5 dark:text-dark-6">{aside}</span>
        )}
      </div>
      {children}
    </section>
  );
}
const rangeLabel = (query: Record<string, unknown>) => {
  const from = new Date(String(query.dateFrom)),
    to = new Date(new Date(String(query.dateTo)).getTime() - 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return Number.isNaN(from.getTime()) ? "" : `${fmt(from)} – ${fmt(to)}`;
};

function TransactionList({
  block,
}: {
  block: Extract<ComponentBlock, { component: "transaction_list" }>;
}) {
  const [rows, setRows] = useState<ComponentRow[]>(block.rows),
    [total, setTotal] = useState(block.total),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const remaining = total - rows.length;
  async function more() {
    setLoading(true);
    setError("");
    try {
      const page = await fetchTransactionPage(
        chatApi,
        block.query,
        rows.length,
      );
      const seen = new Set(rows.map((r) => r.id));
      setRows([...rows, ...page.rows.filter((r) => !seen.has(r.id))]);
      setTotal(page.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <ChatTransactions
      title={block.title}
      transactions={asTransactions(rows) || []}
      total={total}
      footer={
        <>
          {remaining > 0 && (
            <button
              type="button"
              disabled={loading}
              className="w-full rounded-lg border border-stroke py-2 text-sm text-primary hover:bg-gray-2 disabled:opacity-60 dark:border-stroke-dark dark:hover:bg-dark-3"
              onClick={() => void more()}
            >
              {loading
                ? "Loading…"
                : `Load ${Math.min(remaining, 50)} more of ${remaining} remaining`}
            </button>
          )}
          {error && (
            <p role="alert" className="text-sm text-red">
              {error}
            </p>
          )}
        </>
      }
    />
  );
}

function SummaryTiles({
  block,
}: {
  block: Extract<ComponentBlock, { component: "summary_tiles" }>;
}) {
  if (!block.currencies.length)
    return (
      <Frame title={block.title} aside={rangeLabel(block.query)}>
        <p className="text-sm text-dark-5">No transactions in this period.</p>
      </Frame>
    );
  return (
    <Frame title={block.title} aside={rangeLabel(block.query)}>
      {block.currencies.map((c) => (
        <div key={c.currency} className="space-y-2">
          {block.currencies.length > 1 && (
            <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              {c.currency}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ["Spent", formatMoney(c.expense, c.currency), "expense"],
                ["Income", formatMoney(c.income, c.currency), "income"],
                ["Net", formatMoney(c.net, c.currency), "net"],
                ["Transactions", c.count.toLocaleString(), "count"],
              ] as const
            ).map(([label, value, key]) => {
              const change = changeLabel(
                String(c[key]),
                c.previous && String(c.previous[key]),
              );
              return (
                <div
                  key={key}
                  className="rounded-lg bg-gray-1 p-3 dark:bg-dark-2"
                >
                  <dt className="text-xs text-dark-5 dark:text-dark-6">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words text-lg font-semibold">
                    {value}
                  </dd>
                  {change && (
                    <dd className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">
                      {change}
                    </dd>
                  )}
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </Frame>
  );
}

function Breakdown({
  block,
}: {
  block: Extract<ComponentBlock, { component: "breakdown" }>;
}) {
  return (
    <Frame
      title={block.title}
      aside={`Spending by ${groupLabel[block.groupBy].toLowerCase()} · ${rangeLabel(block.query)}`}
    >
      {!block.series.length && (
        <p className="text-sm text-dark-5">No spending in this period.</p>
      )}
      {block.series.map((s) => {
        const max = Math.max(...s.items.map((i) => Number(i.amount)), 0);
        return (
          <div key={s.currency} className="space-y-3">
            <p className="text-sm text-dark-5 dark:text-dark-6">
              Total {formatMoney(s.total, s.currency)}
            </p>
            <ul className="space-y-2.5">
              {s.items.map((item) => {
                const share = Number(s.total)
                  ? (Number(item.amount) / Number(s.total)) * 100
                  : 0;
                return (
                  <li
                    key={item.name}
                    title={`${item.name}: ${formatMoney(item.amount, s.currency)} · ${share.toFixed(1)}% · ${item.count} transactions`}
                    className="group"
                  >
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        {block.groupBy === "category" && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: item.other
                                ? OTHER
                                : item.color || PRIMARY,
                            }}
                          />
                        )}
                        <span className="truncate">{item.name}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatMoney(item.amount, s.currency)}
                        <span className="ml-2 text-xs font-normal text-dark-5 dark:text-dark-6">
                          {share.toFixed(0)}%
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-gray-2 dark:bg-dark-3">
                      <div
                        className="h-2 rounded-full transition-opacity group-hover:opacity-80"
                        style={{
                          width: `${max ? Math.max((Number(item.amount) / max) * 100, 1) : 0}%`,
                          backgroundColor: item.other
                            ? OTHER
                            : block.groupBy === "category"
                              ? item.color || PRIMARY
                              : PRIMARY,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </Frame>
  );
}

function Trend({
  block,
}: {
  block: Extract<ComponentBlock, { component: "trend" }>;
}) {
  return (
    <Frame
      title={block.title}
      aside={`Spending per ${block.interval} · ${rangeLabel(block.query)}`}
    >
      {!block.series.length && (
        <p className="text-sm text-dark-5">No transactions in this period.</p>
      )}
      {block.series.map((s) => {
        const data = s.points.map((p) => ({
          period: p.period,
          label: periodLabel(p.period, block.interval),
          expense: Number(p.expense),
          income: Number(p.income),
        }));
        return (
          <div key={s.currency} className="space-y-2">
            {block.series.length > 1 && (
              <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                {s.currency}
              </p>
            )}
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="currentColor"
                    strokeOpacity={0.1}
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "currentColor", opacity: 0.6 }}
                    minTickGap={16}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tick={{ fontSize: 11, fill: "currentColor", opacity: 0.6 }}
                    tickFormatter={(v: number) =>
                      Intl.NumberFormat("en-US", {
                        notation: "compact",
                      }).format(v)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                    content={({ active, payload, label }) => {
                      const point = payload?.[0]?.payload as
                        | (typeof data)[number]
                        | undefined;
                      if (!active || !point) return null;
                      return (
                        <div className="rounded-lg border border-stroke bg-white px-3 py-2 text-xs shadow-sm dark:border-stroke-dark dark:bg-dark-2">
                          <p className="font-semibold">{label}</p>
                          <p>Spent {formatMoney(point.expense, s.currency)}</p>
                          <p className="text-dark-5 dark:text-dark-6">
                            Income {formatMoney(point.income, s.currency)}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="expense"
                    name="Spent"
                    fill={PRIMARY}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-dark-5 dark:text-dark-6">
                View as table
              </summary>
              <div className="mt-2 max-h-64 overflow-auto">
                <table className="w-full text-left tabular-nums">
                  <thead className="text-xs text-dark-5 dark:text-dark-6">
                    <tr>
                      <th className="py-1 font-medium">Period</th>
                      <th className="py-1 text-right font-medium">Spent</th>
                      <th className="py-1 text-right font-medium">Income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((p) => (
                      <tr
                        key={p.period}
                        className="border-t border-stroke dark:border-stroke-dark"
                      >
                        <td className="py-1">{p.label}</td>
                        <td className="py-1 text-right">
                          {formatMoney(p.expense, s.currency)}
                        </td>
                        <td className="py-1 text-right">
                          {formatMoney(p.income, s.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        );
      })}
    </Frame>
  );
}

const METRIC_LABEL = { expense: "Spent", income: "Income", net: "Net" };
function Comparison({
  block,
}: {
  block: Extract<ComponentBlock, { component: "comparison" }>;
}) {
  const [a, b] = block.series;
  return (
    <Frame
      title={block.title}
      aside={`${METRIC_LABEL[block.metric]} · ${rangeLabel(block.series[0].query)}`}
    >
      {!block.currencies.length && (
        <p className="text-sm text-dark-5">No transactions in this period.</p>
      )}
      {block.currencies.map((c) => {
        const max = Math.max(...c.totals.map((t) => Math.abs(Number(t))), 0);
        return (
          <div key={c.currency} className="space-y-3">
            <ul className="space-y-2.5">
              {block.series.map((s, i) => (
                <li key={s.label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{s.label}</span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatMoney(c.totals[i], c.currency)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-gray-2 dark:bg-dark-3">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${max ? Math.max((Math.abs(Number(c.totals[i])) / max) * 100, 1) : 0}%`,
                        backgroundColor: PRIMARY,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {c.difference !== null && (
              <p className="flex items-baseline justify-between gap-3 border-t border-stroke pt-2 text-sm dark:border-stroke-dark">
                <span className="text-dark-5 dark:text-dark-6">
                  Difference ({a.label} − {b.label})
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(c.difference, c.currency)}
                </span>
              </p>
            )}
            {block.months &&
              block.months.some((m) => m.currency === c.currency) && (
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-left text-sm tabular-nums">
                    <caption className="sr-only">Month by month</caption>
                    <thead className="text-xs text-dark-5 dark:text-dark-6">
                      <tr>
                        <th className="py-1 font-medium">Month</th>
                        {block.series.map((s) => (
                          <th
                            key={s.label}
                            className="py-1 text-right font-medium"
                          >
                            {s.label}
                          </th>
                        ))}
                        {block.series.length >= 2 && (
                          <>
                            <th className="py-1 text-right font-medium">
                              Difference
                            </th>
                            <th className="py-1 text-right font-medium">
                              Running
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {block.months
                        .filter((m) => m.currency === c.currency)
                        .map((m) => (
                          <tr
                            key={m.period}
                            className="border-t border-stroke dark:border-stroke-dark"
                          >
                            <td className="py-1">
                              {periodLabel(m.period, "month")}
                            </td>
                            {m.values.map((v, i) => (
                              <td key={i} className="py-1 text-right">
                                {formatMoney(v, c.currency)}
                              </td>
                            ))}
                            {m.difference !== null && (
                              <>
                                <td className="py-1 text-right">
                                  {formatMoney(m.difference, c.currency)}
                                </td>
                                <td className="py-1 text-right font-medium">
                                  {formatMoney(m.cumulative!, c.currency)}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        );
      })}
    </Frame>
  );
}

export function ChatComponent({ block }: { block: ComponentBlock }) {
  if (block.component === "transaction_list")
    return <TransactionList block={block} />;
  if (block.component === "summary_tiles")
    return <SummaryTiles block={block} />;
  if (block.component === "breakdown") return <Breakdown block={block} />;
  if (block.component === "trend") return <Trend block={block} />;
  if (block.component === "comparison") return <Comparison block={block} />;
  return null;
}

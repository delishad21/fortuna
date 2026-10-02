import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChatError, ComponentBlock, ResultBlock } from "../contracts";
import { ToolDefinition } from "../providers/provider";
import { ReadTools, rangeFields } from "./read";

/** Rows embedded in a transaction list block; further pages are fetched by the client. */
export const TRANSACTION_PREVIEW_ROWS = 25;
const MAX_TREND_POINTS = 400;
const filtersSchema = z.object(rangeFields).strict();
export const showComponentSchema = z
  .object({
    component: z.enum([
      "transaction_list",
      "summary_tiles",
      "breakdown",
      "trend",
      "comparison",
    ]),
    title: z.string().min(1).max(120),
    filters: filtersSchema.optional(),
    series: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(60),
            filters: filtersSchema,
          })
          .strict(),
      )
      .min(2)
      .max(4)
      .optional(),
    metric: z.enum(["expense", "income", "net"]).default("expense"),
    byMonth: z.boolean().default(false),
    groupBy: z.enum(["category", "merchant", "account"]).default("category"),
    limit: z.number().int().min(3).max(20).default(8),
    interval: z.enum(["day", "week", "month"]).default("month"),
    compareToPrevious: z.boolean().default(true),
  })
  .strict()
  .refine((v) => (v.component === "comparison" ? !!v.series : !!v.filters), {
    message: "comparison needs series; other components need filters",
  });
const str = { type: "string" };
export const showComponentDefinition: ToolDefinition = {
  name: "show_component",
  description:
    "Display data to the user as a rich component. The user cannot see other tool results. Components compute exact totals in the database; do not repeat their numbers at length in text. transaction_list: matching transactions as cards; any size, the UI paginates. summary_tiles: spent, income, net and count per currency, optionally against the previous period of equal length. breakdown: spending ranked by category, merchant or account, top `limit` plus Other. trend: spending and income over time by day, week or month. comparison: 2-4 labelled queries (series, each with its own filters) totalled side by side per currency, with the difference between the first two and optionally a month-by-month running difference; use it to reconcile two sources (e.g. a wallet's journeys vs the card charges that fund it) or compare periods or accounts. Internal transfers are excluded unless a series sets includeInternal=true, which reconciling wallet top-ups needs.",
  inputSchema: {
    type: "object",
    properties: {
      component: {
        enum: [
          "transaction_list",
          "summary_tiles",
          "breakdown",
          "trend",
          "comparison",
        ],
      },
      title: { type: "string", description: "Short heading for the user" },
      filters: {
        type: "object",
        properties: {
          dateFrom: {
            type: "string",
            description: "Inclusive ISO timestamp with offset",
          },
          dateTo: {
            type: "string",
            description: "Exclusive ISO timestamp with offset",
          },
          currency: str,
          accountIdentifier: str,
          categoryId: str,
          search: str,
          includeInternal: { type: "boolean" },
        },
        required: ["dateFrom", "dateTo"],
        additionalProperties: false,
      },
      series: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        description: "comparison only: labelled queries to compare",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            filters: { type: "object", description: "Same fields as filters" },
          },
          required: ["label", "filters"],
        },
      },
      metric: {
        enum: ["expense", "income", "net"],
        description: "comparison only; default expense",
      },
      byMonth: {
        type: "boolean",
        description: "comparison only: add a month-by-month running difference",
      },
      groupBy: {
        enum: ["category", "merchant", "account"],
        description: "breakdown only",
      },
      limit: {
        type: "integer",
        minimum: 3,
        maximum: 20,
        description: "breakdown only",
      },
      interval: { enum: ["day", "week", "month"], description: "trend only" },
      compareToPrevious: {
        type: "boolean",
        description: "summary_tiles only",
      },
    },
    required: ["component", "title"],
    additionalProperties: false,
  },
};

const D = Prisma.Decimal;
type Totals = Awaited<ReturnType<ReadTools["summary"]>>["totals"];
const byCurrency = (totals: Totals) => {
  const map = new Map<string, Totals>();
  for (const row of totals)
    map.set(row.currency, [...(map.get(row.currency) || []), row]);
  return map;
};
const sum = (rows: Totals, key: "expense" | "income") =>
  rows.reduce((acc, r) => acc.plus(r[key]), new D(0));
const weekStart = (day: string) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const bucket = (day: string, interval: "day" | "week" | "month") =>
  interval === "day"
    ? day
    : interval === "month"
      ? day.slice(0, 7)
      : weekStart(day);
/** Every bucket key in [from, to), so charts show empty periods as zero. */
function buckets(from: Date, to: Date, interval: "day" | "week" | "month") {
  const keys: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  while (cursor < to) {
    const key = bucket(cursor.toISOString().slice(0, 10), interval);
    if (keys[keys.length - 1] !== key) keys.push(key);
    if (keys.length > MAX_TREND_POINTS)
      throw new ChatError(
        400,
        "Too many points for this range. Choose a coarser interval.",
      );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export class ComponentTools {
  constructor(
    private db: PrismaClient,
    private read: ReadTools,
  ) {}
  async show(userId: string, raw: unknown): Promise<ComponentBlock> {
    const input = showComponentSchema.parse(raw);
    if (input.component === "comparison") return this.comparison(userId, input);
    const { title } = input;
    const filters = input.filters!;
    if (input.component === "transaction_list") {
      const page = await this.read.transactionPage(userId, {
        ...filters,
        offset: 0,
        limit: TRANSACTION_PREVIEW_ROWS,
      });
      return {
        type: "component",
        component: "transaction_list",
        title,
        query: filters,
        total: page.total,
        rows: page.rows,
      };
    }
    if (input.component === "summary_tiles") {
      const current = await this.read.summary(userId, {
        ...filters,
        groupBy: "currency",
      });
      const from = new Date(filters.dateFrom),
        to = new Date(filters.dateTo);
      const previousRange = {
        dateFrom: new Date(2 * from.getTime() - to.getTime()).toISOString(),
        dateTo: from.toISOString(),
      };
      const previous = input.compareToPrevious
        ? byCurrency(
            (
              await this.read.summary(userId, {
                ...filters,
                ...previousRange,
                groupBy: "currency",
              })
            ).totals,
          )
        : undefined;
      const tile = (rows: Totals) => {
        const expense = sum(rows, "expense"),
          income = sum(rows, "income");
        return {
          expense: expense.toFixed(2),
          income: income.toFixed(2),
          net: income.minus(expense).toFixed(2),
          count: rows.reduce((n, r) => n + r.count, 0),
        };
      };
      return {
        type: "component",
        component: "summary_tiles",
        title,
        query: filters,
        previousRange: previous ? previousRange : undefined,
        currencies: [...byCurrency(current.totals)].map(([currency, rows]) => ({
          currency,
          ...tile(rows),
          previous: previous ? tile(previous.get(currency) || []) : undefined,
        })),
      };
    }
    if (input.component === "breakdown") {
      const { totals } = await this.read.summary(userId, {
        ...filters,
        groupBy: input.groupBy,
      });
      const colors =
        input.groupBy === "category"
          ? new Map(
              (
                await this.db.category.findMany({
                  where: { userId },
                  select: { name: true, color: true },
                })
              ).map((c) => [c.name, c.color]),
            )
          : new Map<string, string>();
      return {
        type: "component",
        component: "breakdown",
        title,
        query: filters,
        groupBy: input.groupBy,
        series: [...byCurrency(totals)].map(([currency, rows]) => {
          const ranked = rows
            .filter((r) => new D(r.expense).gt(0))
            .sort((a, b) => new D(b.expense).comparedTo(a.expense));
          const top = ranked.slice(0, input.limit),
            rest = ranked.slice(input.limit);
          return {
            currency,
            total: sum(ranked, "expense").toFixed(2),
            items: [
              ...top.map((r) => ({
                name: r.group,
                amount: r.expense,
                count: r.count,
                color: colors.get(r.group) || undefined,
              })),
              ...(rest.length
                ? [
                    {
                      name: `Other (${rest.length})`,
                      amount: sum(rest, "expense").toFixed(2),
                      count: rest.reduce((n, r) => n + r.count, 0),
                      other: true,
                    },
                  ]
                : []),
            ],
          };
        }),
      };
    }
    const keys = buckets(
      new Date(filters.dateFrom),
      new Date(filters.dateTo),
      input.interval,
    );
    const { totals } = await this.read.summary(userId, {
      ...filters,
      groupBy: "day",
    });
    return {
      type: "component",
      component: "trend",
      title,
      query: filters,
      interval: input.interval,
      series: [...byCurrency(totals)].map(([currency, rows]) => {
        const points = new Map(
          keys.map((k) => [k, { expense: new D(0), income: new D(0) }]),
        );
        for (const r of rows) {
          const point = points.get(bucket(r.group, input.interval));
          if (!point) continue;
          point.expense = point.expense.plus(r.expense);
          point.income = point.income.plus(r.income);
        }
        return {
          currency,
          points: [...points].map(([period, p]) => ({
            period,
            expense: p.expense.toFixed(2),
            income: p.income.toFixed(2),
          })),
        };
      }),
    };
  }
  private async comparison(
    userId: string,
    input: ComparisonInput,
  ): Promise<ComponentBlock> {
    const series = input.series!;
    const metric = input.metric;
    const totals = await Promise.all(
      series.map((s) =>
        this.read.summary(userId, { ...s.filters, groupBy: "currency" }),
      ),
    );
    const currencies = [
      ...new Set(totals.flatMap((t) => t.totals.map((r) => r.currency))),
    ].sort();
    const perSeries = totals.map((t) => byCurrency(t.totals));
    let months: Array<{
      period: string;
      currency: string;
      values: string[];
      difference: string | null;
      cumulative: string | null;
    }> = [];
    if (input.byMonth) {
      const daily = await Promise.all(
        series.map((s) =>
          this.read.summary(userId, { ...s.filters, groupBy: "day" }),
        ),
      );
      const periods = [
        ...new Set(
          daily.flatMap((d) => d.totals.map((r) => r.group.slice(0, 7))),
        ),
      ].sort();
      if (periods.length > MAX_COMPARISON_MONTHS)
        throw new ChatError(400, "Compare at most 60 months at a time.");
      for (const currency of currencies) {
        let running = new D(0);
        for (const period of periods) {
          const values = daily.map((d) =>
            metricOf(
              d.totals.filter(
                (r) => r.currency === currency && r.group.startsWith(period),
              ),
              metric,
            ),
          );
          const difference =
            values.length >= 2 ? values[0].minus(values[1]) : null;
          if (difference) running = running.plus(difference);
          months.push({
            period,
            currency,
            values: values.map((v) => v.toFixed(2)),
            difference: difference?.toFixed(2) ?? null,
            cumulative: difference ? running.toFixed(2) : null,
          });
        }
      }
    }
    return {
      type: "component",
      component: "comparison",
      title: input.title,
      metric,
      series: series.map((s) => ({ label: s.label, query: s.filters })),
      currencies: currencies.map((currency) => {
        const values = perSeries.map((m) =>
          metricOf(m.get(currency) || [], metric),
        );
        return {
          currency,
          totals: values.map((v) => v.toFixed(2)),
          difference:
            values.length >= 2 ? values[0].minus(values[1]).toFixed(2) : null,
        };
      }),
      ...(input.byMonth ? { months } : {}),
    };
  }
}

type ComparisonInput = z.infer<typeof showComponentSchema>;
const metricOf = (rows: Totals, metric: "expense" | "income" | "net") =>
  metric === "net"
    ? sum(rows, "income").minus(sum(rows, "expense"))
    : sum(rows, metric);
const MAX_COMPARISON_MONTHS = 60;
/**
 * What the model sees of a displayed component: the query and headline numbers, never bulk rows.
 * `preview` keeps the first rows' IDs for the current turn so follow-up edits can reference them.
 */
export function componentForModel(block: ComponentBlock, preview: boolean) {
  if (block.component === "transaction_list")
    return {
      displayed: block.component,
      title: block.title,
      query: block.query,
      total: block.total,
      ...(preview
        ? {
            firstRows: block.rows.map((r: any) => ({
              id: r.id,
              date: r.date,
              label: r.label || r.description,
              amountIn: r.amountIn,
              amountOut: r.amountOut,
              currency: r.currency,
              category: r.category?.name,
            })),
          }
        : {}),
    };
  if (block.component === "comparison")
    return {
      displayed: block.component,
      title: block.title,
      metric: block.metric,
      series: block.series,
      currencies: block.currencies,
      ...(preview && block.months ? { months: block.months } : {}),
    };
  if (block.component === "trend")
    return {
      displayed: block.component,
      title: block.title,
      query: block.query,
      interval: block.interval,
      ...(preview ? { series: block.series } : {}),
    };
  const { type: _type, component, ...rest } = block;
  return { displayed: component, ...rest };
}

/** Shrink stored message blocks before they are replayed as conversation history. */
export const compactBlocks = (blocks: unknown) =>
  Array.isArray(blocks)
    ? blocks.map((b: ResultBlock) =>
        b?.type === "component" ? componentForModel(b, false) : b,
      )
    : blocks;

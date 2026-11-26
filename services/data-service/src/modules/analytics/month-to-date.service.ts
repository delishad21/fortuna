import prisma from "../../lib/prisma";
import { asOwnSpending, buildReimbursableSummary } from "./analytics.utils";
import { buildMonthToDate, dayDate, monthToDateFrom } from "./month-to-date";

export const WORKFLOW_MODES = ["daily", "statements"] as const;
export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

export const isWorkflowMode = (value: unknown): value is WorkflowMode =>
  typeof value === "string" && (WORKFLOW_MODES as readonly string[]).includes(value);

const excludedIds = (value: unknown) =>
  new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);

/**
 * How the user mainly works. Until they choose, someone with assistant
 * entries tracks daily and everyone else uploads statements. It only changes
 * what the apps show first.
 */
export async function resolveWorkflowMode(userId: string): Promise<{ mode: WorkflowMode; chosen: boolean }> {
  const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { workflowMode: true } });
  if (isWorkflowMode(settings?.workflowMode)) return { mode: settings.workflowMode, chosen: true };
  const assistant = await prisma.transaction.findFirst({
    where: { userId, entrySource: "assistant" },
    select: { id: true },
  });
  return { mode: assistant ? "daily" : "statements", chosen: false };
}

/** Names of the people the user pays for, by id, for reimbursable summaries. */
export async function reimbursementPeopleNames(userId: string) {
  const people = await prisma.reimbursementPerson.findMany({ where: { userId }, select: { id: true, name: true } });
  return new Map(people.map((person) => [person.id, person.name] as const));
}

/**
 * Month-to-date numbers for the user (see buildMonthToDate). One currency,
 * the user's own, the categories they keep out of analytics left out, and
 * reimbursable spending apart unless they count it as their own: the same
 * rules as GET /api/agent/analytics/spending, so the assistant's answers
 * match the dashboard. `reimbursable` is the month so far for other people.
 */
export async function loadMonthToDate(userId: string, today: string) {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { currency: true, analyticsExcludedCategoryIds: true, analyticsCountReimbursable: true },
  });
  const currency = settings?.currency || "SGD";
  const countsAsOwn = settings?.analyticsCountReimbursable ?? false;
  const excluded = excludedIds(settings?.analyticsExcludedCategoryIds);
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      currency,
      date: { gte: dayDate(monthToDateFrom(today)), lte: new Date(`${today}T23:59:59.999Z`) },
    },
    include: { category: true },
  });
  const kept = asOwnSpending(
    transactions.filter((tx) => !tx.categoryId || !excluded.has(tx.categoryId)),
    countsAsOwn,
  );
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    currency,
    ...buildMonthToDate(kept, today),
    reimbursable: buildReimbursableSummary(
      kept.filter((tx) => tx.date.toISOString().slice(0, 10) >= monthStart),
      await reimbursementPeopleNames(userId),
      countsAsOwn,
    ),
  };
}

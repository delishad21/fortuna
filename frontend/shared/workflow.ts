/**
 * How someone mainly uses Fortuna. It only changes emphasis (what the
 * dashboard leads with, which menu items come first, first-run prompts);
 * every screen and all data stay available in both. Shared by web and mobile.
 */
export const WORKFLOW_MODES = ["daily", "statements"] as const;
export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

export const WORKFLOW_OPTIONS: Array<{ value: WorkflowMode; label: string; description: string }> = [
  {
    value: "daily",
    label: "I mainly track daily",
    description: "The dashboard leads with today, this week and the month so far.",
  },
  {
    value: "statements",
    label: "I mainly upload statements",
    description: "The dashboard leads with your last full month and the next statement to upload.",
  },
];

export const isWorkflowMode = (value: unknown): value is WorkflowMode =>
  typeof value === "string" && (WORKFLOW_MODES as readonly string[]).includes(value);

/**
 * The mode to use: the one chosen in Settings, else daily for someone with
 * assistant entries and statements for everyone else.
 */
export const effectiveWorkflowMode = (chosen: unknown, hasAssistantEntries: boolean): WorkflowMode =>
  isWorkflowMode(chosen) ? chosen : hasAssistantEntries ? "daily" : "statements";

/** Web sidebar order (by URL): daily trackers get the review queue and transactions first. */
export const SIDEBAR_ORDER: Record<WorkflowMode, string[]> = {
  daily: ["/dashboard", "/review", "/transactions", "/analytics", "/reimbursements", "/chat", "/imports", "/trips"],
  statements: ["/dashboard", "/imports", "/transactions", "/review", "/analytics", "/reimbursements", "/trips", "/chat"],
};

/** Phone tab order (by tab name). */
export const TAB_ORDER: Record<WorkflowMode, string[]> = {
  daily: ["Home", "Transactions", "Chat", "Import", "Trips"],
  statements: ["Home", "Transactions", "Import", "Trips", "Chat"],
};

/** Calendar date on this device as YYYY-MM-DD, sent as `today` so "today" is the user's day. */
export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

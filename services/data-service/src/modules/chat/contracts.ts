import { z } from "zod";
export type ChatContext = {
  userId: string;
  runId: string;
  conversationId: string;
};
export type ProviderChoice = "codex" | "openrouter";
export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";
export const CHAT_LIMITS = {
  activeRunsPerUser: 1,
  modelTurns: 12,
  toolCalls: 40,
  runMilliseconds: 900000,
  eventsPerPage: 100,
  messageCharacters: 16000,
  attachmentCount: 5,
  fileBytes: 25 * 1024 * 1024,
  bulkTargets: 100,
} as const;
export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const submitMessageSchema = z
  .object({
    text: z.string().trim().max(CHAT_LIMITS.messageCharacters),
    idempotencyKey: idSchema,
    reviewId: idSchema.optional(),
    reviewVersion: z.number().int().positive().optional(),
    attachmentIds: z
      .array(idSchema)
      .max(CHAT_LIMITS.attachmentCount)
      .default([]),
  })
  .strict()
  .refine(
    (v) => v.text.length > 0 || v.attachmentIds.length > 0,
    "Write a message or attach a statement",
  )
  .refine(
    (v) => new Set(v.attachmentIds).size === v.attachmentIds.length,
    "Attachments must be unique",
  );
export const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    duplicateOverride: z.boolean().default(false),
  })
  .strict();
export const providerSchema = z.enum(["codex", "openrouter"]);
export const connectionSchema = z
  .object({
    provider: providerSchema,
    key: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type MessageInput = z.infer<typeof submitMessageSchema>;
export type ResultBlock =
  | { type: "review"; id: string; title: string }
  | { type: "text"; text: string }
  | {
      type: "link";
      kind: "transaction" | "draft" | "proposal";
      id: string;
      label: string;
    }
  | { type: "data"; title: string; data: unknown };
export type ToolResult = { blocks: ResultBlock[] };
export class ChatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

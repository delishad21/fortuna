import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChatError, idSchema } from "../contracts";
import { TransactionService } from "../../transactions/transactions.service";
import {
  ActionHandler,
  PreparedAction,
  StaleAction,
  stateHash,
  json,
} from "./transactions";
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const settingsActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("create_account"),
      accountIdentifier: z.string().trim().min(1).max(120),
      color: color.default("#6366f1"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("create_category"),
      name: z.string().trim().min(1).max(80),
      color: color.default("#6366f1"),
      icon: z.string().max(60).default("tag"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("update_import_rule"),
      ruleId: idSchema.optional(),
      name: z.string().min(1).max(120),
      parserId: z.string().max(80).nullable().optional(),
      accountIdentifier: z.string().max(120).nullable().optional(),
      matchType: z.enum(["always", "description_contains"]).optional(),
      matchValue: z.string().max(500).nullable().optional(),
      caseSensitive: z.boolean().optional(),
      enabled: z.boolean().optional(),
      setLabel: z.string().max(500).nullable().optional(),
      setCategoryName: z.string().max(80).nullable().optional(),
      markInternal: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    })
    .strict(),
]);
export class SettingsActions implements ActionHandler {
  constructor(private db: PrismaClient) {}
  private async state(
    tx: Prisma.TransactionClient,
    userId: string,
    input: z.infer<typeof settingsActionSchema>,
  ) {
    if (input.kind === "create_account")
      return tx.accountIdentifier.findUnique({
        where: {
          userId_accountIdentifier: {
            userId,
            accountIdentifier: input.accountIdentifier,
          },
        },
      });
    if (input.kind === "create_category")
      return tx.category.findFirst({ where: { userId, name: input.name } });
    if (
      input.accountIdentifier &&
      !(await tx.accountIdentifier.findFirst({
        where: { userId, accountIdentifier: input.accountIdentifier },
      }))
    )
      throw new ChatError(404, "Account not found");
    if (!input.ruleId) return null;
    const rule = await tx.importRule.findFirst({
      where: { id: input.ruleId, userId },
    });
    if (!rule) throw new ChatError(404, "Import rule not found");
    return rule;
  }
  async prepare(userId: string, raw: unknown): Promise<PreparedAction> {
    const input = settingsActionSchema.parse(raw);
    const before = await this.state(this.db, userId, input);
    return {
      kind: input.kind,
      arguments: json(input),
      stateHash: stateHash(before),
      preview: json({
        title:
          input.kind === "create_account"
            ? "Create bank account"
            : input.kind === "create_category"
              ? "Create category"
              : "Change fixed import rule",
        before,
        after: input,
      }),
    };
  }
  async execute(
    tx: Prisma.TransactionClient,
    userId: string,
    raw: unknown,
    hash: string,
  ) {
    const input = settingsActionSchema.parse(raw);
    await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    const before = await this.state(tx, userId, input);
    if (stateHash(before) !== hash)
      throw new StaleAction("Settings changed since the preview");
    if (input.kind === "create_account") {
      if (before) throw new ChatError(409, "Account already exists");
      return json(
        await tx.accountIdentifier.create({
          data: {
            userId,
            accountIdentifier: input.accountIdentifier,
            color: input.color,
          },
        }),
      );
    }
    if (input.kind === "create_category") {
      if (before) throw new ChatError(409, "Category already exists");
      return json(
        await tx.category.create({
          data: {
            userId,
            name: input.name,
            color: input.color,
            icon: input.icon,
          },
        }),
      );
    }
    const { kind, ruleId, ...payload } = input;
    return json(
      ruleId
        ? await TransactionService.updateImportRule(userId, ruleId, payload)
        : await TransactionService.createImportRule(userId, payload),
    );
  }
}

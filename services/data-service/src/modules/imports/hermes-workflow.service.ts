import { reviewDraftRow, summarizeDraftReview } from "./draft-review";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { TransactionService } from "../transactions/transactions.service";
import { TripService } from "../trips/trips.service";
import { createCommitToken, verifyCommitToken } from "./commit-token";
import {
  applyProposalPayload,
  hashValue,
  materializeDraftTransaction,
  proposalCanAutoApply,
  sanitizeStatementFilename,
  validateDraftAccountAssignment,
  validateDraftTransaction,
} from "./hermes-workflow.utils";

const STORAGE_ROOT = path.resolve(
  process.env.STATEMENT_STORAGE_DIR || "/data/statements",
);
const PARSER_SERVICE_URL =
  process.env.PARSER_SERVICE_URL || "http://file-parser:4000";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const COMMIT_TOKEN_TTL_MS = 10 * 60 * 1000;

function commitSecret() {
  const secret = process.env.COMMIT_TOKEN_SECRET;
  if (!secret)
    throw Object.assign(new Error("Commit confirmation is not configured"), {
      status: 503,
    });
  return secret;
}

type Actor = {
  actorType: "api_token" | "trusted_service" | "user" | "system";
  actorId?: string;
  requestId?: string;
  model?: string;
  effort?: string;
  promptVersion?: string;
};

type ProposalInput = {
  draftRowId: string;
  inputRowVersion: number;
  proposedLabel?: string | null;
  proposedCategoryId?: string | null;
  proposedLinkage?: Record<string, unknown> | null;
  proposedTripId?: string | null;
  proposedTripEntryType?: string | null;
  proposedWalletId?: string | null;
  confidence: number;
  reason: string;
  evidence?: Record<string, unknown>;
  idempotencyKey: string;
};

function publicFile(file: {
  id: string;
  filename: string;
  contentType: string;
  sha256: string;
  sizeBytes: number;
  status: string;
  retained: boolean;
  expiresAt: Date;
  createdAt: Date;
}) {
  return {
    id: file.id,
    filename: file.filename,
    contentType: file.contentType,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    status: file.status,
    retained: file.retained,
    expiresAt: file.expiresAt,
    createdAt: file.createdAt,
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  actor: Actor,
  event: {
    toolName: string;
    targetType: string;
    targetId: string;
    beforeValue?: Prisma.InputJsonValue;
    afterValue?: Prisma.InputJsonValue;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.agentAuditEvent.create({
    data: {
      userId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      requestId: actor.requestId,
      model: actor.model,
      effort: actor.effort,
      promptVersion: actor.promptVersion,
      ...event,
    },
  });
}

export class HermesWorkflowService {
  static async cleanupExpiredData(now = new Date()) {
    const files = await prisma.statementFile.findMany({
      where: { retained: false, deletedAt: null, expiresAt: { lte: now } },
      select: { id: true, storagePath: true },
      take: 500,
    });
    if (files.length) {
      await prisma.statementFile.updateMany({
        where: { id: { in: files.map((file) => file.id) } },
        data: { status: "deleted", deletedAt: now },
      });
      await Promise.all(
        files.map((file) => unlink(file.storagePath).catch(() => undefined)),
      );
    }
    const [drafts, workspaces] = await prisma.$transaction([
      prisma.importDraft.updateMany({
        where: {
          expiresAt: { lte: now },
          status: { notIn: ["committed", "discarded"] },
        },
        data: { status: "discarded", discardedAt: now },
      }),
      prisma.parserWorkspace.updateMany({
        where: {
          expiresAt: { lte: now },
          status: { notIn: ["approved", "expired"] },
        },
        data: { status: "expired" },
      }),
    ]);
    return {
      deletedFiles: files.length,
      expiredDrafts: drafts.count,
      expiredWorkspaces: workspaces.count,
    };
  }

  static async registerStatement(
    userId: string,
    file: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
    actor: Actor,
  ) {
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const existing = await prisma.statementFile.findUnique({
      where: { userId_sha256: { userId, sha256 } },
    });
    if (existing && !existing.deletedAt && existing.expiresAt > new Date()) {
      return { ...publicFile(existing), duplicate: true };
    }

    await mkdir(STORAGE_ROOT, { recursive: true, mode: 0o700 });
    const filename = sanitizeStatementFilename(file.originalname);
    const id = existing?.id || `upload_${randomBytes(12).toString("hex")}`;
    const storagePath = path.join(STORAGE_ROOT, id);
    const temporaryPath = `${storagePath}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporaryPath, file.buffer, { mode: 0o600 });
    await rename(temporaryPath, storagePath);

    const record = await prisma.$transaction(async (tx) => {
      const next = existing
        ? await tx.statementFile.update({
            where: { id },
            data: {
              filename,
              contentType: file.mimetype || "application/octet-stream",
              storagePath,
              sizeBytes: file.size,
              status: "available",
              expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
              deletedAt: null,
            },
          })
        : await tx.statementFile.create({
            data: {
              id,
              userId,
              filename,
              contentType: file.mimetype || "application/octet-stream",
              storagePath,
              sha256,
              sizeBytes: file.size,
              expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
            },
          });
      await audit(tx, userId, actor, {
        toolName: "register_statement",
        targetType: "statement_file",
        targetId: next.id,
        metadata: { sha256, sizeBytes: file.size },
      });
      return next;
    });
    return { ...publicFile(record), duplicate: false };
  }

  static async createDraft(
    userId: string,
    input: {
      fileRef: string;
      mode: "main" | "trip";
      parserId?: string;
      targetTripId?: string;
    },
    actor: Actor,
  ) {
    const file = await prisma.statementFile.findFirst({
      where: {
        id: input.fileRef,
        userId,
        status: "available",
        deletedAt: null,
      },
    });
    if (!file || (!file.retained && file.expiresAt <= new Date())) {
      throw Object.assign(new Error("Statement file not found or expired"), {
        status: 404,
      });
    }
    if (input.mode === "trip" && !input.targetTripId) {
      throw Object.assign(
        new Error("targetTripId is required for a trip draft"),
        { status: 400 },
      );
    }
    if (input.targetTripId) {
      const trip = await prisma.trip.findFirst({
        where: { id: input.targetTripId, userId },
      });
      if (!trip)
        throw Object.assign(new Error("Target trip not found"), {
          status: 404,
        });
    }

    const duplicate = await prisma.importDraft.findFirst({
      where: {
        userId,
        sourceSha256: file.sha256,
        mode: input.mode,
        status: { notIn: ["committed", "discarded", "failed"] },
      },
      include: { rows: { orderBy: { rowIndex: "asc" } } },
    });
    if (duplicate) return { ...duplicate, duplicate: true };

    const draft = await prisma.$transaction(async (tx) => {
      const next = await tx.importDraft.create({
        data: {
          userId,
          mode: input.mode,
          parserId: input.parserId,
          sourceFilename: file.filename,
          sourceFileId: file.id,
          sourceSha256: file.sha256,
          targetTripId: input.targetTripId,
          expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
        },
      });
      await audit(tx, userId, actor, {
        toolName: "create_import_draft",
        targetType: "import_draft",
        targetId: next.id,
        afterValue: {
          mode: next.mode,
          parserId: next.parserId,
          fileRef: file.id,
        },
      });
      return next;
    });
    return { ...draft, rows: [], duplicate: false };
  }

  static async listDrafts(userId: string, status?: string) {
    const drafts = await prisma.importDraft.findMany({
      where: { userId, ...(status ? { status } : {}) },
      select: {
        id: true,
        mode: true,
        parserId: true,
        sourceFilename: true,
        status: true,
        version: true,
        targetTripId: true,
        expiresAt: true,
        committedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { rows: true, proposals: true } },
        rows: {
          select: {
            reviewStatus: true,
            selected: true,
            currentPayload: true,
            proposals: {
              select: {
                status: true,
                proposedLinkage: true,
                proposedTripEntryType: true,
                proposedLabel: true,
                proposedCategoryId: true,
                reason: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return drafts.map(({ rows, ...draft }) => ({
      ...draft,
      reviewSummary: summarizeDraftReview(rows),
    }));
  }

  static async getDraft(userId: string, draftId: string) {
    let draft = await prisma.importDraft.findFirst({
      where: { id: draftId, userId },
      include: {
        rows: {
          orderBy: { rowIndex: "asc" },
          include: { proposals: { orderBy: { createdAt: "desc" } } },
        },
        jobs: { orderBy: { createdAt: "desc" } },
        proposals: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!draft)
      throw Object.assign(new Error("Import draft not found"), { status: 404 });
    if (
      draft.mode === "main" &&
      !["committed", "discarded", "expired"].includes(draft.status) &&
      draft.rows.length > 0
    ) {
      await TransactionService.bootstrapDefaultImportRules(userId);
      const currentPayloads = draft.rows.map(
        (row) => row.currentPayload as Record<string, unknown>,
      );
      const ruleApplied = await TransactionService.applyImportRules(
        userId,
        draft.parserId || undefined,
        currentPayloads as never[],
      );
      const changed = draft.rows.flatMap((row, index) =>
        JSON.stringify(currentPayloads[index]) ===
        JSON.stringify(ruleApplied[index])
          ? []
          : [{ row, payload: ruleApplied[index] }],
      );
      if (changed.length > 0) {
        const activeDraftId = draft.id;
        await prisma.$transaction(async (tx) => {
          for (const { row, payload } of changed) {
            const fixedRuleId = String(
              (payload.metadata as Record<string, unknown> | undefined)
                ?.fixedRuleId || "",
            );
            await tx.importDraftRow.update({
              where: { id: row.id },
              data: {
                currentPayload: payload as unknown as Prisma.InputJsonValue,
                reviewStatus: "auto_applied",
                version: { increment: 1 },
                provenance: {
                  source: "fixed_rule",
                  fixedRuleId,
                } as Prisma.InputJsonValue,
              },
            });
            await tx.classificationProposal.updateMany({
              where: { draftRowId: row.id, status: "proposed" },
              data: { status: "stale", decidedAt: new Date() },
            });
          }
          await tx.importDraft.update({
            where: { id: activeDraftId },
            data: {
              status: "review",
              version: { increment: 1 },
              validationHash: null,
              commitTokenHash: null,
              commitTokenExpiresAt: null,
            },
          });
          await audit(
            tx,
            userId,
            { actorType: "system" },
            {
              toolName: "apply_fixed_rules_to_import_draft",
              targetType: "import_draft",
              targetId: activeDraftId,
              metadata: { updatedRows: changed.length },
            },
          );
        });
        draft = await prisma.importDraft.findFirst({
          where: { id: draftId, userId },
          include: {
            rows: {
              orderBy: { rowIndex: "asc" },
              include: { proposals: { orderBy: { createdAt: "desc" } } },
            },
            jobs: { orderBy: { createdAt: "desc" } },
            proposals: { orderBy: { createdAt: "desc" } },
          },
        });
        if (!draft)
          throw Object.assign(new Error("Import draft not found"), {
            status: 404,
          });
      }
    }
    return {
      ...draft,
      reviewSummary: summarizeDraftReview(draft.rows),
      rows: draft.rows.map((row) => ({ ...row, review: reviewDraftRow(row) })),
    };
  }

  static async parseDraft(
    userId: string,
    draftId: string,
    parserId: string,
    actor: Actor,
  ) {
    const draft = await prisma.importDraft.findFirst({
      where: { id: draftId, userId },
      include: { sourceFile: true },
    });
    if (!draft?.sourceFile || draft.sourceFile.deletedAt) {
      throw Object.assign(new Error("Draft source file is unavailable"), {
        status: 404,
      });
    }
    if (["committed", "discarded"].includes(draft.status)) {
      throw Object.assign(new Error(`Cannot parse a ${draft.status} draft`), {
        status: 409,
      });
    }

    await prisma.importDraft.update({
      where: { id: draft.id },
      data: { status: "inspecting", error: null },
    });
    try {
      const bytes = await readFile(draft.sourceFile.storagePath);
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: draft.sourceFile.contentType }),
        draft.sourceFilename,
      );
      form.append("parserId", parserId);
      const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
      if (!internalToken)
        throw new Error("INTERNAL_SERVICE_TOKEN is required for parser calls");
      const response = await fetch(new URL("/parse", PARSER_SERVICE_URL), {
        method: "POST",
        body: form,
        headers: {
          "X-Internal-Service-Token": internalToken,
          "X-Authenticated-User-Id": userId,
        },
      });
      const result = (await response.json()) as {
        error?: string;
        parserVersion?: string;
        transactions?: Array<Record<string, unknown>>;
      };
      if (!response.ok || !Array.isArray(result.transactions)) {
        throw new Error(result.error || `Parser returned ${response.status}`);
      }

      const parsedTransactions =
        draft.mode === "main"
          ? await TransactionService.bootstrapDefaultImportRules(userId).then(
              () =>
                TransactionService.applyImportRules(
                  userId,
                  parserId,
                  result.transactions as never[],
                ),
            )
          : result.transactions;

      return await prisma.$transaction(async (tx) => {
        await tx.classificationProposal.deleteMany({
          where: { draftId: draft.id },
        });
        await tx.classificationJob.deleteMany({ where: { draftId: draft.id } });
        await tx.importDraftRow.deleteMany({ where: { draftId: draft.id } });
        if (parsedTransactions.length > 0) {
          await tx.importDraftRow.createMany({
            data: parsedTransactions.map((transaction, rowIndex) => {
              const fixedRuleId = String(
                (transaction.metadata as Record<string, unknown> | undefined)
                  ?.fixedRuleId || "",
              );
              return {
                draftId: draft.id,
                rowIndex,
                parsedPayload: result.transactions![
                  rowIndex
                ] as Prisma.InputJsonValue,
                currentPayload: transaction as unknown as Prisma.InputJsonValue,
                reviewStatus: fixedRuleId ? "auto_applied" : "unresolved",
                provenance: {
                  parserId,
                  fields: { parser: Object.keys(transaction) },
                  ...(fixedRuleId ? { source: "fixed_rule", fixedRuleId } : {}),
                } as Prisma.InputJsonValue,
              };
            }),
          });
        }
        const next = await tx.importDraft.update({
          where: { id: draft.id },
          data: {
            parserId,
            parserVersion: result.parserVersion || "registry-current",
            status: "review",
            version: { increment: 1 },
            validationHash: null,
            commitTokenHash: null,
            commitTokenExpiresAt: null,
          },
          include: { rows: { orderBy: { rowIndex: "asc" } } },
        });
        await audit(tx, userId, actor, {
          toolName: "parse_import_draft",
          targetType: "import_draft",
          targetId: draft.id,
          metadata: { parserId, rowCount: parsedTransactions.length },
        });
        return next;
      });
    } catch (error) {
      await prisma.importDraft.update({
        where: { id: draft.id },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Parser failed",
        },
      });
      throw error;
    }
  }

  static async updateRow(
    userId: string,
    draftId: string,
    rowId: string,
    input: {
      expectedVersion: number;
      currentPayload?: Record<string, unknown>;
      selected?: boolean;
      reviewStatus?: string;
    },
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.importDraftRow.findFirst({
        where: { id: rowId, draftId, draft: { userId } },
      });
      if (!row)
        throw Object.assign(new Error("Draft row not found"), { status: 404 });
      const parent = await tx.importDraft.findFirst({
        where: { id: draftId, userId },
      });
      if (
        !parent ||
        ["committed", "discarded", "expired"].includes(parent.status) ||
        parent.expiresAt <= new Date()
      )
        throw Object.assign(new Error("This draft is closed or expired"), {
          status: 409,
        });
      if (row.version !== input.expectedVersion) {
        throw Object.assign(new Error("Draft row is stale"), { status: 409 });
      }
      const updated = await tx.importDraftRow.update({
        where: { id: row.id },
        data: {
          ...(input.currentPayload !== undefined
            ? { currentPayload: input.currentPayload as Prisma.InputJsonValue }
            : {}),
          ...(input.selected !== undefined ? { selected: input.selected } : {}),
          ...(input.reviewStatus ? { reviewStatus: input.reviewStatus } : {}),
          version: { increment: 1 },
        },
      });
      const draft = await tx.importDraft.update({
        where: { id: draftId },
        data: {
          version: { increment: 1 },
          status: "review",
          validationHash: null,
          commitTokenHash: null,
        },
      });
      if (input.currentPayload !== undefined)
        await tx.classificationProposal.updateMany({
          where: { draftRowId: row.id, status: "proposed" },
          data: { status: "stale", decidedAt: new Date() },
        });
      if (input.currentPayload === undefined)
        await tx.classificationProposal.updateMany({
          where: {
            draftRowId: row.id,
            status: "proposed",
            inputRowVersion: row.version,
          },
          data: { inputRowVersion: updated.version },
        });
      await audit(tx, userId, actor, {
        toolName: "update_import_draft_row",
        targetType: "import_draft_row",
        targetId: row.id,
        beforeValue: row.currentPayload as Prisma.InputJsonValue,
        afterValue: updated.currentPayload as Prisma.InputJsonValue,
        metadata: { draftVersion: draft.version },
      });
      return updated;
    });
  }

  static async assignDraftAccount(
    userId: string,
    draftId: string,
    input: {
      expectedVersion: number;
      accountIdentifier: string;
      selectedOnly: boolean;
    },
    actor: Actor,
  ) {
    const accountIdentifier = input.accountIdentifier.trim();
    if (!accountIdentifier)
      throw Object.assign(new Error("Account identifier is required"), {
        status: 400,
      });
    return prisma.$transaction(async (tx) => {
      const [draft, account] = await Promise.all([
        tx.importDraft.findFirst({
          where: { id: draftId, userId },
          include: { rows: true },
        }),
        tx.accountIdentifier.findUnique({
          where: { userId_accountIdentifier: { userId, accountIdentifier } },
        }),
      ]);
      if (!draft)
        throw Object.assign(new Error("Import draft not found"), {
          status: 404,
        });
      if (draft.mode !== "main")
        throw Object.assign(
          new Error("Accounts can only be assigned to main-ledger drafts"),
          { status: 409 },
        );
      if (["committed", "discarded"].includes(draft.status)) {
        throw Object.assign(new Error(`Cannot edit a ${draft.status} draft`), {
          status: 409,
        });
      }
      if (draft.version !== input.expectedVersion)
        throw Object.assign(new Error("Import draft is stale"), {
          status: 409,
        });
      if (!account)
        throw Object.assign(
          new Error("Create the account before assigning it to a draft"),
          { status: 409 },
        );
      const rows = draft.rows.filter(
        (row) => !input.selectedOnly || row.selected,
      );
      if (rows.length === 0)
        throw Object.assign(new Error("No matching draft rows to update"), {
          status: 409,
        });
      await Promise.all(
        rows.map((row) =>
          tx.importDraftRow.update({
            where: { id: row.id },
            data: {
              currentPayload: {
                ...(row.currentPayload as Record<string, unknown>),
                accountIdentifier: account.accountIdentifier,
              } as Prisma.InputJsonValue,
              reviewStatus: "edited",
              version: { increment: 1 },
            },
          }),
        ),
      );
      const updated = await tx.importDraft.update({
        where: { id: draft.id },
        data: {
          version: { increment: 1 },
          status: "review",
          validationHash: null,
          commitTokenHash: null,
          commitTokenExpiresAt: null,
          commitTokenUsedAt: null,
        },
        include: { rows: { orderBy: { rowIndex: "asc" } } },
      });
      await audit(tx, userId, actor, {
        toolName: "assign_import_draft_account",
        targetType: "import_draft",
        targetId: draft.id,
        afterValue: {
          accountIdentifier: account.accountIdentifier,
          updatedCount: rows.length,
        },
      });
      return { draft: updated, account, updatedCount: rows.length };
    });
  }

  static async submitProposals(
    userId: string,
    draftId: string,
    input: {
      inputVersion: number;
      jobId?: string;
      model: string;
      effort?: string;
      promptVersion: string;
      proposals: ProposalInput[];
    },
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const requested = input.proposals.map((proposal) => ({
        proposal,
        payloadHash: hashValue({
          ...proposal,
          draftId,
          inputDraftVersion: input.inputVersion,
          model: input.model,
          effort: input.effort,
          promptVersion: input.promptVersion,
        }),
      }));
      const existingIdempotent = await tx.classificationProposal.findMany({
        where: {
          idempotencyKey: {
            in: requested.map((item) => item.proposal.idempotencyKey),
          },
        },
      });
      if (existingIdempotent.length === requested.length) {
        const existingByKey = new Map(
          existingIdempotent.map((proposal) => [
            proposal.idempotencyKey,
            proposal,
          ]),
        );
        return requested.map(({ proposal, payloadHash }) => {
          const existing = existingByKey.get(proposal.idempotencyKey);
          if (
            !existing ||
            existing.draftId !== draftId ||
            existing.payloadHash !== payloadHash
          ) {
            throw Object.assign(
              new Error("Idempotency key was reused with different content"),
              { status: 409 },
            );
          }
          return existing;
        });
      }
      const draft = await tx.importDraft.findFirst({
        where: { id: draftId, userId },
      });
      if (!draft)
        throw Object.assign(new Error("Import draft not found"), {
          status: 404,
        });
      if (draft.version !== input.inputVersion)
        throw Object.assign(new Error("Import draft is stale"), {
          status: 409,
        });
      const rows = await tx.importDraftRow.findMany({
        where: {
          draftId,
          id: { in: input.proposals.map((proposal) => proposal.draftRowId) },
        },
      });
      const rowById = new Map(rows.map((row) => [row.id, row]));
      const categoryIds = [
        ...new Set(
          input.proposals
            .map((item) => item.proposedCategoryId)
            .filter(Boolean),
        ),
      ] as string[];
      if (categoryIds.length) {
        const owned = await tx.category.count({
          where: { userId, id: { in: categoryIds } },
        });
        if (owned !== categoryIds.length)
          throw Object.assign(new Error("A proposed category is invalid"), {
            status: 400,
          });
      }
      const tripIds = [
        ...new Set(
          input.proposals.map((item) => item.proposedTripId).filter(Boolean),
        ),
      ] as string[];
      if (tripIds.length) {
        const owned = await tx.trip.count({
          where: { userId, id: { in: tripIds } },
        });
        if (owned !== tripIds.length)
          throw Object.assign(new Error("A proposed trip is invalid"), {
            status: 400,
          });
      }
      const walletIds = [
        ...new Set(
          input.proposals.map((item) => item.proposedWalletId).filter(Boolean),
        ),
      ] as string[];
      if (walletIds.length) {
        const owned = await tx.wallet.count({
          where: { id: { in: walletIds }, trip: { userId } },
        });
        if (owned !== walletIds.length)
          throw Object.assign(new Error("A proposed wallet is invalid"), {
            status: 400,
          });
      }

      const created = [];
      let autoAppliedCount = 0;
      for (const proposal of input.proposals) {
        const row = rowById.get(proposal.draftRowId);
        if (!row)
          throw Object.assign(new Error("A proposed draft row is invalid"), {
            status: 400,
          });
        if (row.version !== proposal.inputRowVersion)
          throw Object.assign(new Error("A proposed draft row is stale"), {
            status: 409,
          });
        const payloadHash = requested.find(
          (item) => item.proposal === proposal,
        )!.payloadHash;
        const prior = await tx.classificationProposal.findUnique({
          where: { idempotencyKey: proposal.idempotencyKey },
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash || prior.draftId !== draftId) {
            throw Object.assign(
              new Error("Idempotency key was reused with different content"),
              { status: 409 },
            );
          }
          created.push(prior);
          continue;
        }
        const autoApply = proposalCanAutoApply(proposal);
        const next = await tx.classificationProposal.create({
          data: {
            draftId,
            jobId: input.jobId,
            draftRowId: row.id,
            inputDraftVersion: input.inputVersion,
            inputRowVersion: proposal.inputRowVersion,
            proposedLabel: proposal.proposedLabel,
            proposedCategoryId: proposal.proposedCategoryId,
            proposedLinkage:
              (proposal.proposedLinkage as Prisma.InputJsonValue | undefined) ??
              Prisma.JsonNull,
            proposedTripId: proposal.proposedTripId,
            proposedTripEntryType: proposal.proposedTripEntryType,
            proposedWalletId: proposal.proposedWalletId,
            confidence: proposal.confidence,
            reason: proposal.reason,
            evidence:
              (proposal.evidence as Prisma.InputJsonValue | undefined) ??
              Prisma.JsonNull,
            model: input.model,
            effort: input.effort,
            promptVersion: input.promptVersion,
            status: autoApply ? "auto_applied" : "proposed",
            idempotencyKey: proposal.idempotencyKey,
            payloadHash,
            ...(autoApply ? { decidedAt: new Date() } : {}),
          },
        });
        if (autoApply) {
          autoAppliedCount += 1;
          const current = row.currentPayload as Record<string, unknown>;
          const updatedPayload = applyProposalPayload(current, proposal);
          await tx.importDraftRow.update({
            where: { id: row.id },
            data: {
              currentPayload: updatedPayload as Prisma.InputJsonValue,
              reviewStatus: "auto_applied",
              version: { increment: 1 },
              provenance: {
                source: "hermes",
                proposalId: next.id,
                model: input.model,
                promptVersion: input.promptVersion,
              },
            },
          });
        } else {
          await tx.importDraftRow.update({
            where: { id: row.id },
            data: { reviewStatus: "proposed" },
          });
        }
        created.push(next);
      }
      if (autoAppliedCount > 0) {
        await tx.importDraft.update({
          where: { id: draftId },
          data: { version: { increment: 1 } },
        });
      }
      await audit(
        tx,
        userId,
        {
          ...actor,
          model: input.model,
          effort: input.effort,
          promptVersion: input.promptVersion,
        },
        {
          toolName: "submit_classification_proposals",
          targetType: "import_draft",
          targetId: draftId,
          metadata: { proposalCount: created.length },
        },
      );
      return created;
    });
  }

  static async decideProposal(
    userId: string,
    proposalId: string,
    decision: "accept" | "reject",
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.classificationProposal.findFirst({
        where: { id: proposalId, draft: { userId } },
        include: { draft: true, draftRow: true },
      });
      if (!proposal)
        throw Object.assign(new Error("Proposal not found"), { status: 404 });
      if (
        ["committed", "discarded", "expired"].includes(proposal.draft.status) ||
        proposal.draft.expiresAt <= new Date()
      )
        throw Object.assign(new Error("This draft is closed or expired"), {
          status: 409,
        });
      if (proposal.status !== "proposed")
        throw Object.assign(
          new Error(`Proposal is already ${proposal.status}`),
          { status: 409 },
        );
      if (proposal.inputRowVersion !== proposal.draftRow.version) {
        await tx.classificationProposal.update({
          where: { id: proposal.id },
          data: { status: "stale", decidedAt: new Date() },
        });
        throw Object.assign(new Error("Proposal is stale"), { status: 409 });
      }
      if (decision === "accept") {
        // Decisions on other rows do not invalidate this row's unchanged payload.
        const payload = applyProposalPayload(
          proposal.draftRow.currentPayload as Record<string, unknown>,
          proposal,
        );
        await tx.importDraftRow.update({
          where: { id: proposal.draftRowId },
          data: {
            currentPayload: payload as Prisma.InputJsonValue,
            version: { increment: 1 },
            reviewStatus: "accepted",
            provenance: { source: "hermes", proposalId },
          },
        });
      } else {
        await tx.importDraftRow.update({
          where: { id: proposal.draftRowId },
          data: { reviewStatus: "rejected" },
        });
      }
      const updated = await tx.classificationProposal.update({
        where: { id: proposal.id },
        data: {
          status: decision === "accept" ? "accepted" : "rejected",
          decidedAt: new Date(),
        },
      });
      if (decision === "accept")
        await tx.classificationProposal.updateMany({
          where: {
            draftRowId: proposal.draftRowId,
            status: "proposed",
            id: { not: proposal.id },
          },
          data: { status: "stale", decidedAt: new Date() },
        });
      await tx.importDraft.update({
        where: { id: proposal.draftId },
        data: { version: { increment: 1 } },
      });
      await audit(tx, userId, actor, {
        toolName: `${decision}_classification_proposal`,
        targetType: "classification_proposal",
        targetId: proposal.id,
      });
      return updated;
    });
  }

  static async createJob(
    userId: string,
    draftId: string,
    targetType: string,
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const draft = await tx.importDraft.findFirst({
        where: { id: draftId, userId },
      });
      if (!draft)
        throw Object.assign(new Error("Import draft not found"), {
          status: 404,
        });
      const job = await tx.classificationJob.create({
        data: { userId, draftId, targetType, inputVersion: draft.version },
      });
      await audit(tx, userId, actor, {
        toolName: "create_classification_job",
        targetType: "classification_job",
        targetId: job.id,
      });
      return job;
    });
  }

  static async claimJob(
    userId: string,
    agentId: string,
    capabilities: string[],
    leaseSeconds = 300,
  ) {
    const now = new Date();
    const candidates = await prisma.classificationJob.findMany({
      where: {
        userId,
        OR: [
          { status: "queued" },
          { status: "claimed", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    const candidate = candidates.find(
      (job) =>
        capabilities.length === 0 || capabilities.includes(job.targetType),
    );
    if (!candidate) return null;
    const claimed = await prisma.classificationJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: "queued" },
          { status: "claimed", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "claimed",
        claimedBy: agentId,
        capabilities,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return prisma.classificationJob.findUnique({ where: { id: candidate.id } });
  }

  static async finishJob(
    userId: string,
    jobId: string,
    agentId: string,
    result: { success: boolean; retryable?: boolean; error?: string },
  ) {
    const job = await prisma.classificationJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job)
      throw Object.assign(new Error("Classification job not found"), {
        status: 404,
      });
    if (job.status !== "claimed" || job.claimedBy !== agentId)
      throw Object.assign(
        new Error("Classification job is not claimed by this agent"),
        { status: 409 },
      );
    return prisma.classificationJob.update({
      where: { id: job.id },
      data: result.success
        ? {
            status: "completed",
            completedAt: new Date(),
            leaseExpiresAt: null,
            error: null,
          }
        : {
            status: result.retryable ? "queued" : "failed",
            leaseExpiresAt: null,
            claimedBy: result.retryable ? null : job.claimedBy,
            error: result.error || "Agent failed",
          },
    });
  }

  static async validateDraft(userId: string, draftId: string) {
    const draft = await this.getDraft(userId, draftId);
    const selectedRows = draft.rows.filter((row) => row.selected);
    const errors = selectedRows.flatMap((row) =>
      validateDraftTransaction(
        row.currentPayload as Record<string, unknown>,
      ).map((message) => ({ rowId: row.id, rowIndex: row.rowIndex, message })),
    );
    const selectedAccountIdentifiers = selectedRows.map((row) =>
      String(
        (row.currentPayload as Record<string, unknown>).accountIdentifier || "",
      ).trim(),
    );
    const distinctAccountIdentifiers = [
      ...new Set(selectedAccountIdentifiers.filter(Boolean)),
    ];
    const knownAccounts =
      draft.mode === "main" && distinctAccountIdentifiers.length > 0
        ? await prisma.accountIdentifier.findMany({
            where: {
              userId,
              accountIdentifier: { in: distinctAccountIdentifiers },
            },
            select: { accountIdentifier: true },
          })
        : [];
    const knownIdentifiers = new Set(
      knownAccounts.map((account) => account.accountIdentifier),
    );
    selectedRows.forEach((row) => {
      validateDraftAccountAssignment(
        draft.mode,
        row.currentPayload as Record<string, unknown>,
        knownIdentifiers,
      ).forEach((message) =>
        errors.push({ rowId: row.id, rowIndex: row.rowIndex, message }),
      );
    });
    const selectedRowIds = new Set(selectedRows.map((row) => row.id));
    const highImpact = draft.proposals.filter(
      (proposal) =>
        selectedRowIds.has(proposal.draftRowId) &&
        proposal.status === "proposed" &&
        (proposal.proposedLinkage ||
          proposal.proposedTripEntryType === "reimbursement" ||
          proposal.proposedTripEntryType === "funding_in" ||
          proposal.proposedTripEntryType === "funding_out"),
    );
    return {
      valid:
        errors.length === 0 &&
        highImpact.length === 0 &&
        selectedRows.length > 0,
      draftVersion: draft.version,
      errors,
      warnings: highImpact.map((proposal) => ({
        proposalId: proposal.id,
        message: "High-impact proposal requires review",
      })),
      summary: {
        rows: draft.rows.length,
        selected: selectedRows.length,
        autoApplied: draft.proposals.filter(
          (proposal) => proposal.status === "auto_applied",
        ).length,
        needsReview: summarizeDraftReview(draft.rows).needsReview,
        accountIdentifiers: distinctAccountIdentifiers,
        missingAccountAssignments: selectedAccountIdentifiers.filter(
          (value) => !value,
        ).length,
        unknownAccountIdentifiers: distinctAccountIdentifiers.filter(
          (value) => !knownIdentifiers.has(value),
        ),
      },
    };
  }

  static async prepareCommit(userId: string, draftId: string, actor: Actor) {
    const validation = await this.validateDraft(userId, draftId);
    if (!validation.valid) return validation;
    const draft = await this.getDraft(userId, draftId);
    const selected = draft.rows
      .filter((row) => row.selected)
      .map((row) => row.currentPayload as Record<string, unknown>);
    const duplicates =
      draft.mode === "main"
        ? await TransactionService.checkImport(
            userId,
            selected.map(materializeDraftTransaction) as never[],
          )
        : { duplicates: [], cleanCount: selected.length };
    const validationHash = hashValue({
      draftId,
      draftVersion: draft.version,
      selected: draft.rows
        .filter((row) => row.selected)
        .map((row) => ({
          id: row.id,
          version: row.version,
          payload: row.currentPayload,
        })),
      duplicates: duplicates.duplicates.map((item) => item.index),
    });
    const expiresAt = new Date(Date.now() + COMMIT_TOKEN_TTL_MS);
    const confirmationToken = createCommitToken(
      {
        userId,
        draftId,
        draftVersion: draft.version,
        validationHash,
        expiresAt: expiresAt.toISOString(),
        nonce: randomBytes(16).toString("base64url"),
      },
      commitSecret(),
    );
    await prisma.$transaction(async (tx) => {
      await tx.importDraft.update({
        where: { id: draftId },
        data: {
          status: "valid",
          validationHash,
          commitTokenHash: createHash("sha256")
            .update(confirmationToken)
            .digest("hex"),
          commitTokenExpiresAt: expiresAt,
          commitTokenUsedAt: null,
        },
      });
      await audit(tx, userId, actor, {
        toolName: "validate_import_draft",
        targetType: "import_draft",
        targetId: draftId,
        metadata: {
          validationHash,
          duplicateCount: duplicates.duplicates.length,
        },
      });
    });
    return {
      ...validation,
      duplicates: duplicates.duplicates,
      confirmationToken,
      confirmationExpiresAt: expiresAt,
    };
  }

  static async commitDraft(
    userId: string,
    draftId: string,
    confirmationToken: string,
    confirmed: boolean,
    actor: Actor,
  ) {
    if (!confirmed)
      throw Object.assign(new Error("Explicit user confirmation is required"), {
        status: 400,
      });
    const payload = verifyCommitToken(confirmationToken, commitSecret());
    if (!payload || payload.userId !== userId || payload.draftId !== draftId) {
      throw Object.assign(
        new Error("Commit confirmation token is invalid or expired"),
        { status: 401 },
      );
    }
    const draft = await this.getDraft(userId, draftId);
    const tokenHash = createHash("sha256")
      .update(confirmationToken)
      .digest("hex");
    if (
      draft.version !== payload.draftVersion ||
      draft.validationHash !== payload.validationHash ||
      draft.commitTokenHash !== tokenHash ||
      !draft.commitTokenExpiresAt ||
      draft.commitTokenExpiresAt <= new Date() ||
      draft.commitTokenUsedAt
    ) {
      throw Object.assign(
        new Error("Commit confirmation is stale or already used"),
        { status: 409 },
      );
    }
    const freshValidation = await this.validateDraft(userId, draftId);
    if (!freshValidation.valid)
      throw Object.assign(new Error("Draft is no longer valid"), {
        status: 409,
        validation: freshValidation,
      });
    const claimed = await prisma.importDraft.updateMany({
      where: {
        id: draftId,
        userId,
        version: payload.draftVersion,
        commitTokenHash: tokenHash,
        commitTokenUsedAt: null,
      },
      data: { commitTokenUsedAt: new Date() },
    });
    if (claimed.count !== 1)
      throw Object.assign(new Error("Commit confirmation is already in use"), {
        status: 409,
      });

    const rows = draft.rows.map(
      (row) => row.currentPayload as Record<string, any>,
    );
    const selectedIndices = draft.rows.flatMap((row, index) =>
      row.selected ? [index] : [],
    );
    const sourceFile = draft.sourceFileId
      ? await prisma.statementFile.findFirst({
          where: { id: draft.sourceFileId, userId },
        })
      : null;
    try {
      let result: Record<string, unknown>;
      if (draft.mode === "main") {
        const committed = await TransactionService.commitImport(
          userId,
          rows.map(materializeDraftTransaction) as never[],
          selectedIndices,
          {
            filename: draft.sourceFilename,
            fileType:
              path.extname(draft.sourceFilename).replace(".", "") || "unknown",
            parserId: draft.parserId || "unknown",
          },
        );
        if (!committed.success)
          throw new Error(committed.error || "Import commit failed");
        result = committed as unknown as Record<string, unknown>;
      } else {
        if (!draft.targetTripId)
          throw new Error("Trip draft has no target trip");
        const selectedRows = rows.filter((_row, index) =>
          selectedIndices.includes(index),
        );
        const walletIds = [
          ...new Set(selectedRows.map((row) => row.walletId).filter(Boolean)),
        ] as string[];
        if (walletIds.length > 1)
          throw new Error("A trip draft commit currently requires one wallet");
        result = (await TripService.importTripSpendings(
          userId,
          draft.targetTripId,
          walletIds[0] || null,
          draft.parserId,
          selectedRows as never[],
        )) as unknown as Record<string, unknown>;
      }
      const batchId =
        typeof result.batchId === "string" ? result.batchId : null;
      await prisma.$transaction(async (tx) => {
        await tx.importDraft.update({
          where: { id: draftId },
          data: {
            status: "committed",
            committedAt: new Date(),
            committedImportBatchId: batchId,
          },
        });
        if (sourceFile && !sourceFile.retained) {
          await tx.statementFile.update({
            where: { id: sourceFile.id },
            data: { status: "deleted", deletedAt: new Date() },
          });
        }
        await audit(tx, userId, actor, {
          toolName: "commit_import_draft",
          targetType: "import_draft",
          targetId: draftId,
          metadata: {
            validationHash: payload.validationHash,
            result: result as Prisma.InputJsonValue,
          },
        });
      });
      if (sourceFile && !sourceFile.retained) {
        await unlink(sourceFile.storagePath).catch(() => undefined);
      }
      return { success: true, draftId, ...result };
    } catch (error) {
      await prisma.importDraft.updateMany({
        where: { id: draftId, status: { not: "committed" } },
        data: { commitTokenUsedAt: null },
      });
      throw error;
    }
  }

  static async discardDraft(userId: string, draftId: string, actor: Actor) {
    const draft = await prisma.importDraft.findFirst({
      where: { id: draftId, userId },
      include: { sourceFile: true },
    });
    if (!draft)
      throw Object.assign(new Error("Import draft not found"), { status: 404 });
    if (draft.status === "committed")
      throw Object.assign(new Error("Committed drafts cannot be discarded"), {
        status: 409,
      });
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.importDraft.update({
        where: { id: draft.id },
        data: {
          status: "discarded",
          discardedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (draft.sourceFile && !draft.sourceFile.retained) {
        await tx.statementFile.update({
          where: { id: draft.sourceFile.id },
          data: { status: "deleted", deletedAt: new Date() },
        });
      }
      await audit(tx, userId, actor, {
        toolName: "discard_import_draft",
        targetType: "import_draft",
        targetId: draft.id,
      });
      return next;
    });
    if (draft.sourceFile && !draft.sourceFile.retained)
      await unlink(draft.sourceFile.storagePath).catch(() => undefined);
    return updated;
  }
}

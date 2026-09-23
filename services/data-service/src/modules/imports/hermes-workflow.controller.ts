import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";
import { HermesWorkflowService } from "./hermes-workflow.service";

export const hermesWorkflowRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (_request, file, callback) => {
    const allowed = new Set([
      "application/pdf",
      "text/csv",
      "text/plain",
      "application/csv",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ]);
    if (allowed.has(file.mimetype)) callback(null, true);
    else callback(new Error("Unsupported statement content type"));
  },
});

const CreateDraftSchema = z.object({
  fileRef: z.string().min(1),
  mode: z.enum(["main", "trip"]),
  parserId: z.string().min(1).optional(),
  targetTripId: z.string().min(1).optional(),
}).strict();

const UpdateRowSchema = z.object({
  expectedVersion: z.number().int().positive(),
  currentPayload: z.record(z.unknown()).optional(),
  selected: z.boolean().optional(),
  reviewStatus: z.enum(["unresolved", "proposed", "auto_applied", "accepted", "edited", "rejected"]).optional(),
}).strict();

const ProposalSchema = z.object({
  draftRowId: z.string().min(1),
  inputRowVersion: z.number().int().positive(),
  proposedLabel: z.string().max(500).nullable().optional(),
  proposedCategoryId: z.string().nullable().optional(),
  proposedLinkage: z.record(z.unknown()).nullable().optional(),
  proposedTripId: z.string().nullable().optional(),
  proposedTripEntryType: z.enum(["spending", "reimbursement", "funding_in", "funding_out"]).nullable().optional(),
  proposedWalletId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(2000),
  evidence: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(200),
}).strict();

const SubmitProposalsSchema = z.object({
  inputVersion: z.number().int().positive(),
  jobId: z.string().optional(),
  model: z.string().min(1).max(100),
  effort: z.string().max(30).optional(),
  promptVersion: z.string().min(1).max(100),
  proposals: z.array(ProposalSchema).min(1).max(500),
}).strict();

function actor(request: Request) {
  return {
    actorType: request.apiAuth?.actorType || ("api_token" as const),
    actorId: request.apiAuth?.tokenId,
    requestId: request.header("x-request-id") || undefined,
  };
}

function sendError(response: Response, error: unknown) {
  const candidate = error as { status?: number; message?: string; issues?: unknown };
  return response.status(candidate.status || (candidate.issues ? 400 : 500)).json({
    error: candidate.message || "Unexpected workflow error",
  });
}

hermesWorkflowRouter.post(
  "/statements",
  requireAccountAuth(["statements:write"]),
  upload.single("file"),
  async (request, response) => {
    try {
      if (!request.file) return response.status(400).json({ error: "Statement file is required" });
      const statement = await HermesWorkflowService.registerStatement(authenticatedUserId(request), request.file, actor(request));
      return response.status(statement.duplicate ? 200 : 201).json({ statement });
    } catch (error) {
      return sendError(response, error);
    }
  },
);

hermesWorkflowRouter.get("/statements/:fileRef", requireAccountAuth(["drafts:read"]), async (request, response) => {
  try {
    const statement = await (await import("../../lib/prisma")).default.statementFile.findFirst({
      where: { id: request.params.fileRef, userId: authenticatedUserId(request), deletedAt: null },
      select: { id: true, filename: true, contentType: true, sha256: true, sizeBytes: true, status: true, retained: true, expiresAt: true, createdAt: true },
    });
    if (!statement) return response.status(404).json({ error: "Statement file not found" });
    return response.json({ statement });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/drafts", requireAccountAuth(["drafts:write"]), async (request, response) => {
  try {
    const input = CreateDraftSchema.parse(request.body);
    const draft = await HermesWorkflowService.createDraft(authenticatedUserId(request), input, actor(request));
    return response.status(draft.duplicate ? 200 : 201).json({ draft });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.get("/drafts", requireAccountAuth(["drafts:read"]), async (request, response) => {
  try {
    const drafts = await HermesWorkflowService.listDrafts(authenticatedUserId(request), request.query.status ? String(request.query.status) : undefined);
    return response.json({ drafts });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/drafts/validate-selection", requireAccountAuth(["drafts:read"]), async (request, response) => {
  try {
    const { draftIds } = z.object({
      draftIds: z.array(z.string().min(1)).min(1).max(20).refine((ids) => new Set(ids).size === ids.length),
    }).strict().parse(request.body);
    return response.json(await HermesWorkflowService.prepareSelection(authenticatedUserId(request), draftIds, actor(request)));
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.get("/drafts/:draftId", requireAccountAuth(["drafts:read"]), async (request, response) => {
  try {
    return response.json({ draft: await HermesWorkflowService.getDraft(authenticatedUserId(request), request.params.draftId) });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/drafts/:draftId/parse", requireAccountAuth(["statements:write", "drafts:write"]), async (request, response) => {
  try {
    const { parserId } = z.object({ parserId: z.string().min(1) }).strict().parse(request.body);
    return response.json({ draft: await HermesWorkflowService.parseDraft(authenticatedUserId(request), request.params.draftId, parserId, actor(request)) });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.patch("/drafts/:draftId/rows/:rowId", requireAccountAuth(["drafts:write"]), async (request, response) => {
  try {
    const input = UpdateRowSchema.parse(request.body);
    return response.json({ row: await HermesWorkflowService.updateRow(authenticatedUserId(request), request.params.draftId, request.params.rowId, input, actor(request)) });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.patch("/drafts/:draftId/account", requireAccountAuth(["drafts:write", "accounts:read"]), async (request, response) => {
  try {
    const input = z.object({
      expectedVersion: z.number().int().positive(),
      accountIdentifier: z.string().trim().min(1).max(120),
      selectedOnly: z.boolean().default(true),
    }).strict().parse(request.body);
    return response.json(await HermesWorkflowService.assignDraftAccount(
      authenticatedUserId(request), request.params.draftId, input, actor(request),
    ));
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/drafts/:draftId/proposals", requireAccountAuth(["classification:write"]), async (request, response) => {
  try {
    const input = SubmitProposalsSchema.parse(request.body);
    return response.status(201).json({ proposals: await HermesWorkflowService.submitProposals(authenticatedUserId(request), request.params.draftId, input, actor(request)) });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/proposals/:proposalId/decision", requireAccountAuth(["drafts:write"]), async (request, response) => {
  try {
    const { decision } = z.object({ decision: z.enum(["accept", "reject"]) }).strict().parse(request.body);
    return response.json({ proposal: await HermesWorkflowService.decideProposal(authenticatedUserId(request), request.params.proposalId, decision, actor(request)) });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/drafts/:draftId/validate", requireAccountAuth(["drafts:read"]), async (request, response) => {
  try {
    return response.json(await HermesWorkflowService.prepareCommit(authenticatedUserId(request), request.params.draftId, actor(request)));
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/drafts/:draftId/commit", requireAccountAuth(["imports:commit"]), async (request, response) => {
  try {
    const input = z.object({ confirmationToken: z.string().min(1), confirmed: z.literal(true) }).strict().parse(request.body);
    return response.json(await HermesWorkflowService.commitDraft(authenticatedUserId(request), request.params.draftId, input.confirmationToken, input.confirmed, actor(request)));
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.delete("/drafts/:draftId", requireAccountAuth(["drafts:write"]), async (request, response) => {
  try {
    return response.json({ draft: await HermesWorkflowService.discardDraft(authenticatedUserId(request), request.params.draftId, actor(request)) });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/drafts/:draftId/jobs", requireAccountAuth(["classification:write"]), async (request, response) => {
  try {
    const { targetType } = z.object({ targetType: z.enum(["main_import", "trip_import", "parser_development", "existing_transactions"]) }).strict().parse(request.body);
    return response.status(201).json({ job: await HermesWorkflowService.createJob(authenticatedUserId(request), request.params.draftId, targetType, actor(request)) });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/jobs/claim", requireAccountAuth(["classification:write"]), async (request, response) => {
  try {
    const input = z.object({ agentId: z.string().min(1).max(100), capabilities: z.array(z.string()).max(20).default([]), leaseSeconds: z.number().int().min(30).max(1800).default(300) }).strict().parse(request.body);
    return response.json({ job: await HermesWorkflowService.claimJob(authenticatedUserId(request), input.agentId, input.capabilities, input.leaseSeconds) });
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.get("/jobs/:jobId/context", requireAccountAuth(["classification:write", "drafts:read"]), async (request, response) => {
  try {
    const job = await prismaJobContext(authenticatedUserId(request), request.params.jobId);
    return response.json(job);
  } catch (error) {
    return sendError(response, error);
  }
});

hermesWorkflowRouter.post("/jobs/:jobId/finish", requireAccountAuth(["classification:write"]), async (request, response) => {
  try {
    const input = z.object({ agentId: z.string().min(1), success: z.boolean(), retryable: z.boolean().optional(), error: z.string().max(4000).optional() }).strict().parse(request.body);
    return response.json({ job: await HermesWorkflowService.finishJob(authenticatedUserId(request), request.params.jobId, input.agentId, input) });
  } catch (error) {
    return sendError(response, error);
  }
});

async function prismaJobContext(userId: string, jobId: string) {
  const job = await (await import("../../lib/prisma")).default.classificationJob.findFirst({
    where: { id: jobId, userId },
    include: { draft: { include: { rows: { orderBy: { rowIndex: "asc" } } } } },
  });
  if (!job) throw Object.assign(new Error("Classification job not found"), { status: 404 });
  return { job, draft: job.draft };
}

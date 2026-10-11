import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { LinkError, Role } from "./links.core";
import { listCandidates, auditLinks } from "./links.queries";
import {
  replaceLinks,
  runInTransaction,
  syncTransactionCaches,
  touchDraftRows,
} from "./links.service";

export const reimbursementRouter = Router();

const endRef = z.union([
  z.object({ transactionId: z.string().min(1) }).strict(),
  z.object({ draftRowId: z.string().min(1) }).strict(),
]);

const replaceSchema = z
  .object({
    userId: z.string().min(1),
    subject: endRef,
    role: z.enum(["reimbursement", "expense"]),
    links: z
      .array(z.object({ other: endRef, amount: z.number().finite().nonnegative() }).strict())
      .max(200),
    leftoverCategoryId: z.string().min(1).nullable().optional(),
    contextDraftIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict();

const sendError = (res: Response, error: unknown) => {
  if (error instanceof LinkError)
    return res.status(error.status).json({ error: error.message });
  if (error instanceof z.ZodError)
    return res.status(400).json({ error: error.issues[0]?.message || "Invalid request" });
  const status = (error as { status?: number }).status;
  return res
    .status(typeof status === "number" ? status : 400)
    .json({ error: error instanceof Error ? error.message : "Request failed" });
};

/**
 * GET /api/reimbursements/candidates
 * What a transaction or staged row can link to, with each candidate's
 * linked, pending and available amounts.
 */
reimbursementRouter.get("/candidates", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const transactionId = req.query.transactionId ? String(req.query.transactionId) : "";
    const draftRowId = req.query.draftRowId ? String(req.query.draftRowId) : "";
    if (!!transactionId === !!draftRowId)
      return res.status(400).json({ error: "Pass transactionId or draftRowId" });
    const lookingFor = String(req.query.lookingFor || "") as Role;
    if (lookingFor !== "reimbursement" && lookingFor !== "expense")
      return res.status(400).json({ error: "lookingFor must be reimbursement or expense" });
    const result = await listCandidates({
      userId,
      subject: transactionId ? { transactionId } : { draftRowId },
      lookingFor,
      query: req.query.query ? String(req.query.query) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      contextDraftIds: req.query.contextDraftIds
        ? String(req.query.contextDraftIds).split(",").map((id) => id.trim()).filter(Boolean)
        : undefined,
      categoryId: req.query.categoryId === undefined ? undefined : String(req.query.categoryId),
      dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
      dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
      amountEquals: req.query.amountEquals ? Number(req.query.amountEquals) : undefined,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * PUT /api/reimbursements/links
 * Replace every link the subject holds in `role`. Works for saved
 * transactions and staged rows, in either direction.
 */
reimbursementRouter.put("/links", async (req: Request, res: Response) => {
  try {
    const input = replaceSchema.parse(req.body);
    const result = await runInTransaction(async (db) => {
      if (input.leftoverCategoryId !== undefined && input.role === "reimbursement") {
        await setLeftoverCategory(db, input.userId, input.subject, input.leftoverCategoryId);
      }
      return replaceLinks(db, input.userId, {
        subject: input.subject,
        role: input.role,
        links: input.links.map((link) => ({ other: link.other, amount: link.amount })),
        contextDraftIds: input.contextDraftIds,
      });
    });
    res.json({ success: true, warnings: result.warnings });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/reimbursements/audit
 * Report (and with fix=true repair) drift between links and cached linkage.
 */
reimbursementRouter.post("/audit", async (req: Request, res: Response) => {
  try {
    const userId = String(req.body?.userId || "");
    if (!userId) return res.status(400).json({ error: "userId is required" });
    res.json(await auditLinks({ userId, fix: req.body?.fix === true }));
  } catch (error) {
    sendError(res, error);
  }
});

async function setLeftoverCategory(
  db: Prisma.TransactionClient,
  userId: string,
  subject: { transactionId?: string; draftRowId?: string },
  leftoverCategoryId: string | null,
) {
  if (leftoverCategoryId) {
    const category = await db.category.findFirst({ where: { id: leftoverCategoryId, userId } });
    if (!category) throw new LinkError("Category not found", 404);
  }
  if (subject.transactionId) {
    const row = await db.transaction.findFirst({
      where: { id: subject.transactionId, userId },
      select: { linkage: true },
    });
    const linkage = (row?.linkage || null) as Record<string, unknown> | null;
    if (!row || linkage?.type !== "reimbursement") return;
    await db.transaction.update({
      where: { id: subject.transactionId },
      data: { linkage: { ...linkage, leftoverCategoryId } as Prisma.InputJsonValue },
    });
    await syncTransactionCaches(db, userId, [subject.transactionId]);
    return;
  }
  const row = await db.importDraftRow.findFirst({
    where: { id: subject.draftRowId, draft: { userId } },
    select: { id: true, currentPayload: true },
  });
  const payload = (row?.currentPayload || {}) as Record<string, unknown>;
  const linkage = (payload.linkage || null) as Record<string, unknown> | null;
  if (!row || linkage?.type !== "reimbursement") return;
  await db.importDraftRow.update({
    where: { id: row.id },
    data: {
      currentPayload: {
        ...payload,
        linkage: { ...linkage, leftoverCategoryId },
      } as Prisma.InputJsonValue,
    },
  });
  await touchDraftRows(db, userId, [row.id]);
}


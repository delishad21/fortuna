import type { PrismaClient } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import prisma from "../../lib/prisma";
import { withDatabase } from "../../lib/database-context";
import { authenticatedUserId, requireAccountAuth, requireAccountAuthAnyOf } from "../auth/auth.middleware";
import { EntryError, type EntryActor } from "../transactions/assistant-entries.service";
import { LinkError } from "./links.core";
import {
  applyBackfill,
  backfillProposal,
  clearReimbursable,
  confirmRepayment,
  createPerson,
  deletePerson,
  listPeople,
  listRepaymentProposals,
  outstanding,
  setReimbursable,
  updatePerson,
} from "./reimbursables.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates are YYYY-MM-DD");
const ids = z.array(z.string().min(1)).min(1).max(500);
const share = z
  .union([
    z.literal("full"),
    z.string().max(20),
    z.number().gt(0).max(1),
    z.object({ amount: z.number().positive() }).strict(),
    z.object({ fraction: z.number().gt(0).max(1) }).strict(),
  ])
  .optional();
const note = z.string().max(500).nullable().optional();
const aliases = z.array(z.string().trim().min(1).max(120)).max(20).optional();
const flag = (value: unknown) => value === true || value === "true";

const PersonSchema = z.object({ name: z.string().trim().min(1).max(80), aliases }).strict();
const PersonPatchSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), aliases, archived: z.boolean().optional() })
  .strict();
const SearchSchema = z
  .object({
    query: z.string().max(200).optional(),
    dateFrom: day.optional(),
    dateTo: day.optional(),
    account: z.string().max(120).optional(),
    category: z.string().max(120).optional(),
  })
  .strict();
const SetSchema = z
  .object({
    ids: ids.optional(),
    search: SearchSchema.optional(),
    person: z.string().trim().min(1).max(120),
    createPerson: z.boolean().optional(),
    share,
    note,
    preview: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !!value.ids?.length !== !!value.search, "Pass ids or search, not both");
const LinksSchema = z.array(z.object({ transactionId: z.string().min(1), amount: z.number().positive() }).strict()).min(1).max(200);
const ConfirmSchema = z
  .object({ transactionId: z.string().min(1), links: LinksSchema, markReviewed: z.boolean().optional() })
  .strict();
const BackfillApplySchema = z
  .object({
    person: z.string().trim().min(1).max(120),
    items: z.array(z.object({ transactionId: z.string().min(1), share, note }).strict()).max(2000),
    links: z.array(z.object({ repaymentId: z.string().min(1), links: LinksSchema }).strict()).max(200).optional(),
  })
  .strict();

/**
 * Reimbursable spending, under /api/agent/reimbursables: the people the user
 * pays for, marking items reimbursable (by ids or a search), what each person
 * owes, repayment link proposals and the one-off backfill. Reading is open to
 * transactions:review or analytics:read; changes need transactions:review.
 * The apps call the same routes as the trusted frontend.
 */
export function createReimbursablesRouter(db: PrismaClient = prisma) {
  const router = Router();
  router.use((_request, _response, next) => void withDatabase(db, async () => next()));
  const read = requireAccountAuthAnyOf(["transactions:review", "analytics:read"]);
  const write = requireAccountAuth(["transactions:review"]);

  const actor = (request: Request): EntryActor => ({
    actorType: request.apiAuth?.actorType || "api_token",
    actorId: request.apiAuth?.tokenId,
    requestId: request.header("x-request-id") || undefined,
  });

  const handle =
    (work: (request: Request, response: Response) => Promise<unknown>) =>
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.setHeader("Cache-Control", "no-store");
        response.json(await work(request, response));
      } catch (error) {
        if (error instanceof ZodError)
          return response.status(400).json({ error: error.issues.map((issue) => issue.message).join("; ") });
        if (error instanceof EntryError)
          return response.status(error.status).json({ error: error.message, ...error.details });
        if (error instanceof LinkError) return response.status(error.status).json({ error: error.message });
        if (error instanceof Error && /not found$/i.test(error.message)) return response.status(404).json({ error: error.message });
        next(error);
      }
    };

  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

  router.get("/people", read, handle(async (request) =>
    listPeople(authenticatedUserId(request), flag(request.query.includeArchived)),
  ));
  router.post("/people", write, handle(async (request) =>
    createPerson(authenticatedUserId(request), PersonSchema.parse(request.body)),
  ));
  router.patch("/people/:person", write, handle(async (request) =>
    updatePerson(authenticatedUserId(request), request.params.person, PersonPatchSchema.parse(request.body)),
  ));
  router.delete("/people/:person", write, handle(async (request) =>
    deletePerson(authenticatedUserId(request), request.params.person),
  ));

  router.get("/outstanding", read, handle(async (request) => {
    const from = text(request.query.from);
    const to = text(request.query.to);
    if (from) day.parse(from);
    if (to) day.parse(to);
    const items = text(request.query.items);
    return outstanding(authenticatedUserId(request), {
      person: text(request.query.person),
      from,
      to,
      items: items === "all" || items === "none" ? items : "open",
      includeArchived: flag(request.query.includeArchived),
    });
  }));

  router.post("/set", write, handle(async (request) =>
    setReimbursable(authenticatedUserId(request), SetSchema.parse(request.body), actor(request)),
  ));
  router.post("/clear", write, handle(async (request) =>
    clearReimbursable(authenticatedUserId(request), z.object({ ids }).strict().parse(request.body).ids, actor(request)),
  ));

  router.get("/proposals", read, handle(async (request) => {
    const days = text(request.query.days);
    return listRepaymentProposals(authenticatedUserId(request), {
      person: text(request.query.person),
      transactionId: text(request.query.transactionId),
      days: days ? z.coerce.number().int().min(1).max(3650).parse(days) : undefined,
    });
  }));
  router.post("/proposals/confirm", write, handle(async (request) =>
    confirmRepayment(authenticatedUserId(request), ConfirmSchema.parse(request.body), actor(request)),
  ));

  router.get("/backfill", read, handle(async (request) => {
    const person = text(request.query.person);
    if (!person) throw new EntryError(400, "person is required");
    return backfillProposal(authenticatedUserId(request), person);
  }));
  router.post("/backfill/apply", write, handle(async (request) =>
    applyBackfill(authenticatedUserId(request), BackfillApplySchema.parse(request.body), actor(request)),
  ));

  return router;
}

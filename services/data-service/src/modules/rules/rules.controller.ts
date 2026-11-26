import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { authenticatedUserId, requireAccountAuth, requireApiTokenAnyOf } from "../auth/auth.middleware";
import { EntryError, type EntryActor } from "../transactions/assistant-entries.service";
import { CreateRuleSchema, ListRulesQuerySchema, Rules, UpdateRuleSchema } from "./rules.service";

/**
 * /api/agent/rules: the rules the assistant (twee) creates and manages.
 * Listing (with origin, reason, examples and hit stats) takes rules:read,
 * rules:write or transactions:review; creating, changing, disabling and
 * undoing take rules:write. Rules from the assistant are enabled without a
 * confirmation flag: what they need instead is a reason, and for
 * assistant_detected rules examples or a recurring bill (rules.service.ts).
 */
export function createRulesRouter() {
  const router = Router();
  const read = requireApiTokenAnyOf(["rules:read", "rules:write", "transactions:review"]);
  const write = requireAccountAuth(["rules:write"]);

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
        await work(request, response);
      } catch (error) {
        if (error instanceof ZodError)
          return response.status(400).json({ error: error.issues.map((issue) => issue.message).join("; ") });
        if (error instanceof EntryError)
          return response.status(error.status).json({ error: error.message, ...error.details });
        next(error);
      }
    };

  router.get("/", read, handle(async (request, response) => {
    response.json(await Rules.list(authenticatedUserId(request), ListRulesQuerySchema.parse(request.query)));
  }));
  router.get("/:id", read, handle(async (request, response) => {
    response.json({ rule: await Rules.get(authenticatedUserId(request), request.params.id) });
  }));
  router.post("/", write, handle(async (request, response) => {
    const input = CreateRuleSchema.parse(request.body);
    response.status(201).json({ rule: await Rules.create(authenticatedUserId(request), input, actor(request)) });
  }));
  router.patch("/:id", write, handle(async (request, response) => {
    const input = UpdateRuleSchema.parse(request.body);
    response.json({ rule: await Rules.update(authenticatedUserId(request), request.params.id, input, actor(request)) });
  }));
  router.post("/:id/disable", write, handle(async (request, response) => {
    response.json({ rule: await Rules.setEnabled(authenticatedUserId(request), request.params.id, false, actor(request)) });
  }));
  router.post("/:id/enable", write, handle(async (request, response) => {
    response.json({ rule: await Rules.setEnabled(authenticatedUserId(request), request.params.id, true, actor(request)) });
  }));
  router.post("/:id/undo", write, handle(async (request, response) => {
    response.json(await Rules.undo(authenticatedUserId(request), request.params.id, actor(request)));
  }));
  return router;
}

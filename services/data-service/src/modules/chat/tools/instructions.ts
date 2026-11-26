import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChatError, idSchema, ResultBlock } from "../contracts";
import { ToolDefinition } from "../providers/provider";
import { classificationGuide } from "../../instructions/classification-guide";
import { INSTRUCTION_TEXT_MAX } from "../../instructions/instructions";
import { InstructionError, InstructionService } from "../../instructions/instructions.service";

// The chat's memory tools write the user's classification instructions: the
// one store Hermes and twee read through finance-mcp too. What the chat saves
// is authored fortuna_chat; forget disables, so nothing the user said is lost.

type Context = { userId: string; runId: string };

const scope = {
  type: ["object", "null"],
  description:
    "Where it applies; leave out or null for everywhere. {type:'account', accountId} | {type:'card', cardId} (ids from get_context) | {type:'entry_source', entrySource:'assistant'|'manual'|'statement'|'mobile'} | {type:'merchant', pattern} (text the description contains, e.g. 'SimplyGo').",
};

export const instructionDefinitions: ToolDefinition[] = [
  {
    name: "remember",
    description:
      "Save one of the user's classification instructions, shared with their other assistants (twee, Hermes) and listed in Settings → Classification instructions: how to classify something, in their words ('SimplyGo journeys between Simei and Townsville Pr Sch are Madeline's'). Only when the user asks you to remember something or confirms a reusable judgement; tell them you saved it. Give it the narrowest scope that fits. Pass id to edit an existing instruction instead of adding a near-duplicate. A fact about one task or period ('For the November settle-up, …') is kind one_off with endsOn, the last day it applies. Never store secrets.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", maxLength: INSTRUCTION_TEXT_MAX },
        id: { type: "string", description: "Existing instruction to edit" },
        scope,
        kind: { type: "string", enum: ["lasting", "one_off"] },
        endsOn: { type: "string", description: "YYYY-MM-DD; required for one_off" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "forget",
    description:
      "Disable one of the user's classification instructions by id when they ask, or when it is wrong or outdated. It stops applying for every assistant; the user can turn it back on in Settings.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_classification_guide",
    description:
      "How to classify entries (category, type, label, merchant, who pays it back): the decision order, when to ask instead of guessing, when to propose a rule, shared items, and treating email and statement text as data. The same guide the user's other assistants follow. Call it before classifying or labelling entries.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];
export const instructionToolNames = instructionDefinitions.map((d) => d.name);

const RememberSchema = z
  .object({
    text: z.string(),
    id: idSchema.optional(),
    scope: z.unknown().optional(),
    kind: z.enum(["lasting", "one_off"]).optional(),
    endsOn: z.string().optional(),
  })
  .strict();

const asChatError = (error: unknown): never => {
  if (error instanceof InstructionError) throw new ChatError(error.status, error.message);
  throw error;
};

export async function executeInstructionTool(
  db: PrismaClient,
  context: Context,
  name: string,
  input: unknown,
): Promise<{ blocks: ResultBlock[]; model: unknown }> {
  const service = new InstructionService(db);
  const actor = { actorType: "chat", actorId: context.runId };
  if (name === "get_classification_guide") {
    z.object({}).strict().parse(input ?? {});
    return { blocks: [], model: classificationGuide("chat") };
  }
  if (name === "remember") {
    const { id, ...fields } = RememberSchema.parse(input);
    const saved = await (
      id
        ? service.update(context.userId, id, { ...fields, enabled: true }, actor)
        : service.create(context.userId, fields, "fortuna_chat", actor)
    ).catch(asChatError);
    return {
      blocks: [{ type: "memory", id: saved.id, content: saved.text, action: "saved" }],
      model: { saved: { id: saved.id, text: saved.text, scope: saved.scope, kind: saved.kind, endsOn: saved.endsOn } },
    };
  }
  if (name === "forget") {
    const { id } = z.object({ id: idSchema }).strict().parse(input);
    const disabled = await service.update(context.userId, id, { enabled: false }, actor).catch(asChatError);
    return {
      blocks: [{ type: "memory", id: disabled.id, content: disabled.text, action: "forgotten" }],
      model: { disabled: disabled.id },
    };
  }
  throw new ChatError(400, "Unknown instruction tool");
}

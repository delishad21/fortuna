"use server";

import { auth } from "@/lib/actionAuth";
import { dataServiceRequest } from "@/lib/dataService";
import type { ClassificationInstruction, InstructionInput } from "@/lib/instructionTypes";

/**
 * Classification instructions for the web and mobile apps' Settings, through
 * data-service's /api/agent/instructions: the same store and audit trail
 * Fortuna's chat, twee and Hermes use. What the apps save is the user's.
 */

async function userId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

const call = async <T>(path: string, method = "GET", body?: Record<string, unknown>) =>
  dataServiceRequest<T>(await userId(), `/api/agent/instructions${path}`, {
    method,
    ...(method === "GET" ? {} : { body }),
  });

export async function getInstructions(): Promise<ClassificationInstruction[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return (await call<{ instructions: ClassificationInstruction[] }>("?status=all")).instructions;
}

export async function createInstruction(input: InstructionInput): Promise<ClassificationInstruction> {
  return (await call<{ instruction: ClassificationInstruction }>("", "POST", { ...input })).instruction;
}

/** Edits an instruction; { enabled: false } disables it for every assistant. */
export async function updateInstruction(
  instructionId: string,
  input: Partial<InstructionInput>,
): Promise<ClassificationInstruction> {
  return (
    await call<{ instruction: ClassificationInstruction }>(`/${encodeURIComponent(instructionId)}`, "PATCH", { ...input })
  ).instruction;
}

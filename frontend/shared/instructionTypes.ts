// Classification instructions: the user's judgement about how to classify, in
// their words, shared by Fortuna's chat, twee and Hermes. Shared by web and
// mobile Settings.

export type InstructionScope =
  | { type: "account"; accountId: string; label: string }
  | { type: "card"; cardId: string; label: string }
  | { type: "entry_source"; entrySource: string; label: string }
  | { type: "merchant"; pattern: string; label: string };

export type InstructionKind = "lasting" | "one_off";
export type InstructionAuthor = "user" | "fortuna_chat" | "assistant";

export interface ClassificationInstruction {
  id: string;
  text: string;
  scope: InstructionScope | null;
  kind: InstructionKind;
  endsOn: string | null;
  author: InstructionAuthor;
  enabled: boolean;
  /** Served to the assistants now: enabled, and lasting or not past endsOn. */
  active: boolean;
  expired: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InstructionScopeInput =
  | { type: "account"; accountId: string }
  | { type: "card"; cardId: string }
  | { type: "entry_source"; entrySource: string }
  | { type: "merchant"; pattern: string };

export interface InstructionInput {
  text: string;
  scope: InstructionScopeInput | null;
  kind: InstructionKind;
  endsOn: string | null;
  enabled?: boolean;
}

export const INSTRUCTION_TEXT_MAX = 1000;

export const AUTHOR_LABELS: Record<InstructionAuthor, string> = {
  user: "You",
  fortuna_chat: "Fortuna chat",
  assistant: "Assistant",
};

export const SCOPE_TYPES = [
  { value: "all", label: "Every entry" },
  { value: "account", label: "An account" },
  { value: "card", label: "A card" },
  { value: "entry_source", label: "An entry source" },
  { value: "merchant", label: "A merchant" },
] as const;

export const ENTRY_SOURCE_OPTIONS = [
  { value: "assistant", label: "Assistant entries" },
  { value: "statement", label: "Statement rows" },
  { value: "manual", label: "Added by hand" },
  { value: "mobile", label: "Added on the phone" },
] as const;

export const scopeLabel = (instruction: Pick<ClassificationInstruction, "scope">) => {
  const scope = instruction.scope;
  if (!scope) return "Every entry";
  if (scope.type === "entry_source")
    return ENTRY_SOURCE_OPTIONS.find((o) => o.value === scope.entrySource)?.label ?? scope.label;
  if (scope.type === "merchant") return `Merchant contains “${scope.pattern}”`;
  return scope.label;
};

/** "Lasting", "One-off until 30 Nov 2026" or "Ended 13 Nov 2026". */
export const kindLabel = (instruction: Pick<ClassificationInstruction, "kind" | "endsOn" | "expired">) => {
  if (instruction.kind !== "one_off" || !instruction.endsOn) return "Lasting";
  const day = new Date(`${instruction.endsOn}T00:00:00Z`).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return instruction.expired ? `Ended ${day}` : `One-off until ${day}`;
};

/** The form's scope choice as the API takes it; null for every entry. */
export function scopeInput(value: { scopeType: string; target: string; entrySource: string; pattern: string }): InstructionScopeInput | null {
  if (value.scopeType === "account") {
    if (!value.target) throw new Error("Pick the account");
    return { type: "account", accountId: value.target };
  }
  if (value.scopeType === "card") {
    if (!value.target) throw new Error("Pick the card");
    return { type: "card", cardId: value.target };
  }
  if (value.scopeType === "entry_source") return { type: "entry_source", entrySource: value.entrySource || "assistant" };
  if (value.scopeType === "merchant") {
    if (value.pattern.trim().length < 2) throw new Error("Type at least 2 letters of the merchant's name");
    return { type: "merchant", pattern: value.pattern.trim() };
  }
  return null;
}

/** The form's starting values for an instruction (or a new one). */
export function scopeFormValues(instruction?: ClassificationInstruction | null) {
  const scope = instruction?.scope;
  return {
    scopeType: scope?.type ?? "all",
    target: scope?.type === "account" ? scope.accountId : scope?.type === "card" ? scope.cardId : "",
    entrySource: scope?.type === "entry_source" ? scope.entrySource : "assistant",
    pattern: scope?.type === "merchant" ? scope.pattern : "",
  };
}

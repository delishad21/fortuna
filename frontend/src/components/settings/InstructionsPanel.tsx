"use client";

import { useEffect, useState } from "react";
import { BookOpenText, Pencil, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { createInstruction, getInstructions, updateInstruction } from "@/app/actions/instructions";
import { cardDisplay, type Account } from "@/lib/accountTypes";
import {
  AUTHOR_LABELS,
  ENTRY_SOURCE_OPTIONS,
  INSTRUCTION_TEXT_MAX,
  SCOPE_TYPES,
  kindLabel,
  scopeFormValues,
  scopeInput,
  scopeLabel,
  type ClassificationInstruction,
  type InstructionKind,
} from "@/lib/instructionTypes";

const field =
  "w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white";

/** The add/edit form: text, where it applies, and lasting or one-off. */
function InstructionForm({
  instruction,
  accounts,
  onSaved,
  onCancel,
}: {
  instruction: ClassificationInstruction | null;
  accounts: Account[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(instruction?.text ?? "");
  const [scope, setScope] = useState(scopeFormValues(instruction));
  const [kind, setKind] = useState<InstructionKind>(instruction?.kind ?? "lasting");
  const [endsOn, setEndsOn] = useState(instruction?.endsOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = accounts.filter((account) => !account.archived);
  const cards = open.flatMap((account) =>
    account.cards.map((card) => ({ value: card.id, label: `${account.name} · ${cardDisplay(card)}` })),
  );

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (!text.trim()) throw new Error("Write the instruction");
      if (kind === "one_off" && !endsOn) throw new Error("Pick the last day it applies");
      const input = { text: text.trim(), scope: scopeInput(scope), kind, endsOn: kind === "one_off" ? endsOn : null };
      if (instruction) await updateInstruction(instruction.id, input);
      else await createInstruction(input);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-stroke p-4 dark:border-dark-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-dark dark:text-white">
        Instruction
        <textarea
          value={text}
          maxLength={INSTRUCTION_TEXT_MAX}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. SimplyGo journeys between Simei and Townsville Pr Sch are Madeline's"
          className={`${field} resize-y font-normal`}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Applies to"
          value={scope.scopeType}
          options={SCOPE_TYPES.map((s) => ({ value: s.value, label: s.label }))}
          onChange={(scopeType) => setScope({ ...scope, scopeType, target: "" })}
        />
        {scope.scopeType === "account" && (
          <Select
            label="Account"
            value={scope.target}
            placeholder="Pick an account"
            options={open.map((a) => ({ value: a.id, label: a.name, color: a.color }))}
            onChange={(target) => setScope({ ...scope, target })}
          />
        )}
        {scope.scopeType === "card" && (
          <Select
            label="Card"
            value={scope.target}
            placeholder="Pick a card"
            options={cards}
            onChange={(target) => setScope({ ...scope, target })}
          />
        )}
        {scope.scopeType === "entry_source" && (
          <Select
            label="Entries"
            value={scope.entrySource}
            options={ENTRY_SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(entrySource) => setScope({ ...scope, entrySource })}
          />
        )}
        {scope.scopeType === "merchant" && (
          <label className="flex flex-col gap-1 text-sm font-medium text-dark dark:text-white">
            Description contains
            <input
              value={scope.pattern}
              maxLength={120}
              onChange={(e) => setScope({ ...scope, pattern: e.target.value })}
              placeholder="e.g. SimplyGo"
              className={`${field} font-normal`}
            />
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Kind"
          value={kind}
          options={[
            { value: "lasting", label: "Lasting", description: "Until you change or disable it" },
            { value: "one_off", label: "One-off", description: "For one task or period, until an end date" },
          ]}
          onChange={(value) => setKind(value as InstructionKind)}
        />
        {kind === "one_off" && (
          <label className="flex flex-col gap-1 text-sm font-medium text-dark dark:text-white">
            Last day it applies
            <input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className={`${field} font-normal`}
            />
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" isLoading={busy} disabled={busy}>
          {instruction ? "Save changes" : "Add instruction"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Classification instructions: how the user wants things classified, in
 * their words. Fortuna's chat, twee and Hermes all follow the same list.
 */
export function InstructionsPanel({ accounts }: { accounts: Account[] }) {
  const [instructions, setInstructions] = useState<ClassificationInstruction[] | null>(null);
  const [editing, setEditing] = useState<ClassificationInstruction | "new" | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    getInstructions()
      .then(setInstructions)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  async function toggle(instruction: ClassificationInstruction) {
    setError("");
    try {
      await updateInstruction(instruction.id, { enabled: !instruction.enabled });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section id="instructions" aria-label="Classification instructions">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BookOpenText className="h-6 w-6 shrink-0 text-primary" />
              <div className="min-w-0">
                <CardTitle>Classification instructions</CardTitle>
                <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
                  How you want things classified, in your words. Fortuna&apos;s chat and your other assistants all
                  follow these, each only where it applies.
                </p>
              </div>
            </div>
            {editing === null && (
              <Button size="sm" variant="secondary" leftIcon={<Plus size={14} />} onClick={() => setEditing("new")}>
                Add
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing === "new" && (
            <InstructionForm
              instruction={null}
              accounts={accounts}
              onCancel={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await load();
              }}
            />
          )}
          {instructions === null && !error && (
            <p role="status" className="text-sm text-dark-5 dark:text-dark-6">
              Loading…
            </p>
          )}
          {instructions?.length === 0 && editing !== "new" && (
            <p className="text-sm text-dark-5 dark:text-dark-6">
              No instructions yet. Add one here, or tell Fortuna&apos;s chat what to remember.
            </p>
          )}
          <ul className="divide-y divide-stroke dark:divide-dark-3">
            {instructions?.map((instruction) =>
              editing !== "new" && editing?.id === instruction.id ? (
                <li key={instruction.id} className="py-3">
                  <InstructionForm
                    instruction={instruction}
                    accounts={accounts}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      await load();
                    }}
                  />
                </li>
              ) : (
                <li key={instruction.id} className="flex items-start gap-3 py-3">
                  <div className={`min-w-0 flex-1 ${instruction.active ? "" : "opacity-60"}`}>
                    <p className="whitespace-pre-wrap break-words text-sm text-dark dark:text-white">
                      {instruction.text}
                    </p>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      {[
                        scopeLabel(instruction),
                        kindLabel(instruction),
                        `By ${AUTHOR_LABELS[instruction.author] ?? instruction.author}`,
                        !instruction.enabled ? "Disabled" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Edit instruction: ${instruction.text}`}
                    className="rounded p-1.5 text-dark-5 hover:bg-gray-2 dark:hover:bg-dark-3"
                    onClick={() => setEditing(instruction)}
                  >
                    <Pencil size={15} />
                  </button>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-dark-5 dark:text-dark-6">
                    <input
                      type="checkbox"
                      checked={instruction.enabled}
                      onChange={() => void toggle(instruction)}
                      aria-label={`${instruction.enabled ? "Disable" : "Enable"} instruction: ${instruction.text}`}
                      className="h-4 w-4 accent-primary"
                    />
                    On
                  </label>
                </li>
              ),
            )}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-red">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { getReimbursementPeople } from "@/app/actions/reimbursables";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { formatCurrency } from "@/components/analytics/parts";
import {
  isShareError,
  owedFor,
  shareFields,
  shareFromFields,
  shareOf,
  type ReimbursableFlag,
  type ReimbursableShareInput,
  type ReimbursementPerson,
  type ShareMode,
} from "@/lib/reimbursables";

export { isShareError, shareFields, shareFromFields, shareOf, type ShareMode };

const fieldLabel = "text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";
const NEW_PERSON = "__new__";

export function ShareFields({
  mode,
  value,
  onMode,
  onValue,
}: {
  mode: ShareMode;
  value: string;
  onMode: (mode: ShareMode) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-32 shrink-0">
        <Select
          value={mode}
          options={[
            { value: "full", label: "In full" },
            { value: "half", label: "Half" },
            { value: "amount", label: "Amount" },
            { value: "percent", label: "Share %" },
          ]}
          onChange={(next) => onMode(next as ShareMode)}
          buttonClassName="w-full min-w-0"
        />
      </div>
      {mode === "amount" || mode === "percent" ? (
        <NumberInput
          value={value}
          min={0}
          step={mode === "amount" ? 0.01 : 1}
          placeholder={mode === "amount" ? "0.00" : "50"}
          onChange={(event) => onValue(event.target.value)}
          aria-label={mode === "amount" ? "Amount owed" : "Share in percent"}
        />
      ) : null}
    </div>
  );
}

/**
 * Who a transaction (or several) was paid for and what they owe: a person
 * from the people list or a new one, in full by default or a share, and a
 * note. Used in a transaction's details and for bulk marking.
 */
export function ReimbursableEditor({
  current,
  amountOut,
  count = 1,
  disabled,
  onSave,
  onClear,
  onCancel,
}: {
  current?: ReimbursableFlag | null;
  /** The item's amount, to show what the share comes to (one item only). */
  amountOut?: number;
  count?: number;
  disabled?: boolean;
  onSave: (input: { person: string; createPerson: boolean; share: ReimbursableShareInput; note: string | null }) => Promise<void>;
  onClear?: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [people, setPeople] = useState<ReimbursementPerson[]>([]);
  const [personId, setPersonId] = useState(current?.personId || "");
  const [newName, setNewName] = useState("");
  const initial = shareFields(current?.share);
  const [mode, setMode] = useState<ShareMode>(initial.mode);
  const [value, setValue] = useState(initial.value);
  const [note, setNote] = useState(current?.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReimbursementPeople()
      .then((result) => {
        const list = result.people.map((entry) => entry.person);
        setPeople(list);
        setPersonId((previous) => previous || list[0]?.id || NEW_PERSON);
      })
      .catch(() => setPersonId((previous) => previous || NEW_PERSON));
  }, []);

  const share = shareFromFields(mode, value);
  const preview = amountOut && !isShareError(share) ? owedFor(amountOut, shareOf(share)) : null;

  const save = async () => {
    setError(null);
    if (isShareError(share)) return setError(share.error);
    const creating = personId === NEW_PERSON;
    const person = creating ? newName.trim() : personId;
    if (!person) return setError("Choose who it was for, or add them");
    setSaving(true);
    try {
      await onSave({ person, createPerson: creating, share, note: note.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!onClear) return;
    setSaving(true);
    setError(null);
    try {
      await onClear();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unmark");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Paid for</span>
          <Select
            value={personId}
            options={[
              ...people.filter((person) => !person.archived || person.id === personId).map((person) => ({ value: person.id, label: person.name })),
              { value: NEW_PERSON, label: "Add someone…" },
            ]}
            onChange={setPersonId}
            buttonClassName="w-full min-w-0"
          />
          {personId === NEW_PERSON ? (
            <TextInput value={newName} placeholder="Name, e.g. Madeline" onChange={(event) => setNewName(event.target.value)} />
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>They owe</span>
          <ShareFields mode={mode} value={value} onMode={setMode} onValue={setValue} />
          {preview !== null ? (
            <span className="text-xs text-dark-5 dark:text-dark-6">{formatCurrency(preview)} owed</span>
          ) : count > 1 && mode === "amount" ? (
            <span className="text-xs text-dark-5 dark:text-dark-6">The same amount on each of the {count}</span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Note</span>
          <TextInput value={note} placeholder="Optional" onChange={(event) => setNote(event.target.value)} />
        </div>
      </div>
      {error ? <p className="text-sm text-red">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {current && onClear ? (
          <Button variant="secondary" size="sm" disabled={saving || disabled} onClick={() => void clear()}>
            Unmark
          </Button>
        ) : null}
        <Button size="sm" disabled={saving || disabled} onClick={() => void save()}>
          {saving ? "Saving…" : current ? "Save" : count > 1 ? `Mark ${count} reimbursable` : "Mark reimbursable"}
        </Button>
      </div>
    </div>
  );
}

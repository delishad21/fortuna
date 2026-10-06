"use client";

import { useState } from "react";
import type { TripParticipant } from "@/app/actions/tripSharing";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";

const ADD_PERSON = "__add_person__";

interface TripPeoplePickerProps {
  /** The chosen participant id; "" means "Me" when `meLabel` is set. */
  value: string;
  onChange: (participantId: string) => void;
  participants: TripParticipant[];
  /** Adds a person to the trip and returns them. Leave out to hide "+ Add person". */
  onAddPerson?: (name: string) => Promise<TripParticipant>;
  /** Shows a first option for yourself, with this label. */
  meLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  menuPlacement?: "down" | "up" | "auto";
}

/** Picks a person on the trip, with an inline "+ Add person". */
export function TripPeoplePicker({
  value,
  onChange,
  participants,
  onAddPerson,
  meLabel,
  placeholder = "Choose a person",
  disabled = false,
  menuPlacement = "down",
}: TripPeoplePickerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const options = [
    ...(meLabel !== undefined ? [{ value: "", label: meLabel }] : []),
    ...participants.map((person) => ({ value: person.id, label: person.name })),
    ...(onAddPerson ? [{ value: ADD_PERSON, label: "+ Add person" }] : []),
  ];

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed || !onAddPerson) return;
    setIsSaving(true);
    setError("");
    try {
      const person = await onAddPerson(trimmed);
      onChange(person.id);
      setIsAdding(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that person.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isAdding) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleAdd();
              }
            }}
            placeholder="Name"
            autoFocus
            className="flex-1"
          />
          <Button
            variant="primary"
            onClick={() => void handleAdd()}
            disabled={isSaving || !name.trim()}
          >
            {isSaving ? "Adding..." : "Add"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setIsAdding(false);
              setName("");
              setError("");
            }}
          >
            Cancel
          </Button>
        </div>
        {error && <p className="text-xs text-red">{error}</p>}
      </div>
    );
  }

  return (
    <Select
      value={value}
      onChange={(next) => {
        if (next === ADD_PERSON) {
          setIsAdding(true);
          return;
        }
        onChange(next);
      }}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full"
      buttonClassName="w-full"
      menuPlacement={menuPlacement}
    />
  );
}

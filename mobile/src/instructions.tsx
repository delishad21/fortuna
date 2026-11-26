import React, { useState } from "react";
import { RefreshControl, Switch, View } from "react-native";
import { useApi, useResource } from "./api";
import { Button, Card, Empty, Form, Group, Heading, ListItem, notice, Pill, Screen, Sheet, State, toast, Txt } from "./ui";
import { cardDisplay, type Account } from "../../frontend/shared/accountTypes";
import {
  AUTHOR_LABELS,
  ENTRY_SOURCE_OPTIONS,
  SCOPE_TYPES,
  kindLabel,
  scopeFormValues,
  scopeInput,
  scopeLabel,
  type ClassificationInstruction,
} from "../../frontend/shared/instructionTypes";

type Editing = { instruction?: ClassificationInstruction } | null;

function InstructionForm({ editing, accounts, onSaved }: { editing: NonNullable<Editing>; accounts: Account[]; onSaved: () => Promise<any> }) {
  const { call } = useApi();
  const instruction = editing.instruction;
  const initial = {
    text: instruction?.text ?? "",
    ...scopeFormValues(instruction),
    kind: instruction?.kind ?? "lasting",
    endsOn: instruction?.endsOn ?? "",
  };
  const [shown, setShown] = useState({ scopeType: initial.scopeType, kind: initial.kind });
  const open = accounts.filter((account) => !account.archived);
  const targets =
    shown.scopeType === "card"
      ? open.flatMap((account) => account.cards.map((card) => ({ label: `${account.name} · ${cardDisplay(card)}`, value: card.id, color: account.color })))
      : open.map((account) => ({ label: account.name, value: account.id, color: account.color }));
  return (
    <Form
      initial={initial}
      onChange={(value) => setShown({ scopeType: value.scopeType, kind: value.kind })}
      fields={[
        {
          key: "text",
          label: "Instruction",
          type: "multiline",
          required: true,
          placeholder: "e.g. SimplyGo journeys between Simei and Townsville Pr Sch are Madeline's",
        },
        { key: "scopeType", label: "Applies to", options: SCOPE_TYPES.map((s) => ({ label: s.label, value: s.value })) },
        {
          key: "target",
          label: shown.scopeType === "card" ? "Card" : "Account",
          options: targets,
          hidden: shown.scopeType !== "account" && shown.scopeType !== "card",
        },
        {
          key: "entrySource",
          label: "Entries",
          options: ENTRY_SOURCE_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
          hidden: shown.scopeType !== "entry_source",
        },
        { key: "pattern", label: "Description contains", placeholder: "e.g. SimplyGo", hidden: shown.scopeType !== "merchant" },
        {
          key: "kind",
          label: "Kind",
          options: [
            { label: "Lasting", value: "lasting", hint: "Until you change or disable it" },
            { label: "One-off", value: "one_off", hint: "For one task or period, until an end date" },
          ],
        },
        { key: "endsOn", label: "Last day it applies", type: "date", hidden: shown.kind !== "one_off" },
      ]}
      submit={instruction ? "Save changes" : "Add instruction"}
      onSave={async (v) => {
        const text = String(v.text || "").trim();
        if (!text) throw new Error("Write the instruction");
        if (v.kind === "one_off" && !v.endsOn) throw new Error("Pick the last day it applies");
        const input = {
          text,
          scope: scopeInput({ scopeType: v.scopeType, target: v.target || "", entrySource: v.entrySource, pattern: v.pattern || "" }),
          kind: v.kind,
          endsOn: v.kind === "one_off" ? v.endsOn : null,
        };
        if (instruction) await call("updateInstruction", instruction.id, input);
        else await call("createInstruction", input);
        toast("Instruction saved");
        await onSaved();
      }}
    />
  );
}

/** Classification instructions: how the user wants things classified, followed by Fortuna's chat and twee. */
export function InstructionsScreen() {
  const { call } = useApi();
  const instructions = useResource<ClassificationInstruction[]>("getInstructions");
  const accounts = useResource<Account[]>("getAccounts", { includeArchived: false });
  const [editing, setEditing] = useState<Editing>(null);
  const all = instructions.data || [];
  const toggle = async (instruction: ClassificationInstruction, enabled: boolean) => {
    try {
      await call("updateInstruction", instruction.id, { enabled });
      toast(enabled ? "Instruction on" : "Instruction off");
      await instructions.reload();
    } catch (e) {
      notice(e);
    }
  };
  return (
    <Screen refreshControl={<RefreshControl refreshing={instructions.loading && !!instructions.data} onRefresh={instructions.reload} />}>
      <Heading title="Instructions" right={<Button title="Add" compact icon="add" onPress={() => setEditing({})} />} />
      <Txt muted size={13} style={{ paddingHorizontal: 4 }}>
        How you want things classified, in your words. Fortuna's chat and your other assistants all follow these, each only where it applies.
      </Txt>
      <State {...instructions} />
      {instructions.data && !all.length && (
        <Card>
          <Empty icon="book-outline" title="No instructions yet" action="Add instruction" onAction={() => setEditing({})} />
        </Card>
      )}
      {!!all.length && (
        <Group>
          {all.map((instruction) => (
            <ListItem
              key={instruction.id}
              icon="book-outline"
              tone={instruction.active ? "purple" : "neutral"}
              title={
                <View style={{ gap: 4 }}>
                  <Txt numberOfLines={3}>{instruction.text}</Txt>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <Pill label={kindLabel(instruction)} />
                    {!instruction.enabled && <Pill label="Disabled" />}
                  </View>
                </View>
              }
              subtitle={[scopeLabel(instruction), `By ${AUTHOR_LABELS[instruction.author] ?? instruction.author}`].join(" · ")}
              onPress={() => setEditing({ instruction })}
              chevron={false}
              right={
                <Switch
                  accessibilityLabel={`Instruction on: ${instruction.text}`}
                  value={instruction.enabled}
                  onValueChange={(enabled) => void toggle(instruction, enabled)}
                />
              }
            />
          ))}
        </Group>
      )}
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.instruction ? "Edit instruction" : "New instruction"}>
        {!!editing && (
          <InstructionForm
            key={editing.instruction?.id ?? "new"}
            editing={editing}
            accounts={accounts.data || []}
            onSaved={async () => {
              setEditing(null);
              await instructions.reload();
            }}
          />
        )}
      </Sheet>
    </Screen>
  );
}

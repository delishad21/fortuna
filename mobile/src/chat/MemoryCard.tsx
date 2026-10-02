import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Input, Txt, useTheme, confirm } from "../ui";
import { useChatApi, ChatMemory } from "./api";

/** Notes the assistant reuses across conversations; every one can be read, edited and deleted. */
export function MemoryCard() {
  const api = useChatApi(),
    { colors } = useTheme();
  const [notes, setNotes] = useState<ChatMemory[]>([]),
    [draft, setDraft] = useState(""),
    [editing, setEditing] = useState<{ id: string; content: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = () =>
    api<ChatMemory[]>("/memories")
      .then((v) => setNotes(Array.isArray(v) ? v : []))
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    void load();
  }, [api]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Txt bold size={18} accessibilityRole="header">
        Saved notes
      </Txt>
      <Txt muted size={13}>
        Fortuna reuses these in every conversation. It only saves a note when
        you ask it to.
      </Txt>
      {!notes.length && <Txt muted>No saved notes yet.</Txt>}
      {notes.map((note) =>
        editing?.id === note.id ? (
          <View key={note.id} style={{ gap: 8 }}>
            <Input
              label="Edit note"
              value={editing.content}
              onChangeText={(v: string) =>
                setEditing({ id: note.id, content: v })
              }
              maxLength={500}
              multiline
            />
            <Button
              title="Save note"
              disabled={busy || !editing.content.trim()}
              onPress={() =>
                void run(async () => {
                  await api(`/memories/${note.id}`, {
                    method: "PUT",
                    body: { content: editing.content },
                  });
                  setEditing(null);
                })
              }
            />
          </View>
        ) : (
          <View
            key={note.id}
            style={{
              flexDirection: "row",
              gap: 8,
              alignItems: "flex-start",
              borderTopWidth: 1,
              borderColor: colors.line,
              paddingTop: 10,
            }}
          >
            <Txt style={{ flex: 1 }}>{note.content}</Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit note: ${note.content}`}
              onPress={() => setEditing({ id: note.id, content: note.content })}
              style={{ padding: 6 }}
            >
              <Ionicons name="create-outline" size={18} color={colors.muted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete note: ${note.content}`}
              disabled={busy}
              onPress={() =>
                confirm(
                  "Delete this note?",
                  "Fortuna will stop using it in conversations.",
                  () =>
                    run(() =>
                      api(`/memories/${note.id}`, { method: "DELETE" }),
                    ),
                )
              }
              style={{ padding: 6 }}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red} />
            </Pressable>
          </View>
        ),
      )}
      <Input
        label="New note"
        value={draft}
        onChangeText={setDraft}
        maxLength={500}
        placeholder="Add a note for Fortuna…"
      />
      <Button
        title="Add note"
        secondary
        disabled={busy || !draft.trim()}
        onPress={() =>
          void run(async () => {
            await api("/memories", {
              method: "POST",
              body: { content: draft },
            });
            setDraft("");
          })
        }
      />
      {!!message && <Txt accessibilityRole="alert">{message}</Txt>}
    </Card>
  );
}

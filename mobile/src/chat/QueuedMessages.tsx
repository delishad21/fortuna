import React, { useState } from "react";
import { View } from "react-native";
import { Button, Input, Txt, useTheme } from "../ui";
import {
  useChatApi,
  Conversation,
  QueuedMessage,
  queueItems,
  queuedFiles,
} from "./api";
/** Messages waiting for the current reply, in the order they will be sent. */
export function QueuedMessages({
  conversation,
  onChanged,
}: {
  conversation: Conversation;
  onChanged: () => Promise<void>;
}) {
  const api = useChatApi(),
    { colors } = useTheme();
  const [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(""),
    [files, setFiles] = useState<string[]>([]),
    [working, setWorking] = useState<string | null>(null),
    [error, setError] = useState<{ id: string; message: string } | null>(null);
  const items = queueItems(conversation);
  if (!items.length) return null;
  const path = (item: QueuedMessage) =>
    `/conversations/${conversation.id}/queue/${item.id}`;
  async function act(item: QueuedMessage, fn: () => Promise<unknown>) {
    setWorking(item.id);
    setError(null);
    try {
      await fn();
      setEditing(null);
      await onChanged();
    } catch (e) {
      setError({ id: item.id, message: (e as Error).message });
      await onChanged().catch(() => {});
    } finally {
      setWorking(null);
    }
  }
  const save = (item: QueuedMessage, text: string, attachmentIds: string[]) =>
    act(item, () =>
      api(path(item), { method: "PUT", body: { text, attachmentIds } }),
    );
  const remove = (item: QueuedMessage) =>
    act(item, () => api(path(item), { method: "DELETE" }));
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Queued messages">
      {items.map(({ item, marker, editable }) => {
        const failed = item.status === "failed";
        const open = editing === item.id;
        return (
          <View
            key={item.id}
            style={{
              gap: 10,
              padding: 14,
              borderRadius: 8,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: failed ? colors.red : colors.line,
              backgroundColor: colors.card,
            }}
          >
            <Txt
              bold
              size={12}
              style={{ color: failed ? colors.red : colors.muted }}
            >
              {marker}
            </Txt>
            {open ? (
              <>
                <Input
                  accessibilityLabel="Edit queued message"
                  multiline
                  maxLength={16000}
                  value={draft}
                  onChangeText={setDraft}
                  style={{ maxHeight: 130, minHeight: 55 }}
                />
                {queuedFiles(conversation, { ...item, attachmentIds: files }).map(
                  (f) => (
                    <View
                      key={f.id}
                      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                    >
                      <Txt numberOfLines={1} style={{ flex: 1 }}>
                        {f.filename}
                      </Txt>
                      <Button
                        title="Remove"
                        label={`Remove ${f.filename}`}
                        compact
                        secondary
                        onPress={() =>
                          setFiles((prev) => prev.filter((id) => id !== f.id))
                        }
                      />
                    </View>
                  ),
                )}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    title={failed ? "Save and retry" : "Save"}
                    compact
                    disabled={
                      working === item.id ||
                      (!draft.trim() && !files.length && !item.reviewId)
                    }
                    onPress={() => void save(item, draft, files)}
                  />
                  <Button
                    title="Cancel"
                    compact
                    secondary
                    onPress={() => setEditing(null)}
                  />
                </View>
              </>
            ) : (
              <>
                {!!item.text && <Txt>{item.text}</Txt>}
                {!!item.reviewTitle && (
                  <Txt size={13} style={{ color: colors.purple }}>
                    Review: {item.reviewTitle}
                  </Txt>
                )}
                {queuedFiles(conversation, item).map((f) => (
                  <Txt key={f.id} muted size={12}>
                    Attachment: {f.filename}
                  </Txt>
                ))}
              </>
            )}
            {failed && !!item.error && (
              <Txt accessibilityRole="alert" size={13} style={{ color: colors.red }}>
                {item.error}
              </Txt>
            )}
            {error?.id === item.id && (
              <Txt accessibilityRole="alert" size={13} style={{ color: colors.red }}>
                {error.message}
              </Txt>
            )}
            {!open && (
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {editable && failed && (
                  <Button
                    title="Retry"
                    compact
                    disabled={working === item.id}
                    onPress={() => void save(item, item.text, item.attachmentIds)}
                  />
                )}
                {editable && (
                  <Button
                    title="Edit"
                    compact
                    secondary
                    disabled={working === item.id}
                    onPress={() => {
                      setEditing(item.id);
                      setDraft(item.text);
                      setFiles(item.attachmentIds);
                      setError(null);
                    }}
                  />
                )}
                <Button
                  title="Remove"
                  compact
                  secondary
                  disabled={working === item.id}
                  onPress={() => void remove(item)}
                />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

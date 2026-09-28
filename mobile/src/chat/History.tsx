import React, { useEffect, useState } from "react";
import { Modal, View, Pressable, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Txt, Button, useTheme, confirm } from "../ui";
import { useChatApi, ConversationSummary } from "./api";
export function ChatHistory({
  visible,
  selected,
  onClose,
  onSelect,
  onSettings,
}: {
  visible: boolean;
  selected?: string;
  onClose: () => void;
  onSelect: (id?: string) => void;
  onSettings: () => void;
}) {
  const api = useChatApi(),
    { colors } = useTheme();
  const [list, setList] = useState<ConversationSummary[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (visible)
      void api<ConversationSummary[]>("/conversations")
        .then(setList)
        .catch((e) => setError(e.message));
  }, [visible, api]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.card, padding: 20, gap: 16 }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Txt bold size={22}>
            Conversations
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close chat history"
            onPress={onClose}
            style={{ padding: 12 }}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
        <FlatList
          data={list}
          keyExtractor={(v) => v.id}
          ListEmptyComponent={
            <Txt muted>Your conversations will appear here.</Txt>
          }
          renderItem={({ item }) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderRadius: 12,
                marginBottom: 6,
                backgroundColor: item.id === selected ? "#5750F1" : colors.card,
              }}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelect(item.id)}
                style={{ flex: 1, padding: 16 }}
              >
                <Txt
                  style={{
                    color: item.id === selected ? "white" : colors.text,
                  }}
                >
                  {item.title}
                </Txt>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${item.title}`}
                style={{ padding: 14 }}
                onPress={() =>
                  confirm(
                    "Delete conversation?",
                    "Your transactions and staged imports will remain.",
                    async () => {
                      try {
                        await api(`/conversations/${item.id}`, {
                          method: "DELETE",
                        });
                        setList((v) => v.filter((c) => c.id !== item.id));
                        if (selected === item.id) onSelect(undefined);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    },
                  )
                }
              >
                <Ionicons
                  name="trash-outline"
                  size={19}
                  color={item.id === selected ? "white" : colors.muted}
                />
              </Pressable>
            </View>
          )}
        />
        <Button title="AI connection" secondary onPress={onSettings} />
      </SafeAreaView>
    </Modal>
  );
}

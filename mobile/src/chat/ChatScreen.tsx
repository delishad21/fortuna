import React, { useCallback, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Button, Txt, useTheme } from "../ui";
import { ConversationSummary, useChatApi } from "./api";
export function ChatScreen({ navigation }: any) {
  const api = useChatApi(),
    { colors } = useTheme(),
    [list, setList] = useState<ConversationSummary[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void api<ConversationSummary[]>("/conversations")
        .then((v) => {
          if (alive) setList(v);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
      return () => {
        alive = false;
      };
    }, [api]),
  );
  return (
    <View style={{ flex: 1, padding: 20, gap: 16 }}>
      <View style={{ gap: 12 }}>
        <Txt bold size={28}>
          Chat
        </Txt>
        <Txt muted>
          Understand your spending, review statements, and prepare changes.
        </Txt>
        <Button
          title="New chat"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void api("/conversations", { method: "POST", body: {} })
              .then((v) =>
                navigation.navigate("ChatConversation", { id: v.id }),
              )
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        />
        <Button
          title="AI connection"
          secondary
          onPress={() => navigation.navigate("AIConnection")}
        />
      </View>
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
      <FlatList
        data={list}
        keyExtractor={(v) => v.id}
        ListEmptyComponent={
          <Txt muted>Your conversations will appear here.</Txt>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate("ChatConversation", { id: item.id })
            }
            style={{
              paddingVertical: 18,
              borderBottomWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Txt bold>{item.title}</Txt>
            <Txt muted size={12}>
              {new Date(item.updatedAt).toLocaleDateString()}
            </Txt>
          </Pressable>
        )}
      />
    </View>
  );
}

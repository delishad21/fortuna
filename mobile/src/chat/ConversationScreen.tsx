import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Image,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  View,
} from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { Button, Input, Txt, useTheme, confirm } from "../ui";
import {
  useChatApi,
  Conversation,
  Block,
  Stream,
  emptyStream,
  mergeEvents,
  generatingRun,
} from "./api";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ChatReviewCards } from "./ReviewCards";
import { ChatHistory } from "./History";
import { Details, Expandable } from "./Details";
export function ChatConversationScreen({ route, navigation }: any) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [id, setId] = useState<string | undefined>(route.params?.id);
  const api = useChatApi(),
    { colors } = useTheme(),
    insets = useSafeAreaInsets(),
    focused = useIsFocused();
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [text, setText] = useState(""),
    [files, setFiles] = useState<
      Array<{ attachmentId: string; filename: string }>
    >([]),
    [stream, setStream] = useState<Stream>(emptyStream),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const cursor = useRef(stream),
    inFlight = useRef(false),
    sendKey = useRef<string | null>(null),
    list = useRef<FlatList>(null);
  const selected = useRef(id);
  selected.current = id;
  cursor.current = stream;
  const refresh = useCallback(async () => {
    if (id) {
      const value = await api<Conversation>(`/conversations/${id}`);
      if (selected.current === id) setConversation(value);
    }
  }, [api, id]);
  useFocusEffect(
    useCallback(() => {
      void refresh().catch((e) => setError(e.message));
    }, [refresh]),
  );
  useEffect(() => {
    setConversation(null);
    setStream(emptyStream());
    setText("");
    setFiles([]);
    sendKey.current = null;
  }, [route.params?.id, api]);
  useEffect(() => {
    setId(route.params?.id);
  }, [route.params?.id]);
  const run = conversation?.runs[0];
  useEffect(() => {
    cursor.current = emptyStream();
    setStream(emptyStream());
  }, [run?.id]);
  useEffect(() => {
    if (!focused || !id) return;
    let dead = false,
      polling = false;
    const poll = async () => {
      if (
        (AppState.currentState !== "active" && Platform.OS !== "web") ||
        polling
      )
        return;
      polling = true;
      try {
        if (run && ["queued", "running"].includes(run.status)) {
          const result = await api(
            `/runs/${run.id}/events?after=${cursor.current.cursor}`,
          );
          if (dead) return;
          setStream((prev) => mergeEvents(prev, result.events));
          if (!["queued", "running"].includes(result.status)) await refresh();
        } else await refresh();
      } catch (e) {
        if (!dead) setError((e as Error).message);
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), 1500),
      subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void poll();
      });
    void poll();
    return () => {
      dead = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [api, run?.id, run?.status, refresh, focused]);
  async function action(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function send() {
    if (generatingRun(run) || (!text.trim() && !files.length)) return;
    await action(async () => {
      sendKey.current ||= `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const target =
        id || (await api("/conversations", { method: "POST", body: {} })).id;
      if (!id) setId(target);
      await api(`/conversations/${target}/messages`, {
        method: "POST",
        body: {
          text,
          attachmentIds: files.map((f) => f.attachmentId),
          idempotencyKey: sendKey.current,
        },
      });

      setText("");
      setFiles([]);
      sendKey.current = null;
      setStream(emptyStream());
      await refresh();
    });
  }
  async function attach() {
    await action(async () => {
      const target =
        id || (await api("/conversations", { method: "POST", body: {} })).id;
      if (!id) setId(target);
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/csv", "text/plain"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if ((asset.size || 0) > 25 * 1024 * 1024)
        throw new Error("Choose a statement smaller than 25 MB.");
      const form = new FormData();
      form.append("conversationId", target);
      if (Platform.OS === "web") {
        const blob = await fetch(asset.uri).then((r) => r.blob());
        form.append("file", blob, asset.name);
      } else
        form.append("file", {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || "application/octet-stream",
        } as any);
      const result = await api("/files", { method: "POST", body: form });
      setFiles((prev) => [
        ...prev.filter((f) => f.attachmentId !== result.attachmentId),
        result,
      ]);
    });
  }
  function renderBlock(block: Block, index: number) {
    if (block.type === "review")
      return (
        <ChatReviewCards key={block.id} id={block.id} onSubmitted={refresh} />
      );
    if (block.type === "text")
      return (
        <Txt key={index} selectable>
          {block.text}
        </Txt>
      );
    if (block.type === "attachment")
      return (
        <Txt key={index} muted size={12}>
          Statement: {block.filename}
        </Txt>
      );
    if (block.type === "data")
      return (
        <Expandable key={index} title={block.title}>
          <Details value={block.data} />
        </Expandable>
      );
    return (
      <Button
        key={index}
        title={block.label}
        secondary
        onPress={() =>
          navigation.navigate(
            block.kind === "proposal"
              ? "ChatApproval"
              : block.kind === "draft"
                ? "Draft"
                : "ChatTransaction",
            block.kind === "proposal"
              ? { conversationId: id, id: block.id }
              : { id: block.id },
          )
        }
      />
    );
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={95}
    >
      <View
        style={{
          paddingHorizontal: 20,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Toggle chat history"
          onPress={() => setHistoryOpen(true)}
          style={{ padding: 10 }}
        >
          <Ionicons name="menu-outline" size={24} color={colors.text} />
        </Pressable>
        <Txt bold style={{ flex: 1 }} numberOfLines={1}>
          {conversation?.title || "Fortuna"}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={() => {
            if (text || files.length)
              confirm("New chat?", "Discard your unsent message?", async () => {
                setId(undefined);
                setText("");
                setFiles([]);
                setConversation(null);
              });
            else {
              setId(undefined);
              setConversation(null);
            }
          }}
          style={{ padding: 10 }}
        >
          <Ionicons name="add-outline" size={24} color={colors.text} />
        </Pressable>
        <ChatHistory
          visible={historyOpen}
          selected={id}
          onClose={() => setHistoryOpen(false)}
          onSelect={(value) => {
            setHistoryOpen(false);
            setId(value);
            setConversation(null);
            setText("");
            setFiles([]);
          }}
          onSettings={() => {
            setHistoryOpen(false);
            navigation.navigate("AIConnection");
          }}
        />
      </View>
      <FlatList
        ref={list}
        data={conversation?.messages || []}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 24, flexGrow: 1 }}
        renderItem={({ item }) => (
          <View
            style={{
              gap: 12,
              padding: item.role === "user" ? 14 : 0,
              backgroundColor: item.role === "user" ? colors.tint : undefined,
              borderRadius: 16,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              {item.role === "user" ? (
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: colors.bg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="person-outline"
                    size={18}
                    color={colors.text}
                  />
                </View>
              ) : (
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    overflow: "hidden",
                    backgroundColor: "#080808",
                  }}
                >
                  <Image
                    source={require("../../assets/icon.png")}
                    style={{
                      width: 54,
                      height: 54,
                      position: "absolute",
                      left: -11,
                      top: -11,
                    }}
                  />
                </View>
              )}
              <Txt bold size={13}>
                {item.role === "user" ? "You" : "Fortuna"}
              </Txt>
            </View>
            {item.blocks.map(renderBlock)}
          </View>
        )}
        ListEmptyComponent={
          <Txt muted>
            Ask about your spending, or attach a statement to begin.
          </Txt>
        }
        ListFooterComponent={
          <View style={{ gap: 12 }}>
            {run && ["queued", "running"].includes(run.status) && (
              <>
                <Txt muted accessibilityLiveRegion="polite">
                  {stream.activity}…
                </Txt>
                <Txt selectable>{stream.text}</Txt>
                {stream.blocks
                  .filter((b) => b.type === "link")
                  .map(renderBlock)}
              </>
            )}
            {run?.status === "awaiting_confirmation" && (
              <Txt>
                Review the pending changes, or send a new message to move on.
              </Txt>
            )}
            {run?.status === "failed" && (
              <Txt>
                {run.error || "The assistant could not finish. Try again."}
              </Txt>
            )}
          </View>
        }
      />
      <View
        style={{
          padding: 16,
          paddingBottom: Math.max(16, insets.bottom),
          gap: 10,
          borderTopWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
        }}
      >
        {!!error && (
          <Txt accessibilityRole="alert" style={{ color: colors.red }}>
            {error}
          </Txt>
        )}
        <Txt muted size={12}>
          Statements expire after 7 days unless you approve retaining them as
          parser fixtures.
        </Txt>
        {files.map((file) => (
          <View key={file.attachmentId} style={{ gap: 4 }}>
            <Txt numberOfLines={1}>{file.filename}</Txt>
            <Button
              title="Remove attachment"
              secondary
              onPress={() => {
                setFiles((prev) =>
                  prev.filter((f) => f.attachmentId !== file.attachmentId),
                );
                sendKey.current = null;
              }}
            />
          </View>
        ))}
        <Input
          accessibilityLabel="Message"
          editable={!busy}
          multiline
          maxLength={16000}
          value={text}
          onChangeText={(v: string) => {
            setText(v);
            sendKey.current = null;
          }}
          placeholder="Ask Fortuna…"
          style={{ maxHeight: 130, minHeight: 55 }}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Attach statement"
              secondary
              disabled={busy || files.length >= 5 || generatingRun(run)}
              onPress={() => void attach()}
            />
          </View>
          <View style={{ flex: 1 }}>
            {generatingRun(run) ? (
              <Button
                title="Stop"
                secondary
                disabled={busy}
                onPress={() =>
                  void action(async () => {
                    await api(`/runs/${run!.id}/cancel`, {
                      method: "POST",
                      body: {},
                    });
                    await refresh();
                  })
                }
              />
            ) : (
              <Button
                title="Send message"
                disabled={busy || (!text.trim() && !files.length)}
                onPress={() => void send()}
              />
            )}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

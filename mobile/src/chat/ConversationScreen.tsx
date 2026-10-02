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
import * as ImagePicker from "expo-image-picker";
import { Button, Input, Txt, useTheme, confirm } from "../ui";
import {
  useChatApi,
  Conversation,
  Block,
  Stream,
  emptyStream,
  mergeEvents,
  generatingRun,
  PendingAttachment,
  IMAGE_UPLOAD_TYPES,
  IMAGE_UPLOAD_BYTES,
  stepLabel,
} from "./api";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ChatReviewCards } from "./ReviewCards";
import { ChatHistory } from "./History";
import { Details, Expandable } from "./Details";
import { ChatComponent } from "./Components";
import { ActionCard } from "./ActionCard";
import { AttachedImage } from "./AttachedImage";
export function ChatConversationScreen({ route, navigation }: any) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [id, setId] = useState<string | undefined>(route.params?.id);
  const api = useChatApi(),
    { colors } = useTheme(),
    insets = useSafeAreaInsets(),
    focused = useIsFocused();
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [text, setText] = useState(""),
    [files, setFiles] = useState<PendingAttachment[]>([]),
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
  // Proposals no reply links to (e.g. from a run that stopped early) stay reachable.
  const linked = new Set(
    [
      ...(conversation?.messages.flatMap((m) => m.blocks) || []),
      ...stream.blocks,
    ]
      .filter((b) => b.type === "link" && b.kind === "proposal")
      .map((b) => (b as { id: string }).id),
  );
  const unlinked = (conversation?.runs || [])
    .flatMap((r) => r.proposals)
    .filter((p) => p.status === "pending" && !linked.has(p.id));
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
  type PickedAsset = {
    uri: string;
    name: string;
    mimeType?: string | null;
    size?: number | null;
  };
  async function uploadAssets(pick: () => Promise<PickedAsset[] | null>) {
    await action(async () => {
      const assets = await pick();
      if (!assets?.length) return;
      if (assets.length > 5 - files.length)
        throw new Error(`You can attach ${5 - files.length} more files.`);
      for (const asset of assets) {
        const image = asset.mimeType?.startsWith("image/");
        if (image && !IMAGE_UPLOAD_TYPES.includes(asset.mimeType!))
          throw new Error(
            `${asset.name}: use a PNG, JPEG, WebP or GIF image. HEIC photos aren't supported yet.`,
          );
        if ((asset.size || 0) > (image ? IMAGE_UPLOAD_BYTES : 25 * 1024 * 1024))
          throw new Error(
            `${asset.name}: choose ${image ? "an image smaller than 10" : "a statement smaller than 25"} MB.`,
          );
      }
      const target =
        id || (await api("/conversations", { method: "POST", body: {} })).id;
      if (!id) setId(target);
      for (const asset of assets) {
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
          {
            ...result,
            preview: result.kind === "image" ? asset.uri : undefined,
          },
        ]);
        sendKey.current = null;
      }
    });
  }
  const attachFile = () =>
    uploadAssets(async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "text/csv",
          "text/plain",
          ...IMAGE_UPLOAD_TYPES,
        ],
        copyToCacheDirectory: true,
        multiple: true,
      });
      return picked.canceled ? null : picked.assets;
    });
  const attachPhotos = () =>
    uploadAssets(async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(5 - files.length, 1),
        quality: 1,
      });
      if (picked.canceled) return null;
      return picked.assets.map((a, i) => ({
        uri: a.uri,
        name:
          a.fileName || `photo-${i + 1}.${a.mimeType?.split("/")[1] || "jpg"}`,
        mimeType: a.mimeType,
        size: a.fileSize,
      }));
    });
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
      return block.mediaType === "image" ? (
        <AttachedImage key={index} id={block.id} filename={block.filename} />
      ) : (
        <Txt key={index} muted size={12}>
          Statement: {block.filename}
        </Txt>
      );
    if (block.type === "activity")
      return (
        <Txt key={index} muted size={12}>
          {block.steps.length} {block.steps.length === 1 ? "step" : "steps"}:{" "}
          {block.steps.map((s) => stepLabel(s.name)).join(" · ")}
        </Txt>
      );
    if (block.type === "memory")
      return (
        <View
          key={index}
          style={{
            flexDirection: "row",
            gap: 6,
            alignItems: "center",
            backgroundColor: colors.tint,
            borderRadius: 8,
            padding: 10,
          }}
        >
          <Ionicons name="bookmark-outline" size={14} color={colors.purple} />
          <Txt size={13} style={{ flex: 1 }}>
            {block.action === "saved" ? "Remembered" : "Forgot"}:{" "}
            {block.content}
          </Txt>
        </View>
      );
    if (block.type === "component")
      return (
        <ChatComponent
          key={index}
          block={block}
          onOpenTransaction={(transactionId) =>
            navigation.navigate("ChatTransaction", { id: transactionId })
          }
        />
      );
    if (block.type === "data")
      return block.title === "Submitted transaction review" ? (
        <Txt key={index} muted size={12}>
          Submitted review: {block.data?.title || "Transactions"}
          {Array.isArray(block.data?.rows)
            ? ` · ${block.data.rows.length} rows`
            : ""}
        </Txt>
      ) : null;
    return (
      <ActionCard
        key={index}
        label={block.label}
        kind={block.kind}
        proposal={
          block.kind === "proposal"
            ? conversation?.runs
                .flatMap((r) => r.proposals)
                .find((p) => p.id === block.id)
            : undefined
        }
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
                  Fortuna is working ·{" "}
                  {(() => {
                    const current = [...stream.steps]
                      .reverse()
                      .find((s) => !s.done);
                    return current
                      ? stepLabel(current.name)
                      : stream.text
                        ? "Writing a reply"
                        : "Thinking";
                  })()}
                  …
                </Txt>
                <Txt selectable>{stream.text}</Txt>
                {stream.blocks
                  .filter(
                    (b) =>
                      b.type === "link" ||
                      b.type === "component" ||
                      b.type === "memory",
                  )
                  .map(renderBlock)}
              </>
            )}
            {run?.status === "awaiting_confirmation" && (
              <Txt>
                Review the pending changes, or send a new message to move on.
              </Txt>
            )}
            {unlinked.length > 0 && (
              <View
                style={{
                  gap: 8,
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: colors.tint,
                }}
              >
                <Txt bold>Waiting for your approval</Txt>
                {unlinked.map((p) => (
                  <ActionCard
                    key={p.id}
                    kind={p.kind}
                    proposal={p}
                    label={`Review: ${p.preview?.title || "proposed change"}`}
                    onPress={() =>
                      navigation.navigate("ChatApproval", {
                        conversationId: id,
                        id: p.id,
                      })
                    }
                  />
                ))}
              </View>
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
          Attach statements, or screenshots for Fortuna to read. Attachments
          expire after 7 days.
        </Txt>
        {files.some((f) => f.preview) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {files
              .filter((f) => f.preview)
              .map((file) => (
                <View key={file.attachmentId}>
                  <Image
                    accessibilityLabel={file.filename}
                    source={{ uri: file.preview }}
                    style={{ width: 64, height: 64, borderRadius: 10 }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${file.filename}`}
                    onPress={() => {
                      setFiles((prev) =>
                        prev.filter(
                          (f) => f.attachmentId !== file.attachmentId,
                        ),
                      );
                      sendKey.current = null;
                    }}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      backgroundColor: colors.card,
                      borderRadius: 12,
                    }}
                  >
                    <Ionicons
                      name="close-circle"
                      size={22}
                      color={colors.text}
                    />
                  </Pressable>
                </View>
              ))}
          </View>
        )}
        {files
          .filter((f) => !f.preview)
          .map((file) => (
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
              title="Photos"
              secondary
              disabled={busy || files.length >= 5 || generatingRun(run)}
              onPress={() => void attachPhotos()}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Files"
              secondary
              disabled={busy || files.length >= 5 || generatingRun(run)}
              onPress={() => void attachFile()}
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

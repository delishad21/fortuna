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
import { Button, IconButton, Input, Txt, useTheme, confirm } from "../ui";
import {
  useChatApi,
  Conversation,
  Block,
  Stream,
  emptyStream,
  applyRunEvents,
  QUEUED_TEXT,
  workingOn,
  generatingRun,
  PendingAttachment,
  IMAGE_UPLOAD_TYPES,
  IMAGE_UPLOAD_BYTES,
  stepLabel,
  proposalState,
  waitingForUser,
  waitingText,
} from "./api";
import { appendFile } from "../upload";
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
    list = useRef<FlatList>(null),
    /** Where each approval card or review sits inside its message, by block id. */
    blockOffsets = useRef<Record<string, number>>({});
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
    .filter((p) => proposalState(p).pending && !linked.has(p.id));
  const waiting = waitingForUser(conversation);
  const waitingLabel = waitingText(
    waiting.proposals.length,
    waiting.reviews.length,
  );
  function reject(proposalId: string) {
    void action(async () => {
      await api(`/proposals/${proposalId}/reject`, {
        method: "POST",
        body: {},
      });
      await refresh();
    });
  }
  /** Scroll to the first approval card or review still waiting for the user. */
  function showWaiting() {
    const ids = new Set([
      ...waiting.proposals.map((p) => p.id),
      ...waiting.reviews.map((r) => r.id),
    ]);
    const messages = conversation?.messages || [];
    for (let index = 0; index < messages.length; index++) {
      const block = messages[index].blocks.find(
        (b) =>
          (b.type === "review" ||
            (b.type === "link" && b.kind === "proposal")) &&
          ids.has((b as { id: string }).id),
      ) as { id: string } | undefined;
      if (!block) continue;
      list.current?.scrollToIndex({
        index,
        viewPosition: 0,
        viewOffset: 12 - (blockOffsets.current[block.id] || 0),
      });
      return;
    }
    list.current?.scrollToEnd();
  }
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
          setStream((prev) => applyRunEvents(prev, result));
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
        await appendFile(form, "file", {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType,
        });
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
        <View
          key={block.id}
          onLayout={(e) => {
            blockOffsets.current[block.id] = e.nativeEvent.layout.y;
          }}
        >
          <ChatReviewCards id={block.id} onSubmitted={refresh} />
        </View>
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
      <View
        key={index}
        onLayout={(e) => {
          if (block.kind === "proposal")
            blockOffsets.current[block.id] = e.nativeEvent.layout.y;
        }}
      >
      <ActionCard
        label={block.label}
        kind={block.kind}
        busy={busy}
        onReject={
          block.kind === "proposal" ? () => reject(block.id) : undefined
        }
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
              : block.kind === "draft"
                ? { id: block.id, fromChat: true }
                : { id: block.id },
          )
        }
      />
      </View>
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
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // Rows not measured yet: jump near the row, then aim again once it renders.
          list.current?.scrollToOffset({ offset: index * averageItemLength });
          setTimeout(() => showWaiting(), 250);
        }}
        contentContainerStyle={{ padding: 20, gap: 24, flexGrow: 1 }}
        renderItem={({ item }) => (
          <View
            style={{
              gap: 12,
              padding: item.role === "user" ? 14 : 0,
              backgroundColor: item.role === "user" ? colors.tint : undefined,
              borderRadius: 8,
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
                    borderRadius: 8,
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
                    borderRadius: 8,
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
                  {stream.queued
                    ? QUEUED_TEXT
                    : `Fortuna is working · ${workingOn(stream)}…`}
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
            {unlinked.length > 0 && (
              <View style={{ gap: 8 }}>
                <Txt bold>Waiting for your approval</Txt>
                {unlinked.map((p) => (
                  <ActionCard
                    key={p.id}
                    kind={p.kind}
                    proposal={p}
                    label={`Review: ${p.preview?.title || "proposed change"}`}
                    busy={busy}
                    onReject={() => reject(p.id)}
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
      {!!waitingLabel && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderTopWidth: 1,
            borderColor: colors.purple,
            backgroundColor: colors.tint,
          }}
        >
          <Ionicons name="alert-circle-outline" size={16} color={colors.purple} />
          <Txt
            size={13}
            numberOfLines={2}
            accessibilityLiveRegion="polite"
            style={{ flex: 1, color: colors.purple }}
          >
            {waitingLabel}
          </Txt>
          <Button
            title="Review"
            label="Review waiting items"
            compact
            onPress={showWaiting}
          />
        </View>
      )}
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
          <IconButton
            icon="image-outline"
            label="Photos"
            tone="purple"
            size={50}
            disabled={busy || files.length >= 5 || generatingRun(run)}
            onPress={() => void attachPhotos()}
          />
          <IconButton
            icon="attach-outline"
            label="Files"
            tone="purple"
            size={50}
            disabled={busy || files.length >= 5 || generatingRun(run)}
            onPress={() => void attachFile()}
          />
          <View style={{ flex: 1 }}>
            {generatingRun(run) ? (
              <Button
                title="Stop"
                icon="stop-circle-outline"
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
                icon="send"
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

import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, IconButton, Txt, useTheme, confirm } from "../ui";
import {
  approvalsBarDismissed,
  approvalsDismissedKey,
  CANCEL_REVIEW_CONFIRM,
  Proposal,
  proposalSummary,
  RunReview,
  waitingForUser,
  waitingIds,
  waitingText,
} from "./api";

/**
 * The bar above the composer while proposals or reviews wait. Review scrolls to the first
 * one; the list closes each on the spot; ✕ hides the bar until something new is waiting.
 * Render it only once the conversation has loaded: an empty `waiting` forgets the ✕.
 */
export function ApprovalsBar({
  conversationId,
  waiting,
  busy,
  onReview,
  onReject,
  onCancelReview,
}: {
  conversationId: string;
  waiting: ReturnType<typeof waitingForUser>;
  busy: boolean;
  onReview: () => void;
  onReject: (proposal: Proposal) => void;
  onCancelReview: (review: RunReview) => Promise<void>;
}) {
  const { colors } = useTheme();
  const [dismissed, setDismissed] = useState<{
    conversationId: string;
    ids: string[] | null;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const ids = waitingIds(waiting);
  const line = waitingText(waiting.proposals.length, waiting.reviews.length);
  useEffect(() => {
    let dead = false;
    setOpen(false);
    void AsyncStorage.getItem(approvalsDismissedKey(conversationId))
      .then((value) => {
        const stored = value ? JSON.parse(value) : null;
        return Array.isArray(stored) ? (stored as string[]) : null;
      })
      .catch(() => null)
      .then((stored) => {
        if (!dead) setDismissed({ conversationId, ids: stored });
      });
    return () => {
      dead = true;
    };
  }, [conversationId]);
  const loaded = dismissed?.conversationId === conversationId;
  useEffect(() => {
    // Nothing waits any more: forget the dismissal, so the next item shows the bar.
    if (loaded && !ids.length && dismissed?.ids) {
      void AsyncStorage.removeItem(approvalsDismissedKey(conversationId));
      setDismissed({ conversationId, ids: null });
    }
  }, [loaded, ids.length, dismissed?.ids, conversationId]);
  if (!line || !loaded || approvalsBarDismissed(dismissed?.ids, ids))
    return null;
  const hide = () => {
    void AsyncStorage.setItem(
      approvalsDismissedKey(conversationId),
      JSON.stringify(ids),
    );
    setDismissed({ conversationId, ids });
    setOpen(false);
  };
  const row = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  };
  return (
    <View
      accessibilityLabel="Pending approvals"
      style={{
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
        borderTopWidth: 1,
        borderColor: colors.purple,
        backgroundColor: colors.tint,
      }}
    >
      <View style={row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${line}. ${open ? "Hide" : "Show"} the list`}
          onPress={() => setOpen((v) => !v)}
          style={[row, { flex: 1 }]}
        >
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={colors.purple}
          />
          <Txt
            size={13}
            numberOfLines={2}
            accessibilityLiveRegion="polite"
            style={{ flexShrink: 1, color: colors.purple }}
          >
            {line}
          </Txt>
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.purple}
          />
        </Pressable>
        <Button
          title="Review"
          label="Review waiting items"
          compact
          onPress={onReview}
        />
        <IconButton
          icon="close"
          label="Hide until something new needs your approval"
          size={32}
          filled={false}
          onPress={hide}
        />
      </View>
      {open && (
        <View style={{ gap: 6 }}>
          {waiting.proposals.map((p) => (
            <View key={p.id} style={row}>
              <Txt size={13} numberOfLines={1} style={{ flex: 1 }}>
                <Txt size={13} muted>
                  Change ·{" "}
                </Txt>
                {proposalSummary(p).title}
              </Txt>
              <Button
                title="Reject"
                secondary
                compact
                disabled={busy}
                onPress={() => onReject(p)}
              />
            </View>
          ))}
          {waiting.reviews.map((r) => (
            <View key={r.id} style={row}>
              <Txt size={13} numberOfLines={1} style={{ flex: 1 }}>
                <Txt size={13} muted>
                  Review ·{" "}
                </Txt>
                {r.title}
              </Txt>
              <Button
                title="Cancel"
                label={`Cancel review: ${r.title}`}
                secondary
                compact
                disabled={busy}
                onPress={() =>
                  confirm(
                    "Cancel review?",
                    CANCEL_REVIEW_CONFIRM,
                    () => onCancelReview(r),
                    "Cancel review",
                  )
                }
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

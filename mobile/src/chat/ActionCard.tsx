import React from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Txt, useTheme } from "../ui";
import { Proposal, proposalState, proposalSummary, timeLeft } from "./api";

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  edit_transactions: "list-outline",
  create_account: "business-outline",
  create_category: "pricetag-outline",
  update_import_rule: "color-wand-outline",
  retain_fixture: "archive-outline",
  commit_drafts: "cloud-upload-outline",
  restage_draft: "refresh-outline",
  discard_draft: "trash-outline",
  draft: "document-text-outline",
  transaction: "receipt-outline",
};

/** A small solid badge that stays readable on the tinted pending background. */
export function NeedsBadge({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: colors.purple,
      }}
    >
      <Txt bold size={11} style={{ color: colors.card }}>
        {label}
      </Txt>
    </View>
  );
}

/** A compact, tappable card for a proposal or a link to a staged import or transaction. */
export function ActionCard({
  label,
  proposal,
  kind,
  onPress,
  onReject,
  busy = false,
}: {
  label: string;
  proposal?: Proposal;
  kind: string;
  onPress?: () => void;
  /** Rejects a pending proposal from the card. */
  onReject?: () => void;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const summary = proposal ? proposalSummary(proposal) : null;
  const state = proposal ? proposalState(proposal) : null;
  const pending = !!state?.pending;
  const left = pending ? timeLeft(proposal!.expiresAt) : "";
  const title = summary?.title || label;
  const detail =
    summary?.detail ||
    (kind === "draft"
      ? "Staged import · review before it is saved"
      : kind === "transaction"
        ? "Saved transaction"
        : "No longer available");
  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: pending ? 2 : 1,
        borderColor: pending ? colors.purple : colors.line,
        backgroundColor: pending ? colors.tint : colors.card,
        opacity: onPress || pending ? 1 : 0.6,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          summary
            ? `${label}: ${summary.title}, ${summary.detail}. ${summary.state}${left ? `, ${left}` : ""}`
            : label
        }
        disabled={!onPress}
        onPress={onPress}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 12,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: pending ? colors.card : colors.tint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={ICONS[proposal?.kind || kind] || "code-slash-outline"}
            size={18}
            color={colors.purple}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          {pending && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 2,
              }}
            >
              <NeedsBadge label={state!.label} />
              {!!left && (
                <Txt muted size={12}>
                  {left}
                </Txt>
              )}
            </View>
          )}
          <Txt bold size={14} numberOfLines={1}>
            {title}
          </Txt>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {!!summary?.color && (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: summary.color,
                }}
              />
            )}
            <Txt muted size={12} numberOfLines={1} style={{ flex: 1 }}>
              {detail}
            </Txt>
          </View>
          {state && !pending && (
            <Txt muted size={12} numberOfLines={2}>
              {state.label}
            </Txt>
          )}
        </View>
        {!!onPress && (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={pending ? colors.purple : colors.muted}
          />
        )}
      </Pressable>
      {pending && (onPress || onReject) && (
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            paddingHorizontal: 12,
            paddingBottom: 12,
          }}
        >
          {onReject && (
            <Button
              title="Reject"
              label={`Reject: ${title}`}
              secondary
              compact
              disabled={busy}
              style={{ flex: 1 }}
              onPress={onReject}
            />
          )}
          {onPress && (
            <Button
              title="Review and approve"
              label={`Review and approve: ${title}`}
              compact
              disabled={busy}
              style={{ flex: 2 }}
              onPress={onPress}
            />
          )}
        </View>
      )}
    </View>
  );
}

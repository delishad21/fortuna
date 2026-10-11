import React from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Txt, useTheme } from "../ui";
import { Proposal, proposalSummary } from "./api";

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  edit_transactions: "list-outline",
  create_account: "business-outline",
  create_category: "pricetag-outline",
  update_import_rule: "color-wand-outline",
  retain_fixture: "archive-outline",
  commit_drafts: "cloud-upload-outline",
  draft: "document-text-outline",
  transaction: "receipt-outline",
};

/** A compact, tappable card for a proposal or a link to a staged import or transaction. */
export function ActionCard({
  label,
  proposal,
  kind,
  onPress,
}: {
  label: string;
  proposal?: Proposal;
  kind: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const summary = proposal ? proposalSummary(proposal) : null;
  const title = summary?.title || label;
  const detail =
    summary?.detail ||
    (kind === "draft"
      ? "Staged import · review before it is saved"
      : kind === "transaction"
        ? "Saved transaction"
        : "No longer available");
  const state = summary?.state;
  const highlight = state === "Needs approval";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        summary
          ? `${label}: ${summary.title}, ${summary.detail}. ${summary.state}`
          : label
      }
      disabled={!onPress}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.card,
        opacity: onPress ? 1 : 0.6,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: colors.tint,
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
            {state ? ` · ${state}` : ""}
          </Txt>
        </View>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={highlight ? colors.purple : colors.muted}
      />
    </Pressable>
  );
}

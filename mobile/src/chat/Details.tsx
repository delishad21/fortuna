import React, { useState } from "react";
import { View, Pressable } from "react-native";
import { Txt, useTheme } from "../ui";
import { displayValue, fieldLabel } from "./api";
export function Details({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (value && typeof value === "object")
    return (
      <View style={{ gap: 10, paddingLeft: depth ? 8 : 0 }}>
        {Object.entries(value).map(([key, item]) => (
          <View key={key}>
            <Txt muted size={12}>
              {Array.isArray(value)
                ? `Item ${Number(key) + 1}`
                : fieldLabel(key)}
            </Txt>
            <Details value={item} depth={depth + 1} />
          </View>
        ))}
      </View>
    );
  return <Txt selectable>{displayValue(value)}</Txt>;
}
export function Expandable({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  return (
    <View
      style={{
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        gap: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Txt bold>
          {title} {open ? "−" : "+"}
        </Txt>
      </Pressable>
      {open && children}
    </View>
  );
}

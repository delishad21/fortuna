import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

const light = {
  bg: "#F4F5F9",
  card: "#FFFFFF",
  sunken: "#F7F8FB",
  text: "#111928",
  muted: "#6B7280",
  faint: "#9CA3AF",
  line: "#E8EBF2",
  purple: "#5750F1",
  tint: "#EEEDFF",
  green: "#1A8245",
  greenTint: "#E5F6EC",
  red: "#DC2626",
  redTint: "#FDECEC",
  amber: "#B45309",
  amberTint: "#FEF3C7",
  blue: "#2563EB",
  blueTint: "#E8F0FE",
  backdrop: "rgba(17,25,40,0.45)",
};
const dark: typeof light = {
  bg: "#040A14",
  card: "#0C1624",
  sunken: "#08111D",
  text: "#F9FAFB",
  muted: "#A9B4C4",
  faint: "#6B7686",
  line: "#1A2432",
  purple: "#9A91FF",
  tint: "#201C43",
  green: "#34D399",
  greenTint: "#0E2A20",
  red: "#F87171",
  redTint: "#3A1414",
  amber: "#FBBF24",
  amberTint: "#33270B",
  blue: "#60A5FA",
  blueTint: "#0F213D",
  backdrop: "rgba(0,0,0,0.6)",
};
export type Colors = typeof light;
export type Tone = "neutral" | "purple" | "green" | "red" | "amber" | "blue";
export const BRAND = "#5750F1";
export const PALETTE = [
  "#5750F1",
  "#8136DA",
  "#E0457B",
  "#F2994A",
  "#F2C94C",
  "#22AD5C",
  "#14B8A6",
  "#0EA5E9",
  "#3B82F6",
  "#64748B",
];
const ThemeContext = createContext({
  colors: light,
  mode: "system",
  setMode: (_: string) => {},
  isDark: false,
});
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, updateMode] = useState("system");
  useEffect(() => {
    void AsyncStorage.getItem("fortuna.theme").then((value) => {
      if (value && ["system", "light", "dark"].includes(value))
        updateMode(value);
    });
  }, []);
  const setMode = (value: string) => {
    updateMode(value);
    void AsyncStorage.setItem("fortuna.theme", value);
  };
  const isDark = mode === "dark" || (mode === "system" && system === "dark");
  return (
    <ThemeContext.Provider
      value={{ colors: isDark ? dark : light, mode, setMode, isDark }}
    >
      {children}
      <ToastHost />
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
export function toneColors(colors: Colors, tone: Tone = "neutral") {
  return {
    neutral: { fg: colors.muted, bg: colors.sunken },
    purple: { fg: colors.purple, bg: colors.tint },
    green: { fg: colors.green, bg: colors.greenTint },
    red: { fg: colors.red, bg: colors.redTint },
    amber: { fg: colors.amber, bg: colors.amberTint },
    blue: { fg: colors.blue, bg: colors.blueTint },
  }[tone];
}
export const tap = () => {
  if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => {});
};
export const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  stack: { gap: 16 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  card: { borderRadius: 22, padding: 18, gap: 14, borderWidth: 1 },
  title: {
    fontFamily: "Montserrat_700Bold",
    fontSize: 28,
    lineHeight: 35,
    letterSpacing: -0.9,
  },
  body: { fontFamily: "DMSans_400Regular", fontSize: 15, lineHeight: 22 },
  label: { fontFamily: "DMSans_600SemiBold", fontSize: 13 },
  money: { fontFamily: "DMMono_400Regular", fontSize: 16 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
  },
});
export function Txt({
  children,
  muted = false,
  size = 15,
  bold = false,
  mono = false,
  tone,
  style,
  ...props
}: any) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[
        styles.body,
        {
          color: tone
            ? toneColors(colors, tone).fg
            : muted
              ? colors.muted
              : colors.text,
          fontSize: size,
          lineHeight: Math.round(size * 1.4),
          fontFamily: mono
            ? "DMMono_400Regular"
            : bold
              ? "DMSans_600SemiBold"
              : "DMSans_400Regular",
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Card({ children, style, onPress, accessibilityLabel }: any) {
  const { colors } = useTheme();
  const base = [
    styles.card,
    { backgroundColor: colors.card, borderColor: colors.line },
    style,
  ];
  if (onPress)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [...base, { opacity: pressed ? 0.85 : 1 }]}
      >
        {children}
      </Pressable>
    );
  return <View style={base}>{children}</View>;
}
export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  ghost = false,
  disabled = false,
  loading = false,
  compact = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  ghost?: boolean;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  icon?: any;
  style?: any;
}) {
  const { colors } = useTheme();
  const fg =
    secondary || ghost ? (danger ? colors.red : colors.purple) : "#FFFFFF";
  const bg = ghost
    ? "transparent"
    : secondary
      ? danger
        ? colors.redTint
        : colors.tint
      : danger
        ? colors.red
        : BRAND;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        {
          minHeight: compact ? 38 : 50,
          borderRadius: compact ? 12 : 16,
          paddingVertical: compact ? 8 : 13,
          paddingHorizontal: compact ? 14 : 18,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        icon && <Ionicons name={icon} color={fg} size={compact ? 16 : 19} />
      )}
      <Txt
        bold
        size={compact ? 13 : 15}
        style={{ color: fg, textAlign: "center", flexShrink: 1 }}
        numberOfLines={compact ? 1 : 2}
      >
        {title}
      </Txt>
    </Pressable>
  );
}
export function IconButton({
  icon,
  onPress,
  label,
  tone = "neutral",
  size = 40,
  filled = true,
  disabled = false,
}: {
  icon: any;
  onPress: () => void;
  label: string;
  tone?: Tone;
  size?: number;
  filled?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const t = toneColors(colors, tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: filled
          ? tone === "neutral"
            ? colors.card
            : t.bg
          : "transparent",
        borderWidth: filled && tone === "neutral" ? 1 : 0,
        borderColor: colors.line,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={size * 0.5}
        color={tone === "neutral" ? colors.text : t.fg}
      />
    </Pressable>
  );
}
export function Input({
  label,
  value,
  onChangeText,
  hint,
  icon,
  error,
  ...props
}: any) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 7 }}>
      {!!label && (
        <Txt muted size={13} bold>
          {label}
        </Txt>
      )}
      <View
        style={[
          styles.input,
          {
            flexDirection: "row",
            alignItems: props.multiline ? "flex-start" : "center",
            gap: 10,
            paddingVertical: 0,
            borderColor: error
              ? colors.red
              : focused
                ? colors.purple
                : colors.line,
            backgroundColor: colors.sunken,
          },
        ]}
      >
        {icon && <Ionicons name={icon} size={18} color={colors.muted} />}
        <TextInput
          accessibilityLabel={label || props.placeholder}
          value={value ?? ""}
          onChangeText={onChangeText}
          placeholderTextColor={colors.faint}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: colors.text,
            fontSize: 16,
            fontFamily: "DMSans_400Regular",
            paddingVertical: 13,
            minHeight: props.multiline ? 96 : undefined,
            textAlignVertical: props.multiline ? "top" : "center",
            ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
          }}
          {...props}
        />
      </View>
      {!!hint && (
        <Txt muted size={12}>
          {hint}
        </Txt>
      )}
    </View>
  );
}
export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search",
  label,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 14,
        paddingHorizontal: 12,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        minHeight: 46,
      }}
    >
      <Ionicons name="search" size={18} color={colors.muted} />
      <TextInput
        accessibilityLabel={label || placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        style={{
          flex: 1,
          color: colors.text,
          fontSize: 15,
          fontFamily: "DMSans_400Regular",
          paddingVertical: 11,
          ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
        }}
      />
      {!!value && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
          hitSlop={10}
        >
          <Ionicons name="close-circle" size={18} color={colors.faint} />
        </Pressable>
      )}
    </View>
  );
}
/** Bottom sheet presented over the current screen. */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.spring(slide, {
        toValue: 1,
        useNativeDriver: Platform.OS !== "web",
        damping: 22,
        stiffness: 220,
        mass: 0.9,
      }).start();
    }
  }, [visible, slide]);
  const Body: any = scroll ? ScrollView : View;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: "flex-end" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]}
        />
        <Animated.View
          style={{
            maxHeight: "92%",
            backgroundColor: colors.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingBottom: footer ? 0 : Math.max(insets.bottom, 12),
            overflow: "hidden",
            transform: [
              {
                translateY: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [500, 0],
                }),
              },
            ],
          }}
        >
          <View style={{ alignItems: "center", paddingTop: 10 }}>
            <View
              style={{
                width: 40,
                height: 5,
                borderRadius: 3,
                backgroundColor: colors.line,
              }}
            />
          </View>
          {(title || subtitle) && (
            <View
              style={[
                styles.between,
                { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                {!!title && (
                  <Txt
                    style={{ fontFamily: "Montserrat_700Bold", fontSize: 20 }}
                  >
                    {title}
                  </Txt>
                )}
                {!!subtitle && <Txt muted size={13}>{subtitle}</Txt>}
              </View>
              <IconButton icon="close" label="Close" onPress={onClose} size={34} />
            </View>
          )}
          <Body
            keyboardShouldPersistTaps="handled"
            {...(scroll
              ? { contentContainerStyle: { padding: 20, gap: 16 } }
              : { style: { padding: 20, gap: 16, flexShrink: 1 } })}
          >
            {children}
          </Body>
          {footer && (
            <View
              style={{
                padding: 16,
                paddingBottom: Math.max(insets.bottom, 16),
                gap: 10,
                borderTopWidth: 1,
                borderTopColor: colors.line,
                backgroundColor: colors.card,
              }}
            >
              {footer}
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export type Action = {
  label: string;
  icon?: any;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
};
/** "More" button that opens a sheet of actions. */
export function ActionMenu({
  actions,
  title = "Actions",
  icon = "ellipsis-horizontal",
  label = "More actions",
  trigger,
}: {
  actions: (Action | false | null | undefined)[];
  title?: string;
  icon?: any;
  label?: string;
  trigger?: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const list = actions.filter(Boolean) as Action[];
  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <IconButton icon={icon} label={label} onPress={() => setOpen(true)} />
      )}
      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        <Group>
          {list.map((a) => (
            <ListItem
              key={a.label}
              icon={a.icon || "ellipse-outline"}
              tone={a.danger ? "red" : "purple"}
              title={a.label}
              subtitle={a.hint}
              titleTone={a.danger ? "red" : undefined}
              disabled={a.disabled}
              onPress={() => {
                setOpen(false);
                setTimeout(a.onPress, Platform.OS === "ios" ? 350 : 0);
              }}
            />
          ))}
        </Group>
      </Sheet>
    </>
  );
}
export function Choice({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose…",
  compact = false,
}: {
  label: string;
  value: any;
  options: { label: string; value: any; hint?: string; color?: string }[];
  onChange: (value: any) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Treat null, undefined and "" as the same "nothing chosen" value.
  const same = (a: any, b: any) => a === b || ((a == null || a === "") && (b == null || b === ""));
  const current = options.find((o) => same(o.value, value));
  return (
    <View style={{ gap: 7 }}>
      {!compact && (
        <Txt muted size={13} bold>
          {label}
        </Txt>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={[
          styles.input,
          styles.between,
          {
            borderColor: colors.line,
            backgroundColor: compact ? colors.card : colors.sunken,
            ...(compact ? { minHeight: 40, paddingVertical: 8 } : {}),
          },
        ]}
      >
        <View style={[styles.row, { flex: 1, gap: 8 }]}>
          {current?.color && <Dot color={current.color} />}
          <Txt
            numberOfLines={1}
            style={{ flex: 1 }}
            muted={!current}
            size={compact ? 14 : 15}
          >
            {current?.label || (compact ? label : placeholder)}
          </Txt>
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => {
          setOpen(false);
          setSearch("");
        }}
        title={label}
      >
        {options.length > 8 && (
          <SearchBar value={search} onChangeText={setSearch} />
        )}
        <Group>
          {options
            .filter((o) =>
              o.label.toLowerCase().includes(search.toLowerCase()),
            )
            .map((o, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                accessibilityState={{ selected: same(o.value, value) }}
                onPress={() => {
                  tap();
                  onChange(o.value);
                  setOpen(false);
                  setSearch("");
                }}
                style={({ pressed }) => [
                  styles.between,
                  {
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                    borderColor: colors.line,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <View style={[styles.row, { flex: 1, gap: 10 }]}>
                  {o.color && <Dot color={o.color} size={12} />}
                  <View style={{ flex: 1 }}>
                    <Txt>{o.label}</Txt>
                    {!!o.hint && (
                      <Txt muted size={12}>
                        {o.hint}
                      </Txt>
                    )}
                  </View>
                </View>
                {same(o.value, value) && (
                  <Ionicons name="checkmark" size={20} color={colors.purple} />
                )}
              </Pressable>
            ))}
        </Group>
      </Sheet>
    </View>
  );
}
/** Multi-select list of checkable rows. */
export function MultiSelect({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string; hint?: string; color?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const { colors } = useTheme();
  return (
    <Group>
      {options.map((o, i) => {
        const on = value.includes(o.value);
        return (
          <Pressable
            key={o.value}
            accessibilityRole="checkbox"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: on }}
            onPress={() => {
              tap();
              onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value]);
            }}
            style={[
              styles.row,
              {
                paddingHorizontal: 16,
                paddingVertical: 13,
                borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                borderColor: colors.line,
              },
            ]}
          >
            <Checkbox checked={on} />
            {o.color && <Dot color={o.color} />}
            <View style={{ flex: 1 }}>
              <Txt>{o.label}</Txt>
              {!!o.hint && (
                <Txt muted size={12}>
                  {o.hint}
                </Txt>
              )}
            </View>
          </Pressable>
        );
      })}
    </Group>
  );
}
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
}) {
  const { colors } = useTheme();
  const box = (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: checked ? colors.purple : colors.faint,
        backgroundColor: checked ? colors.purple : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {checked && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
    </View>
  );
  if (!onChange) return box;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        tap();
        onChange(!checked);
      }}
      style={{ padding: 4 }}
    >
      {box}
    </Pressable>
  );
}
export function Chips({
  values,
  value,
  onChange,
  labels,
  counts,
}: {
  values: string[];
  value: string;
  onChange: (value: string) => void;
  labels?: Record<string, string>;
  counts?: Record<string, number | undefined>;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 8 }}
    >
      {values.map((v) => {
        const on = value === v;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels?.[v] || v}
            accessibilityState={{ selected: on }}
            key={v}
            onPress={() => {
              tap();
              onChange(v);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 24,
              paddingHorizontal: 15,
              paddingVertical: 9,
              backgroundColor: on ? colors.text : colors.card,
              borderWidth: 1,
              borderColor: on ? colors.text : colors.line,
            }}
          >
            <Txt bold size={13} style={{ color: on ? colors.bg : colors.muted }}>
              {labels?.[v] || v}
            </Txt>
            {counts?.[v] != null && (
              <View
                style={{
                  minWidth: 20,
                  paddingHorizontal: 6,
                  borderRadius: 10,
                  backgroundColor: on ? colors.purple : colors.sunken,
                  alignItems: "center",
                }}
              >
                <Txt bold size={11} style={{ color: on ? "#FFFFFF" : colors.muted }}>
                  {counts[v]}
                </Txt>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
/** iOS-style segmented control for switching views within a screen. */
export function Segmented({
  values,
  value,
  onChange,
  labels,
}: {
  values: string[];
  value: string;
  onChange: (value: string) => void;
  labels?: Record<string, string>;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: colors.line,
        borderRadius: 14,
        padding: 3,
      }}
    >
      {values.map((v) => {
        const on = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityLabel={labels?.[v] || v}
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(v);
            }}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 11,
              alignItems: "center",
              backgroundColor: on ? colors.card : "transparent",
              ...(on
                ? {
                    shadowColor: "#000",
                    shadowOpacity: 0.08,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 1 },
                    elevation: 1,
                  }
                : {}),
            }}
          >
            <Txt
              bold
              size={13}
              numberOfLines={1}
              style={{ color: on ? colors.text : colors.muted }}
            >
              {labels?.[v] || v}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
export function Screen({
  children,
  refreshControl,
  footer,
  padded = true,
}: any) {
  const { colors } = useTheme();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={padded ? styles.content : { paddingBottom: 48 }}
      >
        {children}
      </ScrollView>
      {footer && <Footer>{footer}</Footer>}
    </KeyboardAvoidingView>
  );
}
/** Sticky bottom bar for a screen's primary action. */
export function Footer({ children, inTab = false }: any) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      // Above a tab bar, the tab bar already covers the home indicator.
      edges={inTab ? [] : ["bottom"]}
      style={{
        backgroundColor: colors.card,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: Platform.OS === "web" || inTab ? 12 : 4,
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      {children}
    </SafeAreaView>
  );
}
export function Heading({ title, subtitle, right, eyebrow }: any) {
  return (
    <View style={[styles.between, { alignItems: "flex-end" }]}>
      <View style={{ flex: 1, gap: 4 }}>
        {!!eyebrow && (
          <Txt
            muted
            bold
            size={12}
            style={{ textTransform: "uppercase", letterSpacing: 1 }}
          >
            {eyebrow}
          </Txt>
        )}
        <Txt style={styles.title}>{title}</Txt>
        {!!subtitle && <Txt muted>{subtitle}</Txt>}
      </View>
      {right}
    </View>
  );
}
export function Section({
  title,
  action,
  onAction,
  children,
  hint,
}: {
  title?: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
  hint?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      {(title || action) && (
        <View style={[styles.between, { paddingHorizontal: 4 }]}>
          <Txt bold size={17}>
            {title}
          </Txt>
          {action && onAction && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action}
              onPress={onAction}
              hitSlop={10}
            >
              <Txt bold size={14} style={{ color: colors.purple }}>
                {action}
              </Txt>
            </Pressable>
          )}
        </View>
      )}
      {children}
      {!!hint && (
        <Txt muted size={12} style={{ paddingHorizontal: 4 }}>
          {hint}
        </Txt>
      )}
    </View>
  );
}
/** Card holding stacked rows separated by hairlines. */
export function Group({ children, style }: any) {
  const { colors } = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return (
    <View
      style={[
        {
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {items.map((child, i) => (
        <View
          key={i}
          style={
            i
              ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }
              : undefined
          }
        >
          {child}
        </View>
      ))}
    </View>
  );
}
export function IconBubble({
  icon,
  tone = "purple",
  color,
  size = 40,
  text,
}: {
  icon?: any;
  tone?: Tone;
  color?: string;
  size?: number;
  text?: string;
}) {
  const { colors } = useTheme();
  const t = toneColors(colors, tone);
  const fg = color || t.fg;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.34,
        backgroundColor: color ? `${color}22` : t.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {text ? (
        <Txt bold size={size * 0.4} style={{ color: fg }}>
          {text}
        </Txt>
      ) : (
        <Ionicons name={icon} size={size * 0.5} color={fg} />
      )}
    </View>
  );
}
export function ListItem({
  icon,
  tone = "purple",
  color,
  title,
  subtitle,
  value,
  valueTone,
  detail,
  onPress,
  chevron,
  right,
  left,
  titleTone,
  disabled,
  accessibilityLabel,
}: {
  icon?: any;
  tone?: Tone;
  color?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  valueTone?: Tone;
  detail?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  right?: React.ReactNode;
  left?: React.ReactNode;
  titleTone?: Tone;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const body = (
    <>
      {left ?? (icon ? <IconBubble icon={icon} tone={tone} color={color} size={36} /> : null)}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === "string" ? (
          <Txt bold numberOfLines={2} tone={titleTone}>
            {title}
          </Txt>
        ) : (
          title
        )}
        {!!subtitle &&
          (typeof subtitle === "string" ? (
            <Txt muted size={13} numberOfLines={2}>
              {subtitle}
            </Txt>
          ) : (
            subtitle
          ))}
      </View>
      {(value != null || detail != null) && (
        <View style={{ alignItems: "flex-end", gap: 2, maxWidth: "48%" }}>
          {value != null &&
            (typeof value === "string" ? (
              <Txt mono size={14} tone={valueTone} numberOfLines={1}>
                {value}
              </Txt>
            ) : (
              value
            ))}
          {detail != null &&
            (typeof detail === "string" ? (
              <Txt muted size={12} numberOfLines={1}>
                {detail}
              </Txt>
            ) : (
              detail
            ))}
        </View>
      )}
      {right}
      {(chevron ?? !!onPress) && onPress && (
        <Ionicons name="chevron-forward" size={18} color={colors.faint} />
      )}
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 56,
    opacity: disabled ? 0.45 : 1,
  };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel || (typeof title === "string" ? title : undefined)
      }
      disabled={disabled}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        style,
        { backgroundColor: pressed ? colors.sunken : "transparent" },
      ]}
    >
      {body}
    </Pressable>
  );
}
export function Pill({
  label,
  tone = "neutral",
  icon,
}: {
  label: string;
  tone?: Tone;
  icon?: any;
}) {
  const { colors } = useTheme();
  const t = toneColors(colors, tone);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 3,
        backgroundColor: t.bg,
      }}
    >
      {icon && <Ionicons name={icon} size={12} color={t.fg} />}
      <Txt bold size={11} style={{ color: t.fg }}>
        {label}
      </Txt>
    </View>
  );
}
export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }}
    />
  );
}
export function Stat({
  label,
  value,
  tone,
  icon,
  detail,
  onPress,
}: {
  label: string;
  value: string;
  tone?: Tone;
  icon?: any;
  detail?: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={label}
      style={{ flex: 1, minWidth: "45%", padding: 14, gap: 8, borderRadius: 18 }}
    >
      <View style={[styles.row, { gap: 8 }]}>
        {icon && <IconBubble icon={icon} tone={tone || "purple"} size={28} />}
        <Txt muted size={12} bold numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Txt>
      </View>
      <Txt
        mono
        size={18}
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ color: tone ? toneColors(colors, tone).fg : colors.text }}
      >
        {value}
      </Txt>
      {!!detail && (
        <Txt muted size={12} numberOfLines={2}>
          {detail}
        </Txt>
      )}
    </Card>
  );
}
export function StatGrid({ children }: any) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {children}
    </View>
  );
}
export function KeyValue({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: Tone;
}) {
  return (
    <View style={[styles.between, { alignItems: "flex-start" }]}>
      <Txt muted size={14}>
        {label}
      </Txt>
      {typeof value === "string" || typeof value === "number" ? (
        <Txt
          mono={mono}
          size={14}
          tone={tone}
          style={{ flexShrink: 1, textAlign: "right" }}
        >
          {value}
        </Txt>
      ) : (
        value
      )}
    </View>
  );
}
export function Progress({
  value,
  color,
  height = 8,
}: {
  value: number;
  color?: string;
  height?: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height,
        borderRadius: height,
        backgroundColor: colors.line,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height,
          borderRadius: height,
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          backgroundColor: color || colors.purple,
        }}
      />
    </View>
  );
}
export function Banner({
  tone = "purple",
  icon = "information-circle-outline",
  title,
  message,
  action,
  onAction,
}: {
  tone?: Tone;
  icon?: any;
  title?: string;
  message?: string;
  action?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  const t = toneColors(colors, tone);
  return (
    <View
      accessibilityRole={tone === "red" ? "alert" : undefined}
      style={{
        flexDirection: "row",
        gap: 12,
        padding: 14,
        borderRadius: 18,
        backgroundColor: t.bg,
      }}
    >
      <Ionicons name={icon} size={20} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 4 }}>
        {!!title && (
          <Txt bold style={{ color: t.fg }}>
            {title}
          </Txt>
        )}
        {!!message && (
          <Txt size={14} style={{ color: colors.text }}>
            {message}
          </Txt>
        )}
        {action && onAction && (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
            <Txt bold size={14} style={{ color: t.fg, marginTop: 4 }}>
              {action}
            </Txt>
          </Pressable>
        )}
      </View>
    </View>
  );
}
export function Empty({
  icon = "sparkles-outline",
  title = "Nothing here yet",
  message,
  action,
  onAction,
}: {
  icon?: any;
  title?: string;
  message?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ alignItems: "center", gap: 10, paddingVertical: 32, paddingHorizontal: 20 }}>
      <IconBubble icon={icon} size={56} />
      <Txt bold size={17} style={{ textAlign: "center" }}>
        {title}
      </Txt>
      {!!message && (
        <Txt muted style={{ textAlign: "center" }}>
          {message}
        </Txt>
      )}
      {action && onAction && (
        <Button title={action} onPress={onAction} compact secondary />
      )}
    </View>
  );
}
export function State({ loading, error, reload, empty, data }: any) {
  if (loading && !data)
    return (
      <ActivityIndicator size="large" style={{ padding: 30 }} color={BRAND} />
    );
  if (error)
    return (
      <Banner
        tone="red"
        icon="cloud-offline-outline"
        title="Couldn’t load this"
        message={error}
        action={reload ? "Try again" : undefined}
        onAction={reload}
      />
    );
  if (empty)
    return (
      <Card>
        <Empty title="A fresh start" message={empty} />
      </Card>
    );
  return null;
}
export const money = (amount: any, currency = "SGD") => {
  try {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency: currency || "SGD",
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
};
/** Compact money for chart axes and tight tiles, e.g. $1.2k. */
export const shortMoney = (amount: any, currency = "SGD") => {
  const n = Number(amount || 0);
  const abs = Math.abs(n);
  if (abs < 1000) return money(n, currency).replace(/\.00$/, "");
  try {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency: currency || "SGD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return `${(n / 1000).toFixed(1)}k`;
  }
};
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** "2026-09-20" → "20 Sep 2026" */
export const fmtDate = (value: any, withYear = true) => {
  const s = String(value || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${withYear ? ` ${m[1]}` : ""}`;
};
/** "2026-09" → "September 2026" (short: "Sep 2026") */
export const fmtMonth = (value: any, short = false) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(value || ""));
  if (!m) return String(value || "");
  const name = MONTHS[Number(m[2]) - 1];
  const long = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][Number(m[2]) - 1];
  return `${short ? name : long} ${m[1]}`;
};
/** Section header for a day: Today, Yesterday or "Wed, 8 Oct". */
export const dayLabel = (value: any) => {
  const s = String(value || "").slice(0, 10);
  if (s === today()) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (s === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`)
    return "Yesterday";
  const d = new Date(`${s}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return s;
  return `${DAYS[d.getDay()]}, ${fmtDate(s, d.getFullYear() !== new Date().getFullYear())}`;
};
/** Group rows into SectionList sections by calendar day. */
export function groupByDay<T extends { date?: any }>(rows: T[]) {
  const sections: { title: string; key: string; data: T[] }[] = [];
  for (const row of rows) {
    const key = String(row.date || "").slice(0, 10);
    const last = sections[sections.length - 1];
    if (last?.key === key) last.data.push(row);
    else sections.push({ key, title: dayLabel(key), data: [row] });
  }
  return sections;
}
export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;
export const humanize = (value: any) =>
  String(value || "")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export const notice = (error: any) => {
  const message = error?.message || String(error);
  // Alert is a no-op in react-native-web.
  if (Platform.OS === "web") window.alert(`Couldn’t complete action\n\n${message}`);
  else Alert.alert("Couldn’t complete action", message);
};
export const confirm = (
  title: string,
  message: string,
  action: () => Promise<any>,
  confirmLabel = "Confirm",
) => {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) void action().catch(notice);
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    {
      text: confirmLabel,
      style: "destructive",
      onPress: () => {
        void action().catch(notice);
      },
    },
  ]);
};
type ToastMessage = { id: number; text: string; tone: Tone };
let pushToast: (m: ToastMessage) => void = () => {};
/** Short confirmation shown at the bottom of the screen. */
export const toast = (text: string, tone: Tone = "green") => {
  if (Platform.OS !== "web")
    void Haptics.notificationAsync(
      tone === "red"
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
  pushToast({ id: Date.now(), text, tone });
};
function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pushToast = setMessage;
    return () => {
      pushToast = () => {};
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    Animated.timing(fade, {
      toValue: 1,
      duration: 180,
      useNativeDriver: Platform.OS !== "web",
    }).start();
    const timer = setTimeout(
      () =>
        Animated.timing(fade, {
          toValue: 0,
          duration: 220,
          useNativeDriver: Platform.OS !== "web",
        }).start(() => setMessage(null)),
      2600,
    );
    return () => clearTimeout(timer);
  }, [message, fade]);
  if (!message) return null;
  const t = toneColors(colors, message.tone);
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: insets.bottom + 90,
        opacity: fade,
        transform: [
          {
            translateY: fade.interpolate({
              inputRange: [0, 1],
              outputRange: [16, 0],
            }),
          },
        ],
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          alignSelf: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 16,
          backgroundColor: colors.text,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Ionicons
          name={message.tone === "red" ? "alert-circle" : "checkmark-circle"}
          size={18}
          color={t.fg}
        />
        <Txt bold size={14} style={{ color: colors.bg }}>
          {message.text}
        </Txt>
      </View>
    </Animated.View>
  );
}
export type Field = {
  key: string;
  label: string;
  type?:
    | "number"
    | "password"
    | "boolean"
    | "date"
    | "multiline"
    | "color"
    | "currency";
  options?: { label: string; value: any; hint?: string; color?: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  hidden?: boolean;
};
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Txt muted size={13} bold>
        {label}
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {PALETTE.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`Color ${c}`}
            accessibilityState={{ selected: value?.toLowerCase() === c.toLowerCase() }}
            onPress={() => {
              tap();
              onChange(c);
            }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: c,
              borderWidth: 3,
              borderColor:
                value?.toLowerCase() === c.toLowerCase() ? colors.text : "transparent",
            }}
          />
        ))}
      </View>
      <Input
        value={value}
        onChangeText={onChange}
        placeholder="#5750F1"
        autoCapitalize="none"
        accessibilityLabel={`${label} hex`}
      />
    </View>
  );
}
export function Form({
  fields,
  initial = {},
  onSave,
  submit = "Save changes",
  submitIcon,
  children,
  onChange,
}: {
  fields: Field[];
  initial?: any;
  onSave: (value: any) => Promise<any>;
  submit?: string;
  submitIcon?: any;
  children?: React.ReactNode;
  onChange?: (value: any) => void;
}) {
  const [value, setValue] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: string, v: any) =>
    setValue((old: any) => {
      const next = { ...old, [key]: v };
      onChange?.(next);
      return next;
    });
  return (
    <View style={styles.stack}>
      {fields
        .filter((f) => !f.hidden)
        .map((field) =>
          field.type === "boolean" ? (
            <View key={field.key} style={styles.between}>
              <View style={{ flex: 1 }}>
                <Txt>{field.label}</Txt>
                {!!field.hint && (
                  <Txt muted size={12}>
                    {field.hint}
                  </Txt>
                )}
              </View>
              <Switch
                accessibilityLabel={field.label}
                value={!!value[field.key]}
                onValueChange={(v) => set(field.key, v)}
              />
            </View>
          ) : field.options ? (
            <Choice
              key={field.key}
              label={field.label}
              value={value[field.key]}
              options={field.options}
              onChange={(v) => set(field.key, v)}
            />
          ) : field.type === "date" ? (
            <DateField
              key={field.key}
              label={field.label}
              value={value[field.key] || ""}
              onChange={(v: string) => set(field.key, v)}
            />
          ) : field.type === "color" ? (
            <ColorField
              key={field.key}
              label={field.label}
              value={value[field.key] || ""}
              onChange={(v) => set(field.key, v)}
            />
          ) : (
            <Input
              key={field.key}
              label={field.label}
              hint={field.hint}
              placeholder={field.placeholder}
              value={String(value[field.key] ?? "")}
              onChangeText={(v: string) =>
                set(field.key, field.type === "currency" ? v.toUpperCase() : v)
              }
              autoCapitalize={
                field.type === "password"
                  ? "none"
                  : field.type === "currency"
                    ? "characters"
                    : "sentences"
              }
              maxLength={field.type === "currency" ? 3 : undefined}
              multiline={field.type === "multiline"}
              secureTextEntry={field.type === "password"}
              keyboardType={field.type === "number" ? "decimal-pad" : "default"}
            />
          ),
        )}
      {children}
      {!!error && <Banner tone="red" icon="alert-circle-outline" message={error} />}
      <Button
        title={busy ? "Saving…" : submit}
        icon={submitIcon}
        loading={busy}
        disabled={busy}
        onPress={async () => {
          setError("");
          setBusy(true);
          try {
            const result = { ...value };
            for (const f of fields) {
              if (f.hidden) continue;
              if (f.required && (result[f.key] === "" || result[f.key] == null))
                throw new Error(`${f.label} is required`);
              if (
                f.type === "number" &&
                result[f.key] !== "" &&
                result[f.key] != null
              ) {
                result[f.key] = Number(result[f.key]);
                if (!Number.isFinite(result[f.key]))
                  throw new Error(`${f.label} must be a number`);
              }
              if (
                f.type === "currency" &&
                result[f.key] &&
                !/^[A-Z]{3}$/.test(String(result[f.key]).trim().toUpperCase())
              )
                throw new Error(`${f.label} must be a three-letter code, such as SGD`);
              if (f.type === "currency" && result[f.key])
                result[f.key] = String(result[f.key]).trim().toUpperCase();
              if (
                f.type === "date" &&
                result[f.key] &&
                (!/^\d{4}-\d{2}-\d{2}$/.test(result[f.key]) ||
                  !Number.isFinite(new Date(result[f.key]).getTime()))
              )
                throw new Error(`${f.label} must be YYYY-MM-DD`);
            }
            await onSave(result);
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}
const CATEGORY_ICONS: [RegExp, string][] = [
  [/food|dining|restaurant|eat|meal|grocer|supermarket|cafe|coffee/i, "restaurant-outline"],
  [/transport|taxi|grab|bus|mrt|train|transit|fuel|petrol|car|parking/i, "bus-outline"],
  [/flight|travel|hotel|trip|accommodation|airbnb/i, "airplane-outline"],
  [/shop|retail|clothing|fashion|amazon|shopee|lazada/i, "bag-handle-outline"],
  [/bill|utilit|electric|water|internet|phone|telco|mobile/i, "flash-outline"],
  [/rent|housing|home|mortgage/i, "home-outline"],
  [/health|medical|doctor|clinic|pharma|dental|insurance/i, "medkit-outline"],
  [/entertain|movie|game|music|stream|netflix|spotify|subscription/i, "film-outline"],
  [/salary|income|payroll|bonus|interest|dividend/i, "cash-outline"],
  [/transfer|internal/i, "swap-horizontal-outline"],
  [/invest|stock|crypto|saving/i, "trending-up-outline"],
  [/gift|donat|charity/i, "gift-outline"],
  [/educat|school|course|book/i, "school-outline"],
  [/fee|charge|tax/i, "receipt-outline"],
  [/reimburse|refund/i, "return-down-back-outline"],
];
export const categoryIcon = (name?: string) =>
  (CATEGORY_ICONS.find(([re]) => re.test(name || ""))?.[1] ||
    "pricetag-outline") as any;
export function TransactionRow({
  item,
  onPress,
  onLongPress,
  selected,
  selectable,
  baseCurrency,
  showDate = true,
  right,
}: any) {
  const { colors } = useTheme();
  const tripEntry = item.type && item.localAmount != null;
  const income = tripEntry
    ? ["reimbursement", "funding_in"].includes(item.type)
    : Number(item.amountIn || 0) > 0 || item.type === "reimbursement";
  const category = item.category?.name;
  const walletColor =
    item.wallet?.id !== "__external__" && !/^#f{3}(f{3})?$/i.test(item.wallet?.color || "")
      ? item.wallet?.color
      : undefined;
  const catColor = item.category?.color || walletColor;
  const internal = item.linkage?.type === "internal";
  const badges: { label: string; tone: Tone }[] = [];
  if (internal) badges.push({ label: "Internal", tone: "blue" });
  if (item.linkage?.type === "reimbursement" || item.type === "reimbursement")
    badges.push({ label: "Reimbursement", tone: "green" });
  if (item.linkage?.reimbursedByAllocations?.length)
    badges.push({ label: "Reimbursed", tone: "green" });
  if (item.type === "funding_out") badges.push({ label: "Transfer out", tone: "amber" });
  if (item.type === "funding_in") badges.push({ label: "Funding", tone: "purple" });
  if (item.metadata?.sourceDetached) badges.push({ label: "Bank row removed", tone: "red" });
  const subtitle = [
    showDate ? fmtDate(item.date, false) : null,
    category || item.wallet?.name || (tripEntry ? null : "Uncategorized"),
    !tripEntry && item.accountIdentifier ? item.accountLabel || item.accountIdentifier : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const amount = tripEntry
    ? item.localAmount
    : income
      ? item.amountIn
      : item.amountOut;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label || item.description}
      accessibilityState={selectable || selected ? { selected: !!selected } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 4,
        borderRadius: 14,
        backgroundColor: selected
          ? colors.tint
          : pressed
            ? colors.sunken
            : "transparent",
      })}
    >
      {selectable || selected ? (
        <View style={{ width: 40, alignItems: "center" }}>
          <Checkbox checked={!!selected} />
        </View>
      ) : (
        <IconBubble
          icon={
            internal
              ? "swap-horizontal-outline"
              : category
                ? categoryIcon(category)
                : income
                  ? "arrow-down-outline"
                  : "arrow-up-outline"
          }
          color={catColor || undefined}
          tone={income ? "green" : "purple"}
          size={40}
        />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold numberOfLines={1}>
          {item.label || item.description}
        </Txt>
        <Txt muted size={12} numberOfLines={1}>
          {subtitle}
        </Txt>
        {badges.length > 0 && (
          <View style={{ flexDirection: "row", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
            {badges.slice(0, 2).map((b) => (
              <Pill key={b.label} label={b.label} tone={b.tone} />
            ))}
          </View>
        )}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Txt
          mono
          size={14}
          style={{
            color: internal ? colors.muted : income ? colors.green : colors.text,
          }}
        >
          {income ? "+" : "−"}
          {money(amount, item.localCurrency || item.currency || "SGD")}
        </Txt>
        {tripEntry &&
          baseCurrency &&
          item.baseAmount != null &&
          item.localCurrency !== baseCurrency && (
            <Txt muted mono size={11}>
              {money(item.baseAmount, baseCurrency)}
            </Txt>
          )}
      </View>
      {right}
    </Pressable>
  );
}
export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(value + "T12:00:00") : new Date();
  const date = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  if (Platform.OS === "web")
    return (
      <Input
        label={label}
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        icon="calendar-outline"
      />
    );
  return (
    <View style={{ gap: 7 }}>
      <Txt muted size={13} bold>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(!open)}
        style={[
          styles.input,
          styles.between,
          { borderColor: open ? colors.purple : colors.line, backgroundColor: colors.sunken },
        ]}
      >
        <View style={[styles.row, { gap: 10 }]}>
          <Ionicons name="calendar-outline" size={18} color={colors.muted} />
          <Txt muted={!value}>{value ? fmtDate(value) : "Choose date"}</Txt>
        </View>
        {!!value && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={10}
            onPress={() => onChange("")}
          >
            <Ionicons name="close-circle" size={18} color={colors.faint} />
          </Pressable>
        )}
      </Pressable>
      {open && (
        <>
          <DateTimePicker
            value={date}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            accentColor={colors.purple}
            themeVariant={colors === dark ? "dark" : "light"}
            onChange={(event, selected) => {
              if (Platform.OS !== "ios") setOpen(false);
              if (event.type === "set" && selected)
                onChange(
                  `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`,
                );
            }}
          />
          {Platform.OS === "ios" && (
            <Button title="Done" secondary compact onPress={() => setOpen(false)} />
          )}
        </>
      )}
    </View>
  );
}

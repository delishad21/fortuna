import React, { createContext, useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { SafeAreaView } from "react-native-safe-area-context";

const light = {
  bg: "#F3F4F6",
  card: "#FFFFFF",
  text: "#111928",
  muted: "#6B7280",
  line: "#E6EBF1",
  purple: "#5750F1",
  tint: "#EEEDFF",
  green: "#1A8245",
  red: "#DC2626",
};
const dark = {
  bg: "#040A14",
  card: "#0A1320",
  text: "#F9FAFB",
  muted: "#CBD5E1",
  line: "#1A2432",
  purple: "#9A91FF",
  tint: "#201C43",
  green: "#34D399",
  red: "#F87171",
};
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
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
export const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  stack: { gap: 16 },
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  card: { borderRadius: 20, padding: 20, gap: 14, borderWidth: 1 },
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
    borderRadius: 12,
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
          color: muted ? colors.muted : colors.text,
          fontSize: size,
          fontFamily: bold ? "DMSans_600SemiBold" : "DMSans_400Regular",
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Card({ children, style }: any) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon?: any;
}) {
  const { colors } = useTheme();
  const fg = secondary ? (danger ? colors.red : colors.purple) : "#FFFFFF";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: 14,
        paddingVertical: 13,
        paddingHorizontal: 18,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        backgroundColor: secondary
          ? colors.tint
          : danger
            ? colors.red
            : "#5750F1",
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      {icon && <Ionicons name={icon} color={fg} size={19} />}
      <Txt bold style={{ color: fg }}>
        {title}
      </Txt>
    </Pressable>
  );
}
export function Input({ label, value, onChangeText, ...props }: any) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 7 }}>
      <Txt muted size={13} bold>
        {label}
      </Txt>
      <TextInput
        accessibilityLabel={label}
        value={value ?? ""}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          {
            color: colors.text,
            borderColor: colors.line,
            backgroundColor: colors.card,
          },
        ]}
        {...props}
      />
    </View>
  );
}
export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: any;
  options: { label: string; value: any }[];
  onChange: (value: any) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  return (
    <View style={{ gap: 7 }}>
      <Txt muted size={13} bold>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={[
          styles.input,
          styles.between,
          { borderColor: colors.line, backgroundColor: colors.card },
        ]}
      >
        <Txt>{options.find((o) => o.value === value)?.label || "Choose…"}</Txt>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <Button title="Done" secondary onPress={() => setOpen(false)} />
            <Txt bold size={24}>
              {label}
            </Txt>
            {options.length > 8 && (
              <Input label="Search" value={search} onChangeText={setSearch} />
            )}
            {options
              .filter((o) =>
                o.label.toLowerCase().includes(search.toLowerCase()),
              )
              .map((o, i) => (
                <Pressable
                  key={i}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={[
                    styles.input,
                    styles.between,
                    { borderColor: colors.line, backgroundColor: colors.card },
                  ]}
                >
                  <Txt>{o.label}</Txt>
                  {o.value === value && (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={colors.purple}
                    />
                  )}
                </Pressable>
              ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
export function Chips({
  values,
  value,
  onChange,
}: {
  values: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {values.map((v) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: value === v }}
          key={v}
          onPress={() => onChange(v)}
          style={{
            borderRadius: 24,
            paddingHorizontal: 17,
            paddingVertical: 10,
            backgroundColor: value === v ? colors.tint : colors.card,
            borderWidth: 1,
            borderColor: value === v ? colors.purple : colors.line,
          }}
        >
          <Txt
            bold
            size={13}
            style={{ color: value === v ? colors.purple : colors.muted }}
          >
            {v}
          </Txt>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function Screen({ children, refreshControl }: any) {
  const { colors } = useTheme();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export function Heading({ title, subtitle, right }: any) {
  return (
    <View style={styles.between}>
      <View style={{ flex: 1, gap: 6 }}>
        <Txt style={styles.title}>{title}</Txt>
        {subtitle && <Txt muted>{subtitle}</Txt>}
      </View>
      {right}
    </View>
  );
}
export function State({ loading, error, reload, empty }: any) {
  if (loading)
    return (
      <ActivityIndicator size="large" style={{ padding: 30 }} color="#5750F1" />
    );
  if (error)
    return (
      <Card>
        <Txt>{error}</Txt>
        <Button title="Try again" onPress={reload} />
      </Card>
    );
  if (empty)
    return (
      <Card>
        <Ionicons name="sparkles-outline" size={32} color="#5750F1" />
        <Txt bold size={19}>
          A fresh start
        </Txt>
        <Txt muted>{empty}</Txt>
      </Card>
    );
  return null;
}
export const money = (amount: any, currency = "SGD") => {
  try {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency,
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
};
export const today = () => new Date().toISOString().slice(0, 10);
export const notice = (error: any) =>
  Alert.alert("Couldn’t complete action", error.message || String(error));
export const confirm = (
  title: string,
  message: string,
  action: () => Promise<any>,
) => {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) void action().catch(notice);
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Confirm",
      style: "destructive",
      onPress: () => {
        void action().catch(notice);
      },
    },
  ]);
};
export type Field = {
  key: string;
  label: string;
  type?: "number" | "password" | "boolean" | "date";
  options?: { label: string; value: any }[];
  required?: boolean;
};
export function Form({
  fields,
  initial = {},
  onSave,
  submit = "Save changes",
}: {
  fields: Field[];
  initial?: any;
  onSave: (value: any) => Promise<any>;
  submit?: string;
}) {
  const [value, setValue] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: string, v: any) =>
    setValue((old: any) => ({ ...old, [key]: v }));
  return (
    <View style={styles.stack}>
      {fields.map((field) =>
        field.type === "boolean" ? (
          <View key={field.key} style={styles.between}>
            <Txt>{field.label}</Txt>
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
        ) : (
          <Input
            key={field.key}
            label={field.label}
            value={String(value[field.key] ?? "")}
            onChangeText={(v: string) => set(field.key, v)}
            autoCapitalize={field.type === "password" ? "none" : "sentences"}
            secureTextEntry={field.type === "password"}
            keyboardType={field.type === "number" ? "decimal-pad" : "default"}
          />
        ),
      )}
      {!!error && <Txt style={{ color: "#DC2626" }}>{error}</Txt>}
      <Button
        title={busy ? "Saving…" : submit}
        disabled={busy}
        onPress={async () => {
          setError("");
          setBusy(true);
          try {
            const result = { ...value };
            for (const f of fields) {
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
export function TransactionRow({ item, onPress, selected }: any) {
  const { colors } = useTheme();
  const income =
    Number(item.amountIn || 0) > 0 || item.type === "reimbursement";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderColor: colors.line,
      }}
    >
      <View style={styles.row}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            backgroundColor: colors.tint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={
              selected
                ? "checkmark"
                : income
                  ? "arrow-down-outline"
                  : "arrow-up-outline"
            }
            size={20}
            color={colors.purple}
          />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt bold numberOfLines={1}>
            {item.label || item.description}
          </Txt>
          <Txt muted size={12} numberOfLines={1}>
            {String(item.date || "").slice(0, 10)} ·{" "}
            {item.category?.name || item.wallet?.name || "Uncategorized"}
          </Txt>
        </View>
        <Txt
          style={[
            styles.money,
            { fontSize: 14, color: income ? colors.green : colors.text },
          ]}
        >
          {income ? "+" : "−"}
          {money(
            item.localAmount ?? (income ? item.amountIn : item.amountOut),
            item.localCurrency || item.currency || "SGD",
          )}
        </Txt>
      </View>
    </Pressable>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
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
      />
    );
  return (
    <View style={{ gap: 8 }}>
      <Txt muted size={13} bold>
        {label}
      </Txt>
      <Button
        title={value || "Choose date"}
        secondary
        icon="calendar-outline"
        onPress={() => setOpen(true)}
      />
      {open && (
        <>
          <DateTimePicker
            value={date}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(event, selected) => {
              if (Platform.OS !== "ios") setOpen(false);
              if (event.type === "set" && selected)
                onChange(
                  `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`,
                );
            }}
          />
          {Platform.OS === "ios" && (
            <Button title="Done" secondary onPress={() => setOpen(false)} />
          )}
        </>
      )}
      {!!value && (
        <Txt size={12} onPress={() => onChange("")}>
          Clear date
        </Txt>
      )}
    </View>
  );
}

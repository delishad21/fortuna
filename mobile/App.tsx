import { ChatTransactionScreen } from "./src/chat/TransactionScreen";
import { ChatScreen } from "./src/chat/ChatScreen";
import { ChatConversationScreen } from "./src/chat/ConversationScreen";
import { ChatApprovalScreen } from "./src/chat/ApprovalScreen";
import { AIConnectionScreen } from "./src/chat/ConnectionScreen";
import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { Montserrat_700Bold } from "@expo-google-fonts/montserrat/700Bold";
import { Montserrat_800ExtraBold } from "@expo-google-fonts/montserrat/800ExtraBold";
import { DMMono_400Regular } from "@expo-google-fonts/dm-mono/400Regular";
import { ApiProvider, useApi, normalizeServer } from "./src/api";
import { BRAND, Button, Form, styles, ThemeProvider, Txt, useTheme } from "./src/ui";
import { HomeScreen, AnalyticsScreen } from "./src/home";
import {
  TransactionsScreen,
  TransactionScreen,
  SplitScreen,
  LinkPickerScreen,
} from "./src/transactions";
import {
  ImportsScreen,
  DraftReviewScreen,
  ImportDetailScreen,
} from "./src/imports";
import { TripsScreen, TripEditorScreen } from "./src/trips/list";
import { TripScreen } from "./src/trips/trip";
import { TripEntriesScreen, TripEntryScreen } from "./src/trips/entries";
import {
  FundingListScreen,
  FundingScreen,
  FundingReviewScreen,
} from "./src/trips/funding";
import {
  WalletsScreen,
  WalletScreen,
  WalletAccountsScreen,
  CarryOverScreen,
} from "./src/trips/wallets";
import { PeopleScreen, SettleScreen, ShareCostScreen } from "./src/trips/people";
import { MembersScreen, SharedOverviewScreen } from "./src/trips/sharing";
import { TripImportScreen } from "./src/trips/import";
import { TripReimbursementScreen } from "./src/trips/reimburse";
import { BankPickerScreen } from "./src/trips/bank";
import {
  SettingsScreen,
  ProfileScreen,
  PasswordScreen,
  PreferencesScreen,
  ManageScreen,
  ManageEditorScreen,
  PatternsScreen,
  TokensScreen,
} from "./src/settings";
const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const TAB_TITLES: Record<string, string> = {
  Home: "Dashboard",
  Transactions: "Transactions",
  Import: "Imports",
  Trips: "Trips",
  Chat: "Chat",
};
const TAB_ICONS: Record<string, [string, string]> = {
  Home: ["home", "home-outline"],
  Transactions: ["receipt", "receipt-outline"],
  Import: ["file-tray-full", "file-tray-full-outline"],
  Trips: ["airplane", "airplane-outline"],
  Chat: ["chatbubble-ellipses", "chatbubble-ellipses-outline"],
};
function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={({ route, navigation }) => ({
        title: TAB_TITLES[route.name],
        tabBarLabel: TAB_TITLES[route.name],
        headerTitleAlign: "left",
        headerTitleStyle: { fontFamily: "DMSans_600SemiBold", fontSize: 18, color: colors.text },
        headerRight: () => (
          <View style={{ flexDirection: "row", paddingRight: 8 }}>
            {route.name === "Home" && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Analytics"
                onPress={() => navigation.navigate("Analytics")}
                style={{ padding: 10 }}
              >
                <Ionicons name="stats-chart-outline" size={22} color={colors.text} />
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={() => navigation.navigate("Settings")}
              style={{ padding: 10 }}
            >
              <Ionicons name="settings-outline" size={22} color={colors.text} />
            </Pressable>
          </View>
        ),
        headerStyle: { backgroundColor: colors.card },
        headerShadowVisible: true,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.line,
        },
        tabBarActiveTintColor: colors.purple,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontFamily: "DMSans_600SemiBold", fontSize: 10, lineHeight: 13 },
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons
            name={TAB_ICONS[route.name][focused ? 0 : 1] as any}
            color={color}
            size={size - 1}
          />
        ),
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Transactions" component={TransactionsScreen} />
      <Tabs.Screen name="Import" component={ImportsScreen} />
      <Tabs.Screen name="Trips" component={TripsScreen} />
      <Tabs.Screen name="Chat" component={ChatScreen} />
    </Tabs.Navigator>
  );
}
function Login() {
  const { signIn } = useApi();
  const { colors } = useTheme();
  const [register, setRegister] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 20, paddingTop: 48 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "center" }}>
          <Image source={require("./assets/icon.png")} style={{ width: 44, height: 44, borderRadius: 22 }} />
          <Txt style={{ fontFamily: "Montserrat_800ExtraBold", fontSize: 26, letterSpacing: 0.5 }}>FORTUNA</Txt>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line, padding: 20 }]}>
          <Txt style={styles.title}>{register ? "Create account" : "Sign in"}</Txt>
          <Form
            key={String(register)}
            initial={{
              server: process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000",
              baseCurrency: "SGD",
            }}
            submit={register ? "Create account" : "Sign in"}
            fields={[
              { key: "server", label: "Fortuna server domain or URL", required: true },
              ...(register
                ? [
                    { key: "name", label: "Name", required: true },
                    { key: "baseCurrency", label: "Base currency (ISO code)", type: "currency" as const, required: true },
                  ]
                : []),
              { key: "username", label: "Username", required: true },
              { key: "password", label: "Password", type: "password", required: true },
            ]}
            onSave={async (v) => {
              if (register) {
                const server = normalizeServer(v.server);
                const response = await fetch(`${server}/api/auth/register`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: v.name,
                    username: v.username,
                    password: v.password,
                    baseCurrency: v.baseCurrency,
                  }),
                });
                const body = await response.json();
                if (!response.ok) throw new Error(body.error || "Registration failed");
              }
              await signIn(v.server, v.username, v.password);
            }}
          />
          <Button
            title={register ? "Already have an account? Sign in" : "New here? Create an account"}
            ghost
            onPress={() => setRegister(!register)}
          />
        </View>
        <Txt muted size={12} style={{ textAlign: "center", paddingHorizontal: 12 }}>
          Enter the domain where you host Fortuna, such as fortuna.example.com.
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}
const SCREENS: Record<string, [React.ComponentType<any>, string]> = {
  Settings: [SettingsScreen, "Settings"],
  ChatConversation: [ChatConversationScreen, "Chat"],
  ChatApproval: [ChatApprovalScreen, "Approval"],
  ChatTransaction: [ChatTransactionScreen, "Transaction"],
  AIConnection: [AIConnectionScreen, "AI connection"],
  Analytics: [AnalyticsScreen, "Analytics"],
  Transaction: [TransactionScreen, "Transaction"],
  Split: [SplitScreen, "Split"],
  LinkPicker: [LinkPickerScreen, "Reimbursement links"],
  Draft: [DraftReviewScreen, "Review import"],
  ImportDetail: [ImportDetailScreen, "Statement"],
  Trip: [TripScreen, "Trip"],
  TripEditor: [TripEditorScreen, "Trip details"],
  TripEntries: [TripEntriesScreen, "Trip activity"],
  TripEntry: [TripEntryScreen, "Entry"],
  TripFundings: [FundingListScreen, "Funding"],
  Funding: [FundingScreen, "Funding"],
  FundingReview: [FundingReviewScreen, "Funding review"],
  Wallets: [WalletsScreen, "Wallets"],
  Wallet: [WalletScreen, "Wallet"],
  WalletAccounts: [WalletAccountsScreen, "Wallet accounts"],
  CarryOver: [CarryOverScreen, "Carry over"],
  People: [PeopleScreen, "People"],
  Settle: [SettleScreen, "Settle up"],
  ShareCost: [ShareCostScreen, "Share cost"],
  Members: [MembersScreen, "Members"],
  SharedOverview: [SharedOverviewScreen, "Shared trip"],
  TripImport: [TripImportScreen, "Import statement"],
  TripReimbursement: [TripReimbursementScreen, "Reimbursement"],
  BankPicker: [BankPickerScreen, "Bank transactions"],
  Profile: [ProfileScreen, "Profile"],
  Password: [PasswordScreen, "Password"],
  Preferences: [PreferencesScreen, "Preferences"],
  Manage: [ManageScreen, "Organize"],
  ManageEditor: [ManageEditorScreen, "Edit"],
  Patterns: [PatternsScreen, "Learned rules"],
  Tokens: [TokensScreen, "Tokens & sessions"],
};
function Navigation() {
  const { ready, session } = useApi();
  const { colors, isDark } = useTheme();
  if (!ready) return <ActivityIndicator style={{ flex: 1 }} />;
  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      {!session ? (
        <Login />
      ) : (
        <NavigationContainer
          theme={{
            ...(isDark ? DarkTheme : DefaultTheme),
            colors: {
              ...(isDark ? DarkTheme : DefaultTheme).colors,
              background: colors.bg,
              card: colors.bg,
              text: colors.text,
              primary: colors.purple,
              border: colors.line,
            },
          }}
        >
          <Stack.Navigator
            screenOptions={{
              headerBackButtonDisplayMode: "minimal",
              headerTitleStyle: { fontFamily: "DMSans_600SemiBold" },
              headerStyle: { backgroundColor: colors.card },
              headerShadowVisible: true,
              headerTintColor: colors.purple,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen
              name="Main"
              component={MainTabs}
              options={{ headerShown: false }}
            />
            {Object.entries(SCREENS).map(([name, [component, title]]) => (
              <Stack.Screen
                key={name}
                name={name}
                component={component}
                options={{ title }}
              />
            ))}
          </Stack.Navigator>
        </NavigationContainer>
      )}
    </>
  );
}
export default function App() {
  const [loaded, error] = useFonts({
    DMSans_400Regular,
    DMSans_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
    DMMono_400Regular,
  });
  if (!loaded && !error)
    return <ActivityIndicator style={{ flex: 1 }} color={BRAND} />;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ApiProvider>
          <Navigation />
        </ApiProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

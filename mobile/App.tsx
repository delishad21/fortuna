import React, { useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
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
import {
  Button,
  Card,
  Form,
  Heading,
  Screen,
  styles,
  ThemeProvider,
  Txt,
  useTheme,
} from "./src/ui";
import { HomeScreen, AnalyticsScreen } from "./src/home";
import {
  TransactionsScreen,
  TransactionScreen,
  SplitScreen,
  ReimbursementScreen,
} from "./src/transactions";
import {
  ImportManagementScreen,
  ImportProvider,
  ImportScreen,
  ImportReviewScreen,
  ImportRowScreen,
  ImportHistoryScreen,
  ImportDetailScreen,
  DraftsScreen,
  DraftScreen,
  DraftRowScreen,
} from "./src/imports";
import {
  TripsScreen,
  TripScreen,
  TripEditorScreen,
  WalletScreen,
  FundingScreen,
  TripEntriesScreen,
  TripEntryScreen,
  BankPickerScreen,
} from "./src/trips";
import {
  SettingsScreen,
  ProfileScreen,
  PasswordScreen,
  PreferencesScreen,
  ManageScreen,
  ManageEditorScreen,
  TokensScreen,
} from "./src/settings";
import { ImportAllocationScreen } from "./src/import-allocation";
const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
function BrandTitle() {
  return (
    <View style={{ flexDirection: "row", gap: 9, alignItems: "center" }}>
      <Image
        source={require("./assets/icon.png")}
        style={{ width: 30, height: 30, borderRadius: 15 }}
      />
      <Txt
        style={{ fontFamily: "Montserrat_800ExtraBold", letterSpacing: 1.2 }}
      >
        FORTUNA
      </Txt>
    </View>
  );
}
function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerTitle: () => <BrandTitle />,
        headerStyle: { backgroundColor: colors.card },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.line,
        },
        tabBarActiveTintColor: colors.purple,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: "DMSans_600SemiBold", fontSize: 11 },
        tabBarIcon: ({ color, size }) => (
          <Ionicons
            name={
              (
                {
                  Home: "grid-outline",
                  Transactions: "receipt-outline",
                  Import: "file-tray-full-outline",
                  Trips: "airplane-outline",
                  Settings: "settings-outline",
                } as any
              )[route.name]
            }
            color={color}
            size={size}
          />
        ),
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{ tabBarLabel: "Activity" }}
      />
      <Tabs.Screen
        name="Import"
        component={ImportManagementScreen}
        options={{ tabBarLabel: "Imports" }}
      />
      <Tabs.Screen name="Trips" component={TripsScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}
function Login() {
  const { signIn } = useApi();
  const { colors } = useTheme();
  const [register, setRegister] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Screen>
        <View style={{ paddingTop: 42, paddingBottom: 16, gap: 24 }}>
          <Image
            source={require("./assets/icon.png")}
            style={{ width: 82, height: 82, borderRadius: 24 }}
          />
          <Heading
            title={
              register ? "Your money, together." : "A little more clarity."
            }
            subtitle={
              register
                ? "Create your Fortuna account."
                : "Welcome to Fortuna. Make room for what matters."
            }
          />
        </View>
        <Card>
          <Form
            key={String(register)}
            initial={{
              server:
                process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000",
              baseCurrency: "SGD",
            }}
            submit={register ? "Create account" : "Sign in"}
            fields={[
              { key: "server", label: "Fortuna server domain or URL", required: true },
              ...(register
                ? [
                    { key: "name", label: "Name", required: true },
                    {
                      key: "baseCurrency",
                      label: "Base currency (ISO code)",
                      required: true,
                    },
                  ]
                : []),
              { key: "username", label: "Username", required: true },
              {
                key: "password",
                label: "Password",
                type: "password",
                required: true,
              },
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
                if (!response.ok)
                  throw new Error(body.error || "Registration failed");
              }
              await signIn(v.server, v.username, v.password);
            }}
          />
          <Button
            title={
              register
                ? "Already have an account? Sign in"
                : "New here? Create an account"
            }
            secondary
            onPress={() => setRegister(!register)}
          />
        </Card>
        <Txt muted size={12}>
          Enter the domain where you host Fortuna, such as fortuna.example.com.
          The app uses the same account and API as your web app.
        </Txt>
      </Screen>
    </SafeAreaView>
  );
}
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
        <ImportProvider>
          <NavigationContainer
            theme={{
              ...(isDark ? DarkTheme : DefaultTheme),
              colors: {
                ...(isDark ? DarkTheme : DefaultTheme).colors,
                background: colors.bg,
                card: colors.card,
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
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen
                name="Main"
                component={MainTabs}
                options={{ headerShown: false }}
              />
              {Object.entries({
                Analytics: AnalyticsScreen,
                Transaction: TransactionScreen,
                Split: SplitScreen,
                Reimbursement: ReimbursementScreen,
                StatementImport: ImportScreen,
                ImportReview: ImportReviewScreen,
                ImportAllocation: ImportAllocationScreen,
                ImportRow: ImportRowScreen,
                ImportHistory: ImportHistoryScreen,
                ImportDetail: ImportDetailScreen,
                Drafts: DraftsScreen,
                Draft: DraftScreen,
                DraftRow: DraftRowScreen,
                Trip: TripScreen,
                TripEditor: TripEditorScreen,
                Wallet: WalletScreen,
                Funding: FundingScreen,
                TripEntries: TripEntriesScreen,
                TripEntry: TripEntryScreen,
                BankPicker: BankPickerScreen,
                Profile: ProfileScreen,
                Password: PasswordScreen,
                Preferences: PreferencesScreen,
                Manage: ManageScreen,
                ManageEditor: ManageEditorScreen,
                Tokens: TokensScreen,
              }).map(([name, component]) => (
                <Stack.Screen
                  key={name}
                  name={name}
                  component={component}
                  options={{ title: "Fortuna" }}
                />
              ))}
            </Stack.Navigator>
          </NavigationContainer>
        </ImportProvider>
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
    return <ActivityIndicator style={{ flex: 1 }} color="#5750F1" />;
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

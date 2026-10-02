import React, { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { Button, Card, Input, Screen, Txt } from "../ui";
import { useChatApi, Connection, DeviceLogin } from "./api";
import { MemoryCard } from "./MemoryCard";
export function AIConnectionScreen() {
  const api = useChatApi(),
    [connections, setConnections] = useState<Connection[]>([]),
    [key, setKey] = useState(""),
    [login, setLogin] = useState<DeviceLogin | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const refresh = () => api<Connection[]>("/settings").then(setConnections);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [api]);
  useEffect(() => {
    if (!login || login.status !== "pending") return;
    const timer = setInterval(
      () =>
        void api<DeviceLogin>(`/connections/codex/login/${login.loginId}`)
          .then((v) => {
            setLogin(v);
            if (v.status === "connected") void refresh();
          })
          .catch((e) => setMessage(e.message)),
      3000,
    );
    return () => clearInterval(timer);
  }, [api, login?.loginId, login?.status]);
  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Txt bold size={26}>
        AI connection
      </Txt>
      <Txt muted>
        Connect a provider for your Fortuna account. Messages and statement
        content go to the selected provider. Switching applies to future
        messages and keeps your conversation history.
      </Txt>
      {!!message && <Txt accessibilityRole="alert">{message}</Txt>}
      {(["codex", "openrouter"] as const).map((provider) => {
        const connection = connections.find((c) => c.provider === provider);
        return (
          <Card key={provider}>
            <Txt bold size={20}>
              {provider === "codex" ? "Codex" : "OpenRouter"}
            </Txt>
            <Txt muted>
              {provider === "codex"
                ? "GPT-6 Luna · Max reasoning"
                : "GPT-6 Luna Pro"}
            </Txt>
            <Txt>
              {connection?.selected ? "Selected · " : ""}
              {connection?.status || "Not connected"}
            </Txt>
            {provider === "openrouter" && (
              <>
                <Txt>
                  API key
                  {connection?.keyHint
                    ? ` · ends in ${connection.keyHint}`
                    : ""}
                </Txt>
                <Input
                  value={key}
                  onChangeText={setKey}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="OpenRouter API key"
                  placeholder="Enter your API key"
                />
              </>
            )}
            <Button
              title={
                provider === "codex" ? "Sign in with Codex" : "Save API key"
              }
              disabled={busy || (provider === "openrouter" && !key.trim())}
              onPress={() =>
                void act(async () => {
                  if (provider === "codex")
                    setLogin(
                      await api("/connections/codex/start", {
                        method: "POST",
                        body: {},
                      }),
                    );
                  else {
                    await api("/settings", {
                      method: "PUT",
                      body: { provider, key },
                    });
                    setKey("");
                    setMessage("Key saved. Test your connection to continue.");
                  }
                })
              }
            />
            {connection && (
              <>
                <Button
                  title="Test connection"
                  secondary
                  disabled={busy}
                  onPress={() =>
                    void act(async () => {
                      const result = await api(
                        `/connections/${provider}/test`,
                        { method: "POST", body: {} },
                      );
                      setMessage(
                        result.connected && result.modelAvailable
                          ? "Connection ready."
                          : result.error ||
                              "The requested model is unavailable. Check provider access.",
                      );
                    })
                  }
                />
                {!connection.selected && (
                  <Button
                    title={`Use ${provider === "codex" ? "Codex" : "OpenRouter"}`}
                    secondary
                    disabled={busy}
                    onPress={() =>
                      void act(() =>
                        api("/settings", { method: "PUT", body: { provider } }),
                      )
                    }
                  />
                )}
                <Button
                  title="Disconnect"
                  danger
                  secondary
                  disabled={busy}
                  onPress={() =>
                    void act(async () => {
                      await api(`/connections/${provider}/disconnect`, {
                        method: "POST",
                        body: {},
                      });
                      if (provider === "codex") setLogin(null);
                      setMessage(
                        "Disconnected. Active work stopped; saved data is preserved.",
                      );
                    })
                  }
                />
              </>
            )}
            {provider === "codex" && login && (
              <View style={{ gap: 12 }}>
                <Txt>Enter this code on the Codex sign-in page:</Txt>
                <Txt selectable bold size={24}>
                  {login.userCode}
                </Txt>
                <Button
                  title="Open Codex sign-in"
                  secondary
                  onPress={() => void Linking.openURL(login.verificationUrl)}
                />
                <Txt muted>
                  {login.status} · expires{" "}
                  {new Date(login.expiresAt).toLocaleTimeString()}
                </Txt>
              </View>
            )}
          </Card>
        );
      })}
      <MemoryCard />
    </Screen>
  );
}

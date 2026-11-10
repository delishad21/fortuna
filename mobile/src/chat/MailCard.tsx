import React, { useEffect, useState } from "react";
import { Linking } from "react-native";
import { Button, Card, Input, Txt } from "../ui";
import { useChatApi, MailConnection } from "./api";

/** Gmail for PayLah alerts, read-only. The app password is never shown again. */
export function MailCard() {
  const api = useChatApi();
  const [mail, setMail] = useState<MailConnection | null>(null),
    [address, setAddress] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const refresh = () =>
    api<MailConnection>("/mail").then((value) => {
      setMail(value);
      if (value.address) setAddress(value.address);
    });
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [api]);
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
    <Card>
      <Txt bold size={20} accessibilityRole="header">
        Gmail for PayLah emails
      </Txt>
      <Txt muted>
        The chat reads PayLah alerts to name PayLah rows in a staged DBS
        import. It only reads, and sees only the parsed payment details.
      </Txt>
      <Txt>{mail?.connected ? `Connected · ${mail.address}` : "Not connected"}</Txt>
      {!!message && <Txt accessibilityRole="alert">{message}</Txt>}
      <Txt>Gmail address</Txt>
      <Input
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        accessibilityLabel="Gmail address"
        placeholder="you@gmail.com"
      />
      <Txt>App password{mail?.connected ? " · saved; enter a new one to replace it" : ""}</Txt>
      <Input
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Google app password"
        placeholder="16-letter app password"
      />
      <Txt muted>
        Google doesn’t list app passwords in its menus; open the page directly
        (2-Step Verification must be on).
      </Txt>
      <Button
        title="Create an app password"
        secondary
        onPress={() => void Linking.openURL("https://myaccount.google.com/apppasswords")}
      />
      <Button
        title={busy ? "Checking…" : "Save and test"}
        disabled={busy || !address.trim() || !password.trim()}
        onPress={() =>
          void act(async () => {
            await api("/mail", { method: "PUT", body: { address, password } });
            setPassword("");
            setMessage("Gmail connected. The test sign-in worked.");
          })
        }
      />
      {mail?.connected && (
        <Button
          title="Disconnect"
          danger
          secondary
          disabled={busy}
          onPress={() =>
            void act(async () => {
              await api("/mail", { method: "DELETE" });
              setAddress("");
              setMessage("Gmail disconnected. The saved app password was deleted.");
            })
          }
        />
      )}
    </Card>
  );
}

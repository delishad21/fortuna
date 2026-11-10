"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { chatApi, MailConnection } from "@/lib/chat/client";

/** Gmail for PayLah alerts: the chat reads them read-only to name PayLah rows in a draft. */
export function MailConnectionPanel() {
  const [mail, setMail] = useState<MailConnection | null>(null),
    [address, setAddress] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const refresh = () =>
    chatApi<MailConnection>("/mail").then((value) => {
      setMail(value);
      if (value.address) setAddress(value.address);
    });
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, []);
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
    <section
      aria-labelledby="mail-heading"
      className="mt-6 space-y-4 rounded-xl border border-stroke bg-white p-5 dark:border-stroke-dark dark:bg-gray-dark"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <h3
            id="mail-heading"
            className="font-semibold text-dark dark:text-white"
          >
            Gmail for PayLah emails
          </h3>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            The chat reads PayLah alerts from paylah.alert@dbs.com to name
            PayLah rows in a staged DBS import. It only reads: it never marks,
            moves, deletes or sends mail, and it sees only the parsed payment
            details.
          </p>
        </div>
        <span className="text-sm">
          {mail?.connected ? `Connected · ${mail.address}` : "Not connected"}
        </span>
      </div>
      {message && (
        <p
          role="status"
          className="rounded-lg border border-stroke p-3 dark:border-stroke-dark"
        >
          {message}
        </p>
      )}
      <label className="block text-sm">
        Gmail address
        <input
          type="email"
          autoComplete="email"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="you@gmail.com"
          className="mt-2 w-full rounded-lg border border-stroke bg-transparent p-3 dark:border-stroke-dark"
        />
      </label>
      <label className="block text-sm">
        App password{" "}
        {mail?.connected && <span>· saved; enter a new one to replace it</span>}
        <input
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="16-letter Google app password"
          className="mt-2 w-full rounded-lg border border-stroke bg-transparent p-3 dark:border-stroke-dark"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !address.trim() || !password.trim()}
          onClick={() =>
            void act(async () => {
              await chatApi("/mail", {
                method: "PUT",
                body: { address, password },
              });
              setPassword("");
              setMessage("Gmail connected. The test sign-in worked.");
            })
          }
        >
          {busy ? "Checking…" : "Save and test"}
        </Button>
        {mail?.connected && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await chatApi("/mail", { method: "DELETE" });
                setAddress("");
                setMessage("Gmail disconnected. The saved app password was deleted.");
              })
            }
          >
            Disconnect
          </Button>
        )}
      </div>
    </section>
  );
}

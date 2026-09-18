import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useFocusEffect } from "@react-navigation/native";

export type Session = { token: string; server: string; expiresAt: string };
export type RecordData = Record<string, any>;
const KEY = "fortuna.mobile.session";
const storage = {
  get: () =>
    Platform.OS === "web"
      ? Promise.resolve(sessionStorage.getItem(KEY))
      : SecureStore.getItemAsync(KEY),
  set: (value: string) =>
    Platform.OS === "web"
      ? Promise.resolve(sessionStorage.setItem(KEY, value))
      : SecureStore.setItemAsync(KEY, value),
  remove: () =>
    Platform.OS === "web"
      ? Promise.resolve(sessionStorage.removeItem(KEY))
      : SecureStore.deleteItemAsync(KEY),
};
export function normalizeServer(value: string) {
  const entered = value.trim();
  const url = new URL(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(entered) ? entered : `https://${entered}`,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Enter a valid server URL");
  const local =
    /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      url.hostname,
    );
  if (url.protocol !== "https:" && !(__DEV__ && local))
    throw new Error("Use HTTPS for your Fortuna server");
  return url.toString().replace(/\/$/, "");
}
async function request(server: string, path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    path === "/parse" ? 120000 : 30000,
  );
  try {
    const response = await fetch(`${server}/api/mobile${path}`, {
      ...init,
      signal: controller.signal,
    });
    const body = await response
      .json()
      .catch(() => ({ error: "The server returned an unreadable response" }));
    if (!response.ok)
      throw Object.assign(new Error(body.error || "Request failed"), {
        status: response.status,
      });
    return body;
  } catch (error: any) {
    if (error.name === "AbortError")
      throw new Error(
        "The request timed out. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
type ApiContextType = {
  ready: boolean;
  session: Session | null;
  signIn: (server: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  call: <T = any>(operation: string, ...args: any[]) => Promise<T>;
  parse: (form: FormData) => Promise<any>;
};
const Context = createContext<ApiContextType>(null!);
export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    storage
      .get()
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw);
          if (new Date(saved.expiresAt).getTime() > Date.now())
            setSession(saved);
          else void storage.remove();
        }
      })
      .catch(() => storage.remove())
      .finally(() => setReady(true));
  }, []);
  const clear = async () => {
    await storage.remove();
    setSession(null);
  };
  const authenticated = useCallback(
    async (path: string, init: RequestInit) => {
      if (!session) throw new Error("Please sign in");
      try {
        return await request(session.server, path, {
          ...init,
          headers: {
            ...init.headers,
            Authorization: `Bearer ${session.token}`,
          },
        });
      } catch (error: any) {
        if (error.status === 401) await clear();
        throw error;
      }
    },
    [session],
  );
  const call = useCallback(
    async <T,>(operation: string, ...args: any[]): Promise<T> =>
      (
        await authenticated("/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation, args }),
        })
      ).data,
    [authenticated],
  );
  return (
    <Context.Provider
      value={{
        ready,
        session,
        call,
        parse: async (form) =>
          (await authenticated("/parse", { method: "POST", body: form })).data,
        signIn: async (server, username, password) => {
          server = normalizeServer(server);
          const data = await request(server, "/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
          const next = { server, token: data.token, expiresAt: data.expiresAt };
          await storage.set(JSON.stringify(next));
          setSession(next);
        },
        signOut: async () => {
          await authenticated("/session", { method: "DELETE" });
          await clear();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useApi = () => useContext(Context);
export function useResource<T = any>(operation: string, ...args: any[]) {
  const { call } = useApi();
  const key = JSON.stringify(args);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await call<T>(operation, ...JSON.parse(key));
      if (current === sequence.current) setData(result);
    } catch (err: any) {
      if (current === sequence.current) setError(err.message);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [operation, key, call]);
  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        sequence.current++;
      };
    }, [reload]),
  );
  return { data, loading, error, reload, setData };
}

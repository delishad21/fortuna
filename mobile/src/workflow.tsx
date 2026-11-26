import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useApi } from "./api";
import { isWorkflowMode, TAB_ORDER, type WorkflowMode } from "../../frontend/shared/workflow";

/**
 * How the user mainly works (Settings → Preferences). It only changes what
 * comes first (tab order, the Home tab the dashboard opens on, first-run
 * prompts); nothing is hidden. The last known mode is kept on the device so
 * the tabs don't jump on launch.
 */
const KEY = "fortuna.mobile.workflow";
const storage = {
  get: () =>
    Platform.OS === "web" ? Promise.resolve(localStorage.getItem(KEY)) : SecureStore.getItemAsync(KEY),
  set: (value: string) =>
    Platform.OS === "web" ? Promise.resolve(localStorage.setItem(KEY, value)) : SecureStore.setItemAsync(KEY, value),
};

type WorkflowContextType = {
  mode: WorkflowMode;
  /** False until the user picks one; the mode is then derived from assistant entries. */
  chosen: boolean;
  loaded: boolean;
  tabOrder: string[];
  choose: (mode: WorkflowMode) => Promise<void>;
  reload: () => Promise<void>;
};
const Context = createContext<WorkflowContextType>(null!);

export function WorkflowProvider({ children }: { children: React.ReactNode }) {
  const { call, session } = useApi();
  const [mode, setMode] = useState<WorkflowMode>("statements");
  const [chosen, setChosen] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const apply = (next: { mode: WorkflowMode; chosen: boolean }) => {
    setMode(next.mode);
    setChosen(next.chosen);
    void storage.set(next.mode).catch(() => {});
  };
  const reload = useCallback(async () => {
    if (!session) return;
    try {
      apply(await call<{ mode: WorkflowMode; chosen: boolean }>("getWorkflowPreference"));
    } catch {
      // Keep the cached mode; it only changes emphasis.
    } finally {
      setLoaded(true);
    }
  }, [call, session]);
  useEffect(() => {
    void storage
      .get()
      .then((saved) => {
        if (isWorkflowMode(saved)) setMode(saved);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const choose = useCallback(
    async (next: WorkflowMode) => {
      apply(await call<{ mode: WorkflowMode; chosen: boolean }>("setWorkflowMode", next));
    },
    [call],
  );
  return (
    <Context.Provider value={{ mode, chosen, loaded, tabOrder: TAB_ORDER[mode], choose, reload }}>
      {children}
    </Context.Provider>
  );
}

export const useWorkflow = () => useContext(Context);

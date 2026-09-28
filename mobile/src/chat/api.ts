import { useMemo } from "react";
import { useApi } from "../api";
import { createChatRequest } from "../../../frontend/shared/chat";
export * from "../../../frontend/shared/chat";
export function useChatApi() {
  const { session, signOut } = useApi();
  return useMemo(
    () =>
      createChatRequest(
        session?.server || "",
        session?.token,
        () => void signOut(),
      ),
    [session?.server, session?.token, signOut],
  );
}

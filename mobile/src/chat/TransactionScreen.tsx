import React, { useEffect, useState } from "react";
import { useChatApi } from "./api";
import { Screen, Txt } from "../ui";
import { TransactionScreen } from "../transactions";
export function ChatTransactionScreen({ route, navigation }: any) {
  const api = useChatApi(),
    [item, setItem] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api(`/transactions/${route.params.id}`)
      .then((v) => {
        if (active) setItem(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api, route.params.id]);
  return item ? (
    <TransactionScreen navigation={navigation} route={{ params: { item } }} />
  ) : (
    <Screen>
      <Txt accessibilityRole={error ? "alert" : undefined}>
        {error || "Loading transaction…"}
      </Txt>
    </Screen>
  );
}

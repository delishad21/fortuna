import React, { useEffect, useState } from "react";
import { Image, Platform } from "react-native";
import { Txt, useTheme } from "../ui";
import { useApi } from "../api";
import { attachmentContentPath } from "./api";

/** A sent image, loaded with the session token from the owner-scoped chat endpoint. */
export function AttachedImage({
  id,
  filename,
}: {
  id: string;
  filename: string;
}) {
  const { session } = useApi();
  const { colors } = useTheme();
  const [uri, setUri] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  const url = `${session?.server || ""}${attachmentContentPath(id)}`;
  useEffect(() => {
    if (Platform.OS !== "web") return setUri(url);
    // Web <img> cannot send an Authorization header; fetch into a blob URL instead.
    let objectUrl = "";
    let cancelled = false;
    fetch(url, { headers: { Authorization: `Bearer ${session?.token}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error())))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUri(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, session?.token]);
  if (failed)
    return (
      <Txt muted size={12}>
        Image: {filename} (expired)
      </Txt>
    );
  if (!uri) return null;
  return (
    <Image
      accessibilityLabel={filename}
      source={
        Platform.OS === "web"
          ? { uri }
          : { uri, headers: { Authorization: `Bearer ${session?.token}` } }
      }
      onError={() => setFailed(true)}
      resizeMode="contain"
      style={{
        width: "100%",
        height: 240,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    />
  );
}

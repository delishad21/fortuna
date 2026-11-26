import React, { useState } from "react";
import { Image, Platform, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useApi } from "./api";
import { IconBubble, useTheme } from "./ui";
import { categoryIonicon } from "../../frontend/shared/categoryIcons";

const TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/** Image source for a server path such as /api/images/…, with the session's token. */
export function useImageSource() {
  const { session } = useApi();
  return (path?: string | null) =>
    path && session
      ? { uri: `${session.server}${path}`, headers: { Authorization: `Bearer ${session.token}` } }
      : null;
}

/**
 * Pick a photo and return it as base64 for the set*Image operations, or null
 * when cancelled. `square` crops it, for account and card pictures.
 */
export async function pickImage({ square = false } = {}) {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: square,
    aspect: square ? [1, 1] : undefined,
    quality: 0.7,
    base64: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const mime = asset.mimeType?.toLowerCase();
  if (mime && !TYPES.includes(mime)) throw new Error("Use a PNG, JPEG, GIF or WebP image");
  const base64 = asset.base64 || (Platform.OS === "web" && asset.uri.startsWith("data:") ? asset.uri : null);
  if (!base64) throw new Error("Couldn’t read that photo");
  if (base64.length * 0.75 > MAX_BYTES) throw new Error("Choose an image under 5 MB");
  return base64;
}

/** A server image, or `fallback` when there is none or it fails to load. */
export function RemoteImage({
  path,
  size = 40,
  fallback,
}: {
  path?: string | null;
  size?: number;
  fallback: React.ReactNode;
}) {
  const source = useImageSource()(path);
  const [failed, setFailed] = useState<string | null>(null);
  const { colors } = useTheme();
  if (!source || failed === path) return <>{fallback}</>;
  return (
    <View style={{ width: size, height: size, borderRadius: 8, overflow: "hidden", backgroundColor: colors.sunken }}>
      <Image
        source={source}
        style={{ width: size, height: size }}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        onError={() => setFailed(path ?? null)}
      />
    </View>
  );
}

/** A saved transaction's image, else its category's icon in the category's colour. */
export function TransactionThumb({ item, size = 36 }: { item: any; size?: number }) {
  const { colors } = useTheme();
  const category = item.category || { name: "Uncategorized" };
  return (
    <RemoteImage
      path={item.imageId ? `/api/images/${item.imageId}` : null}
      size={size}
      fallback={<IconBubble icon={categoryIonicon(category)} color={item.category?.color || colors.faint} size={size} />}
    />
  );
}

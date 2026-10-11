import { Platform } from "react-native";
import { File } from "expo-file-system";

type PickedFile = { uri: string; name: string; mimeType?: string | null; file?: Blob };

/**
 * Add a picked file to FormData. Expo's fetch can't send React Native's
 * { uri, name, type } parts; it reads any part that has `bytes()`, keeping the
 * original filename and type in the part headers.
 */
export async function appendFile(form: FormData, key: string, picked: PickedFile) {
  if (Platform.OS === "web") {
    const blob: Blob = picked.file ?? (await fetch(picked.uri).then((r) => r.blob()));
    form.append(key, blob, picked.name);
    return;
  }
  const source = new File(picked.uri);
  form.append(key, {
    name: picked.name,
    type: picked.mimeType || "application/octet-stream",
    bytes: () => source.bytes(),
  } as any);
}

import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { notice } from "./ui";
export async function shareCsv(name: string, csv: string) {
  try {
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const file = new File(Paths.cache, name);
    file.write(csv);
    try {
      await Sharing.shareAsync(file.uri, {
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
    } finally {
      file.delete();
    }
  } catch (error) {
    notice(error);
  }
}
/** Downloads a file the session may read and opens the share sheet (a download on web). */
export async function shareDownload(
  url: string,
  token: string | undefined,
  name: string,
  mimeType: string,
) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    if (Platform.OS === "web") {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error("The file could not be downloaded");
      const href = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.click();
      URL.revokeObjectURL(href);
      return;
    }
    const file = await File.downloadFileAsync(url, new File(Paths.cache, name), {
      headers,
      idempotent: true,
    });
    try {
      await Sharing.shareAsync(file.uri, { mimeType });
    } finally {
      file.delete();
    }
  } catch (error) {
    notice(error);
  }
}

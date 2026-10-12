import { Capacitor } from "@capacitor/core";
export const isNativeCardShare = () => Capacitor.isNativePlatform();
/** Cache-scoped file sharing needs no broad device storage permission. */
export async function nativeSharePng(
  file: File,
  title: string,
  link: string,
): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.onerror = () =>
      reject(new Error("Could not read the rendered PNG."));
    reader.readAsDataURL(file);
  });
  const { uri } = await Filesystem.writeFile({
    path: `cards/${Date.now()}-${file.name}`,
    data,
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({
    title,
    text: `Your portfolio as one picture.${link ? ` Remix this mix: ${link}` : ""}`,
    files: [uri],
    dialogTitle: "Save or share your portfolio PNG",
  });
}

export function nativeRemixOrigin(): string | null {
  try {
    const url = new URL(import.meta.env.VITE_COLOYOND_PUBLIC_URL ?? "");
    return url.protocol === "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

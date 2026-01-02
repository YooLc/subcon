import { fetchJson } from "@/components/studio/api";
import type { FileContentResponse } from "@/components/studio/types";

export function languageForFile(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "yaml";
  }
  if (lower.endsWith(".toml") || lower.endsWith(".cfg")) {
    return "toml";
  }
  return "plaintext";
}

export async function isFileNonEmpty(url: string): Promise<boolean> {
  let existingContent: string | null = null;
  try {
    const existing = await fetchJson<FileContentResponse>(url);
    existingContent = existing.content;
  } catch (err) {
    const statusCode =
      typeof err === "object" && err && "status" in err
        ? (err as { status?: number }).status
        : undefined;
    if (statusCode !== 404) {
      throw err;
    }
  }
  return Boolean(existingContent && existingContent.trim().length > 0);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "expired";
  }
  const units: Array<[string, number]> = [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ];
  const parts: string[] = [];
  let remaining = Math.floor(seconds);
  for (const [label, size] of units) {
    if (remaining >= size) {
      const value = Math.floor(remaining / size);
      remaining -= value * size;
      parts.push(`${value}${label}`);
      if (parts.length >= 2) {
        break;
      }
    }
  }
  return parts.length > 0 ? parts.join(" ") : "0s";
}

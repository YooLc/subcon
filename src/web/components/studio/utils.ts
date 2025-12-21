export function languageForFile(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "yaml";
  }
  return "plaintext";
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

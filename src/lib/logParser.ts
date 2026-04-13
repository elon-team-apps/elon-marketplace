/**
 * Robust parsing for bulk log upload / create product.
 * Supports email:pass:recovery (recovery may contain ':') and email|pass|recovery (recovery may contain '|').
 * Sanitizes hidden whitespace, BOM/zero-width chars, and emoji before RPC / DB.
 */

export type ParsedLogEntry = {
  email: string;
  password: string;
  recovery: string;
};

const ZW_RE = /[\u200B-\u200D\u2060\uFEFF\u200E\u200F]/g;
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const VS16_RE = /\uFE0F/g;

/** Unicode emoji / pictographic (ES2022+); safe fallback if engine lacks property escapes. */
let emojiStripRe: RegExp | null = null;
try {
  emojiStripRe = new RegExp("\\p{Extended_Pictographic}", "gu");
} catch {
  emojiStripRe = null;
}

export function sanitizeLogSegment(input: string): string {
  let s = input.normalize("NFKC");
  s = s.replace(ZW_RE, "");
  s = s.replace(VS16_RE, "");
  s = s.replace(CTRL_RE, "");
  if (emojiStripRe) {
    s = s.replace(emojiStripRe, "");
  } else {
    s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  }
  return s.replace(/\s+/g, " ").trim();
}

export function parseLogLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(ZW_RE, "")
        .replace(VS16_RE, "")
        .replace(CTRL_RE, " ")
        .trim(),
    )
    .filter((l) => l.length > 0);
}

/**
 * Split one line into email / password / recovery using '|' if present, else ':' (recovery keeps inner separators).
 */
export function parseCredentialLine(line: string): ParsedLogEntry | null {
  const cleaned = sanitizeLogSegment(line);
  if (!cleaned) return null;

  const usePipe = cleaned.includes("|");
  const sep = usePipe ? "|" : ":";
  const parts = usePipe ? cleaned.split("|") : cleaned.split(":");

  if (parts.length < 2) return null;

  const email = sanitizeLogSegment(parts[0] ?? "");
  const password = sanitizeLogSegment(parts[1] ?? "");
  if (!email || !password) return null;

  let recoveryRaw: string;
  if (parts.length >= 3) {
    recoveryRaw = usePipe ? parts.slice(2).join("|") : parts.slice(2).join(":");
  } else {
    recoveryRaw = "";
  }
  const recovery = sanitizeLogSegment(recoveryRaw) || "-";

  return { email, password, recovery };
}

export function parsePastedLogs(raw: string): { entries: ParsedLogEntry[]; skipped: number } {
  const entries: ParsedLogEntry[] = [];
  let skipped = 0;
  for (const line of parseLogLines(raw)) {
    const row = parseCredentialLine(line);
    if (!row) {
      skipped += 1;
      continue;
    }
    entries.push(row);
  }
  return { entries, skipped };
}

export type PasteValidation =
  | { ok: true; entries: ParsedLogEntry[]; skipped: number }
  | { ok: false; message: string };

export function validatePastedLogs(raw: string): PasteValidation {
  const { entries, skipped } = parsePastedLogs(raw);
  const rawLines = parseLogLines(raw);
  if (rawLines.length > 0 && entries.length === 0) {
    return {
      ok: false,
      message:
        "No valid lines found. Use email:password:recovery or email|password|recovery (password and email required; recovery optional).",
    };
  }
  return { ok: true, entries, skipped };
}

export function countParsedLogEntries(raw: string): number {
  return parsePastedLogs(raw).entries.length;
}

/**
 * Robust parsing for bulk log upload / create product.
 * Supports email:pass:recovery (recovery may contain ':') and email|pass|recovery (recovery may contain '|').
 * Sanitizes hidden whitespace, BOM/zero-width chars, and emoji before RPC / DB.
 */

export type ParsedLogEntry = {
  email: string;
  password: string;
  recovery: string;
  extra?: string;
};

const ZW_RE = /[\u200B-\u200D\u2060\uFEFF\u200E\u200F]/g;
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
  s = Array.from(s)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return !(
        code <= 0x08 ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      );
    })
    .join("");
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
        .replace(/[\n\r\t]/g, " ")
        .trim(),
    )
    .filter((l) => l.length > 0);
}

export function parseCredentialLine(line: string): ParsedLogEntry | null {
  const cleaned = sanitizeLogSegment(line);
  if (!cleaned) return null;

  // Smart split for both ":" and "|" formats in one parser.
  const rawParts = cleaned.split(/[|:]/g);
  const parts = rawParts.map((p) => sanitizeLogSegment(p));

  if (parts.length < 2 || parts.length > 4) return null;

  const email = sanitizeLogSegment(parts[0] ?? "");
  const password = sanitizeLogSegment(parts[1] ?? "");
  if (!email || !password) return null;

  const recovery = sanitizeLogSegment(parts[2] ?? "");
  const extra = sanitizeLogSegment(parts[3] ?? "");

  if (parts.length === 2) {
    return { email, password, recovery: "" };
  }
  if (parts.length === 3) {
    return { email, password, recovery };
  }
  return { email, password, recovery, extra };
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
        "No valid lines found. Use 2, 3, or 4 segments separated by ':' or '|': email:password[:recovery[:extra]].",
    };
  }
  return { ok: true, entries, skipped };
}

export function countParsedLogEntries(raw: string): number {
  return parsePastedLogs(raw).entries.length;
}

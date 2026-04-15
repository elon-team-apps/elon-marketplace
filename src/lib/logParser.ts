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

type ParsedLabelParts = {
  email: string;
  password: string;
  recovery: string;
  extra: string;
  usedLabels: boolean;
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
  const parts = rawParts.map((p) => sanitizeLogSegment(p)).filter(Boolean);

  if (parts.length < 2 || parts.length > 4) return null;

  const parsedLabels = parseLabeledSegments(parts);
  const positional = parsePositionalSegments(parts);

  const email = sanitizeLogSegment(parsedLabels.email || positional.email);
  const password = sanitizeLogSegment(parsedLabels.password || positional.password);
  if (!email || !password) return null;

  const recovery = sanitizeLogSegment(parsedLabels.recovery || positional.recovery);
  const extra = sanitizeLogSegment(parsedLabels.extra || positional.extra);

  const effectiveCount = [email, password, recovery, extra].filter(Boolean).length;
  if (effectiveCount <= 2) {
    return { email, password, recovery: "" };
  }
  if (!extra) {
    return { email, password, recovery };
  }
  return { email, password, recovery, extra };
}

function normalizeLabelKey(value: string): string {
  const v = sanitizeLogSegment(value).toLowerCase().replace(/\s+/g, "");
  if (v === "email" || v === "e-mail") return "email";
  if (v === "password" || v === "pass" || v === "passwd") return "password";
  if (v === "recovery" || v === "recoveryemail" || v === "backup" || v === "backupemail") return "recovery";
  if (v === "extra" || v === "note") return "extra";
  return "";
}

function stripInlineLabel(value: string): string {
  return sanitizeLogSegment(
    value.replace(/^(email|e-mail|password|pass|passwd|recovery|recovery email|backup|backup email|extra|note)\s*[-=]?\s*/i, ""),
  );
}

function parsePositionalSegments(parts: string[]): ParsedLabelParts {
  return {
    email: stripInlineLabel(parts[0] ?? ""),
    password: stripInlineLabel(parts[1] ?? ""),
    recovery: stripInlineLabel(parts[2] ?? ""),
    extra: stripInlineLabel(parts[3] ?? ""),
    usedLabels: false,
  };
}

function parseLabeledSegments(parts: string[]): ParsedLabelParts {
  const out: ParsedLabelParts = {
    email: "",
    password: "",
    recovery: "",
    extra: "",
    usedLabels: false,
  };
  const unlabeled: string[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const token = parts[i] ?? "";
    const label = normalizeLabelKey(token);
    if (label && i + 1 < parts.length) {
      out.usedLabels = true;
      const nextVal = stripInlineLabel(parts[i + 1] ?? "");
      if (label === "email" && !out.email) out.email = nextVal;
      else if (label === "password" && !out.password) out.password = nextVal;
      else if (label === "recovery" && !out.recovery) out.recovery = nextVal;
      else if (label === "extra" && !out.extra) out.extra = nextVal;
      i += 1;
      continue;
    }
    unlabeled.push(stripInlineLabel(token));
  }

  if (out.usedLabels) {
    if (!out.email && unlabeled.length > 0) out.email = unlabeled.shift() ?? "";
    if (!out.password && unlabeled.length > 0) out.password = unlabeled.shift() ?? "";
    if (!out.recovery && unlabeled.length > 0) out.recovery = unlabeled.shift() ?? "";
    if (!out.extra && unlabeled.length > 0) out.extra = unlabeled.shift() ?? "";
  }

  return out;
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

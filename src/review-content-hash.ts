import { createHash } from "node:crypto";

export interface ReviewContentStep {
  diff: string;
  filePath: string;
}

export function computeCanonicalDiffHash(step: ReviewContentStep): string {
  const records = extractCanonicalRecords(step.diff);
  const hash = createHash("sha256");
  hash.update(`filePath:${step.filePath}\n`);

  if (records.length > 0) {
    for (const record of records) {
      hash.update(`${record}\n`);
    }
  } else {
    // Non-unified diff fallback: normalize line breaks and strip only terminal newlines to preserve meaningful whitespace
    const normalizedRaw = step.diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
    if (normalizedRaw.length > 0) {
      hash.update(`raw:${normalizedRaw}\n`);
    }
  }

  return hash.digest("hex");
}

function extractCanonicalRecords(diff: string): string[] {
  const normalized = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const records: string[] = [];

  let inHeader = true;
  let inBinaryPatch = false;
  let pendingIndex: string | null = null;

  for (const line of lines) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("diff --cc ") ||
      line.startsWith("diff --combined ")
    ) {
      inHeader = true;
      inBinaryPatch = false;
      pendingIndex = null;
      records.push(line);
      continue;
    }

    if (line.startsWith("index ")) {
      pendingIndex = line;
      continue;
    }

    if (line.startsWith("Binary files ")) {
      if (pendingIndex !== null) {
        records.push(pendingIndex);
        pendingIndex = null;
      }
      records.push(line);
      continue;
    }

    if (
      line.startsWith("old mode ") ||
      line.startsWith("new mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("copy from ") ||
      line.startsWith("copy to ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("dissimilarity index ")
    ) {
      records.push(line);
      continue;
    }

    if (line.startsWith("GIT binary patch")) {
      inBinaryPatch = true;
      inHeader = false;
      pendingIndex = null;
      records.push(line);
      continue;
    }

    if (inBinaryPatch) {
      if (line.trim() !== "") {
        records.push(line);
      }
      continue;
    }

    if (line.startsWith("@@")) {
      inHeader = false;
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ") || line === "---" || line === "+++") {
      if (inHeader) {
        if (line.startsWith("+++ ") || line === "+++") {
          inHeader = false;
        }
        continue;
      }
      if (line.startsWith("+") || line.startsWith("-")) {
        records.push(line);
        continue;
      }
    }

    if (line.startsWith("\\")) {
      inHeader = false;
      records.push(line);
      continue;
    }

    if (line.startsWith("+")) {
      inHeader = false;
      records.push(line);
      continue;
    }

    if (line.startsWith("-")) {
      inHeader = false;
      records.push(line);
      continue;
    }

    if (line.startsWith(" ")) {
      inHeader = false;
      continue;
    }
  }

  return records;
}

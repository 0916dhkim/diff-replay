import type {
  AtomicStep,
  DirectoryBranch,
  FileChurnMetric,
  LayoutResult,
  ParsedFile,
  Rect,
  TreemapItem,
  TreeNode,
} from "./types.js";

export function extractStepDelta(
  diff: string,
  lineCount?: number,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let hasDeltaLines = false;
  const lines = diff.split(/\r?\n/);

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("@@") || line.startsWith("Index:") || line.startsWith("diff ")) continue;

    if (line.startsWith("+")) {
      additions++;
      hasDeltaLines = true;
    } else if (line.startsWith("-")) {
      deletions++;
      hasDeltaLines = true;
    }
  }

  if (!hasDeltaLines) {
    additions = lineCount ?? lines.filter((l) => l.trim().length > 0).length;
    deletions = 0;
  }

  return { additions, deletions };
}

export function computeMechanicalColors(
  additions: number,
  deletions: number,
): {
  color: string;
  borderColor: string;
  balanceTag: string;
} {
  const total = additions + deletions;
  if (total === 0) {
    return {
      color: "rgba(55, 65, 81, 0.45)",
      borderColor: "#4b5563",
      balanceTag: "No changes",
    };
  }

  const r = (additions - deletions) / total;

  const gGray = 65;
  const rGray = 55;
  const bGray = 81;

  if (r >= 0) {
    const factor = r;
    const redCh = Math.round(rGray * (1 - factor) + 25 * factor);
    const greenCh = Math.round(gGray * (1 - factor) + 160 * factor);
    const blueCh = Math.round(bGray * (1 - factor) + 54 * factor);
    const alpha = 0.35 + 0.35 * factor;
    const color = `rgba(${redCh}, ${greenCh}, ${blueCh}, ${alpha.toFixed(2)})`;

    const borderR = Math.round(107 * (1 - factor) + 63 * factor);
    const borderG = Math.round(114 * (1 - factor) + 185 * factor);
    const borderB = Math.round(128 * (1 - factor) + 80 * factor);
    const borderColor = `rgb(${borderR}, ${borderG}, ${borderB})`;

    let balanceTag = `${Math.round((additions / total) * 100)}% Add / ${Math.round((deletions / total) * 100)}% Del`;
    if (r === 1) balanceTag = "100% Additions (Bright Green)";
    else if (r === 0) balanceTag = "50% Add / 50% Del (Neutral Gray)";

    return { color, borderColor, balanceTag };
  } else {
    const factor = Math.abs(r);
    const redCh = Math.round(rGray * (1 - factor) + 218 * factor);
    const greenCh = Math.round(gGray * (1 - factor) + 40 * factor);
    const blueCh = Math.round(bGray * (1 - factor) + 45 * factor);
    const alpha = 0.35 + 0.35 * factor;
    const color = `rgba(${redCh}, ${greenCh}, ${blueCh}, ${alpha.toFixed(2)})`;

    const borderR = Math.round(107 * (1 - factor) + 248 * factor);
    const borderG = Math.round(114 * (1 - factor) + 81 * factor);
    const borderB = Math.round(128 * (1 - factor) + 73 * factor);
    const borderColor = `rgb(${borderR}, ${borderG}, ${borderB})`;

    const delPct = Math.round((deletions / total) * 100);
    let balanceTag = `${100 - delPct}% Add / ${delPct}% Del`;
    if (r === -1) balanceTag = "100% Deletions (Bright Red)";

    return { color, borderColor, balanceTag };
  }
}

export function computeReplayMetrics(steps: AtomicStep[]): FileChurnMetric[] {
  const map = new Map<string, { additions: number; deletions: number; fileName: string }>();

  for (const step of steps) {
    const delta = extractStepDelta(step.diff, step.lineCount);
    const existing = map.get(step.filePath) ?? {
      additions: 0,
      deletions: 0,
      fileName: step.fileName,
    };
    existing.additions += delta.additions;
    existing.deletions += delta.deletions;
    map.set(step.filePath, existing);
  }

  const result: FileChurnMetric[] = [];
  for (const [filePath, data] of map.entries()) {
    const size = Math.max(data.additions, data.deletions);
    const total = data.additions + data.deletions;
    const ratio = total === 0 ? 0 : (data.additions - data.deletions) / total;
    const { color, borderColor, balanceTag } = computeMechanicalColors(
      data.additions,
      data.deletions,
    );

    const lastSlash = filePath.lastIndexOf("/");
    const dirPath = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "root";

    result.push({
      filePath,
      fileName: data.fileName,
      dirPath,
      additions: data.additions,
      deletions: data.deletions,
      size,
      ratio,
      color,
      borderColor,
      balanceTag,
    });
  }

  return result.sort((a, b) => b.size - a.size);
}

export function squarify<T>(items: TreemapItem<T>[], rect: Rect): LayoutResult<T>[] {
  if (items.length === 0) return [];
  const totalWeight = items.reduce((sum, item) => sum + Math.max(1, item.weight), 0);
  if (totalWeight <= 0) return [];

  const sorted = [...items].sort((a, b) => Math.max(1, b.weight) - Math.max(1, a.weight));
  const result: LayoutResult<T>[] = [];

  let currentRect = { ...rect };
  let currentRemaining = [...sorted];
  let totalRemainingWeight = totalWeight;

  while (currentRemaining.length > 0) {
    // 1. Try normal short edge preference:
    // If w < h, short edge is w -> slice horizontally across width (isVertical = true).
    // If w >= h, short edge is h -> slice vertically across height (isVertical = false).
    let isVertical = currentRect.w < currentRect.h;

    // Check candidate column dimensions if cutting along normal edge:
    const firstWeight = Math.max(1, currentRemaining[0]!.weight);
    const normalColWidth = (firstWeight / totalRemainingWeight) * currentRect.w;
    const normalColHeight = currentRect.h;

    if (!isVertical) {
      const widthShorterThanHeight = normalColWidth < normalColHeight;
      const bothShort = normalColWidth < 60 && normalColHeight < 60;

      if (bothShort) {
        // 3. if the width and height is both short, normal short edge preference
        isVertical = false;
      } else if (widthShorterThanHeight) {
        // 2. if the width is too short, prefer the wide orientation
        isVertical = true;
      }
    }

    const side = isVertical ? currentRect.w : currentRect.h;

    let row = [currentRemaining[0]!];
    let rowWeight = Math.max(1, currentRemaining[0]!.weight);
    let i = 1;

    const worstAspect = (testRow: TreemapItem<T>[], testWeight: number): number => {
      const rowThickness =
        (testWeight / totalRemainingWeight) * (isVertical ? currentRect.h : currentRect.w);
      if (rowThickness <= 0) return Infinity;
      let maxScore = 0;
      for (const it of testRow) {
        const itemLen = (Math.max(1, it.weight) / testWeight) * side;
        if (itemLen <= 0) continue;
        const w = isVertical ? itemLen : rowThickness;
        const h = isVertical ? rowThickness : itemLen;

        const normalAspect = Math.max(w / h, h / w);
        const widthTooShort = w < h;
        const bothShort = w < 60 && h < 60;

        let score: number;
        if (bothShort) {
          // 3. if the width and height is both short, normal short edge preference
          score = normalAspect;
        } else if (widthTooShort) {
          // 2. if the width is too short, prefer the wide orientation
          score = (h / w) * 3.5;
        } else {
          // 1. try normal short edge preference
          score = normalAspect;
        }

        if (score > maxScore) maxScore = score;
      }
      return maxScore;
    };

    while (i < currentRemaining.length) {
      const nextItem = currentRemaining[i]!;
      const nextWeight = rowWeight + Math.max(1, nextItem.weight);
      if (worstAspect([...row, nextItem], nextWeight) <= worstAspect(row, rowWeight)) {
        row.push(nextItem);
        rowWeight = nextWeight;
        i++;
      } else {
        break;
      }
    }

    const rowThickness =
      (rowWeight / totalRemainingWeight) * (isVertical ? currentRect.h : currentRect.w);
    let offset = 0;
    for (const it of row) {
      const itemLen = (Math.max(1, it.weight) / rowWeight) * side;
      if (isVertical) {
        result.push({
          x: ((currentRect.x + offset) / rect.w) * 100,
          y: (currentRect.y / rect.h) * 100,
          w: (itemLen / rect.w) * 100,
          h: (rowThickness / rect.h) * 100,
          item: it,
        });
        offset += itemLen;
      } else {
        result.push({
          x: (currentRect.x / rect.w) * 100,
          y: ((currentRect.y + offset) / rect.h) * 100,
          w: (rowThickness / rect.w) * 100,
          h: (itemLen / rect.h) * 100,
          item: it,
        });
        offset += itemLen;
      }
    }

    if (isVertical) {
      currentRect.y += rowThickness;
      currentRect.h -= rowThickness;
    } else {
      currentRect.x += rowThickness;
      currentRect.w -= rowThickness;
    }

    totalRemainingWeight -= rowWeight;
    currentRemaining = currentRemaining.slice(row.length);
  }

  return result;
}

export function buildMetricTree(files: FileChurnMetric[]): TreeNode {
  const root: TreeNode = { name: "root", fullPath: "", files: [], children: new Map() };

  for (const f of files) {
    const parts = f.filePath.split("/");
    let curr = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!curr.children.has(part)) {
        const nextPath = curr.fullPath ? `${curr.fullPath}/${part}` : part;
        curr.children.set(part, { name: part, fullPath: nextPath, files: [], children: new Map() });
      }
      curr = curr.children.get(part)!;
    }
    curr.files.push(f);
  }

  return root;
}

function collectDescendantFiles(n: TreeNode): FileChurnMetric[] {
  const list = [...n.files];
  for (const child of n.children.values()) {
    list.push(...collectDescendantFiles(child));
  }
  return list;
}

export function compactToBranchingNode(node: TreeNode): TreeNode {
  let curr = node;
  while (curr.files.length === 0 && curr.children.size === 1) {
    curr = Array.from(curr.children.values())[0]!;
  }
  return curr;
}

export function getChildBranches(node: TreeNode): DirectoryBranch[] {
  const result: DirectoryBranch[] = [];

  for (const child of node.children.values()) {
    const curr = compactToBranchingNode(child);
    result.push({
      dirPath: curr.fullPath,
      node: curr,
      files: collectDescendantFiles(child),
    });
  }

  if (node.files.length > 0) {
    result.push({
      dirPath: node.fullPath || "root",
      node,
      files: [...node.files],
    });
  }

  return result;
}

export function getCanvasDimensionHint(): { w: number; h: number } {
  const canvasEl = document.querySelector<HTMLElement>(".treemap-canvas");
  if (canvasEl && canvasEl.clientWidth > 0 && canvasEl.clientHeight > 0) {
    return { w: canvasEl.clientWidth, h: canvasEl.clientHeight };
  }
  const winW = typeof window !== "undefined" ? window.innerWidth : 1600;
  const winH = typeof window !== "undefined" ? window.innerHeight : 1000;
  const w = Math.max(400, winW - 280);
  const h = Math.max(300, winH - 260);
  return { w, h };
}

export function parseDiff(diff: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let file: ParsedFile | null = null;
  let hunk: ParsedFile["hunks"][number] | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      file = { path: match?.[2] ?? "unknown", hunks: [] };
      files.push(file);
      hunk = null;
    } else if (line.startsWith("@@ ") && file) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match?.[1] && match[2]) {
        hunk = {
          header: line,
          oldStart: Number(match[1]),
          newStart: Number(match[2]),
          lines: [],
        };
        file.hunks.push(hunk);
      }
    } else if (hunk && !line.startsWith("\\ No newline")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        hunk.lines.push({ type: "add", content: line.slice(1) });
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        hunk.lines.push({ type: "delete", content: line.slice(1) });
      } else if (line.startsWith(" ")) {
        hunk.lines.push({ type: "context", content: line.slice(1) });
      }
    }
  }
  return files.filter((candidate) => candidate.hunks.length);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to execCommand below.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.append(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand("copy");
    textarea.remove();
    return successful;
  } catch {
    return false;
  }
}

export function parseOverviewHash(): { isOverview: boolean; folder: string | null } {
  const hash = window.location.hash;
  if (!hash.startsWith("#overview")) return { isOverview: false, folder: null };
  if (hash === "#overview") return { isOverview: true, folder: null };
  const colonIdx = hash.indexOf(":");
  if (colonIdx >= 0) {
    const rawFolder = decodeURIComponent(hash.slice(colonIdx + 1));
    return { isOverview: true, folder: rawFolder || null };
  }
  return { isOverview: true, folder: null };
}

export function updateOverviewHash(folder: string | null): void {
  const targetHash = folder ? `#overview:${encodeURIComponent(folder)}` : "#overview";
  if (window.location.hash !== targetHash) {
    window.history.pushState({}, "", targetHash);
  }
}

export function clearOverviewHash(): void {
  if (window.location.hash.startsWith("#overview")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

export function riskClass(risk: string): string {
  const normalized = risk.toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium")) return "medium";
  return "low";
}

export function relativeTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, "second");
}

export function typeBadge(step: AtomicStep): "CODEGEN" | "TEST" | "PRODUCT" {
  if (step.isCodegen) return "CODEGEN";
  if (step.isTest) return "TEST";
  return "PRODUCT";
}

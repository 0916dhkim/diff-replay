import type {
  AtomicStep,
  Replay,
  ReplaySummary,
  ReviewNote,
  StepStatus,
} from "../src/contracts.js";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
let currentReplay: Replay | null = null;
let eventSource: EventSource | null = null;
let viewMode: "split" | "unified" = "split";
let sidebarsHidden = false;
let isOverviewActive = false;
let zoomedDirPath: string | null = null;
let routeGeneration = 0;
let mutationQueue: Promise<unknown> = Promise.resolve();
let renderReplayCounter = 0;

interface ElementRectSnapshot {
  tag: string;
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scrollTop: number;
  scrollHeight: number;
}

function snapshotRect(selector: string): ElementRectSnapshot | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    className: el.className,
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
    scrollTop: Math.round(el.scrollTop),
    scrollHeight: Math.round(el.scrollHeight),
  };
}

function captureLayoutSnapshot() {
  return {
    windowScrollY: Math.round(window.scrollY),
    windowScrollX: Math.round(window.scrollX),
    workspace: snapshotRect(".workspace"),
    stepRail: snapshotRect(".step-rail"),
    stepList: snapshotRect(".step-list"),
    reviewMain: snapshotRect(".review-main"),
    overviewScroll: snapshotRect(".overview-scroll"),
    treemapHero: snapshotRect(".treemap-hero"),
    breadcrumbBar: snapshotRect(".treemap-breadcrumb-bar"),
    spectrumLegend: snapshotRect(".spectrum-legend-card"),
    treemapCanvas: snapshotRect(".treemap-canvas"),
  };
}

function diffSnapshots(
  prev: ReturnType<typeof captureLayoutSnapshot>,
  next: ReturnType<typeof captureLayoutSnapshot>,
) {
  const differences: Record<string, unknown> = {};
  for (const key of Object.keys(prev) as (keyof typeof prev)[]) {
    const p = prev[key];
    const n = next[key];
    if (JSON.stringify(p) !== JSON.stringify(n)) {
      differences[key] = { previous: p, next: n };
    }
  }
  return differences;
}

if (typeof window !== "undefined" && "PerformanceObserver" in window) {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: Array<{
            node?: Node;
            previousRect: DOMRectReadOnly;
            currentRect: DOMRectReadOnly;
          }>;
        };
        console.warn(
          "[DEBUG][LayoutShift PerformanceEntry]",
          JSON.stringify({
            value: Number(shift.value.toFixed(5)),
            hadRecentInput: shift.hadRecentInput,
            sources: shift.sources?.map((s) => ({
              node:
                s.node instanceof HTMLElement
                  ? `${s.node.tagName.toLowerCase()}.${s.node.className}`
                  : String(s.node),
              previousRect: s.previousRect
                ? {
                    x: Math.round(s.previousRect.x * 10) / 10,
                    y: Math.round(s.previousRect.y * 10) / 10,
                    w: Math.round(s.previousRect.width * 10) / 10,
                    h: Math.round(s.previousRect.height * 10) / 10,
                  }
                : null,
              currentRect: s.currentRect
                ? {
                    x: Math.round(s.currentRect.x * 10) / 10,
                    y: Math.round(s.currentRect.y * 10) / 10,
                    w: Math.round(s.currentRect.width * 10) / 10,
                    h: Math.round(s.currentRect.height * 10) / 10,
                  }
                : null,
            })),
          }),
        );
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  } catch (err) {
    console.error("[DEBUG] Could not initialize layout-shift observer:", err);
  }
}

void route();

function parseOverviewHash(): { isOverview: boolean; folder: string | null } {
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

function updateOverviewHash(folder: string | null): void {
  const targetHash = folder ? `#overview:${encodeURIComponent(folder)}` : "#overview";
  if (window.location.hash !== targetHash) {
    window.history.pushState({}, "", targetHash);
  }
}

function clearOverviewHash(): void {
  if (window.location.hash.startsWith("#overview")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

window.addEventListener("popstate", () => {
  if (currentReplay && window.location.pathname === `/replays/${currentReplay.id}`) {
    const { isOverview, folder } = parseOverviewHash();
    console.log("[DEBUG] popstate within same replay:", {
      currentOverview: isOverviewActive,
      targetOverview: isOverview,
      currentFolder: zoomedDirPath,
      targetFolder: folder,
      hash: window.location.hash,
    });
    if (isOverviewActive !== isOverview || zoomedDirPath !== folder) {
      isOverviewActive = isOverview;
      zoomedDirPath = folder;
      renderReplay(currentReplay, "popstate-in-replay");
    }
    return;
  }
  void route();
});

window.addEventListener("hashchange", () => {
  if (currentReplay) {
    const { isOverview, folder } = parseOverviewHash();
    console.log("[DEBUG] hashchange triggered:", {
      currentOverview: isOverviewActive,
      targetOverview: isOverview,
      currentFolder: zoomedDirPath,
      targetFolder: folder,
      hash: window.location.hash,
    });
    if (isOverviewActive !== isOverview || zoomedDirPath !== folder) {
      isOverviewActive = isOverview;
      zoomedDirPath = folder;
      renderReplay(currentReplay, "hashchange");
    }
  }
});
window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea")) return;
  if (event.key === "Escape" && currentReplay && isOverviewActive) {
    if (zoomedDirPath !== null) {
      event.preventDefault();
      console.log("[DEBUG] Escape pressed -> zoom out to root");
      zoomedDirPath = null;
      updateOverviewHash(null);
      renderReplay(currentReplay, "escape-zoom-out");
    } else {
      event.preventDefault();
      console.log("[DEBUG] Escape pressed -> exit overview to review");
      isOverviewActive = false;
      clearOverviewHash();
      renderReplay(currentReplay, "escape-exit-overview");
    }
    return;
  }
  if (event.code === "Space" && currentReplay) {
    event.preventDefault();
    if (isOverviewActive) {
      isOverviewActive = false;
      zoomedDirPath = null;
      clearOverviewHash();
      renderReplay(currentReplay, "space-exit-overview");
    } else {
      void approveAndAdvance();
    }
  }
  if (
    (event.key === "m" || event.key === "o") &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    currentReplay
  ) {
    event.preventDefault();
    isOverviewActive = !isOverviewActive;
    zoomedDirPath = null;
    if (isOverviewActive) {
      updateOverviewHash(null);
    } else {
      clearOverviewHash();
    }
    renderReplay(currentReplay, "key-m-toggle");
  }
  if (
    event.key === "z" &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    currentReplay
  ) {
    event.preventDefault();
    sidebarsHidden = !sidebarsHidden;
    document.querySelector(".workspace")?.classList.toggle("sidebars-hidden", sidebarsHidden);
  }
});

async function route(): Promise<void> {
  const generation = ++routeGeneration;
  eventSource?.close();
  eventSource = null;
  currentReplay = null;
  isOverviewActive = false;
  zoomedDirPath = null;
  const match = window.location.pathname.match(/^\/replays\/([^/]+)$/);
  try {
    if (match?.[1]) await loadReplay(match[1], generation);
    else await renderHome(generation);
  } catch (error) {
    if (generation === routeGeneration) renderError(error);
  }
}

async function renderHome(generation: number): Promise<void> {
  const { replays } = await api<{ replays: ReplaySummary[] }>("/api/replays");
  if (generation !== routeGeneration) return;
  app.replaceChildren(
    element("main", { className: "home" }, [
      element("header", { className: "home-header" }, [
        element("div", { className: "brand-mark", text: "DR" }),
        element("div", {}, [
          element("p", { className: "eyebrow", text: "LOCAL REVIEW WORKSPACE" }),
          element("h1", { text: "Diff Replay" }),
          element("p", {
            className: "home-subtitle",
            text: "Walk through complex changes one deliberate step at a time.",
          }),
        ]),
      ]),
      replays.length
        ? element("section", { className: "replay-grid" }, replays.map(renderReplayCard))
        : renderEmptyState(),
    ]),
  );
}

function renderReplayCard(replay: ReplaySummary): HTMLElement {
  const progress = replay.totalSteps ? replay.approvedSteps / replay.totalSteps : 0;
  const card = element("article", { className: "replay-card" }, [
    element("div", { className: "card-topline" }, [
      element("span", { className: "repository", text: replay.repository ?? "Local diff" }),
      element("time", { text: relativeTime(replay.updatedAt), title: replay.updatedAt }),
    ]),
    element("h2", { text: replay.title }),
    element("p", {
      className: "card-description",
      text: replay.description ?? replay.sourceKey,
    }),
    element("div", { className: "progress-track" }, [
      element("span", { style: `width: ${progress * 100}%` }),
    ]),
    element("div", { className: "card-footer" }, [
      element("span", { text: `${replay.approvedSteps}/${replay.totalSteps} reviewed` }),
      replay.flaggedSteps
        ? element("span", { className: "flag-count", text: `${replay.flaggedSteps} flagged` })
        : element("span", { text: "No flags" }),
    ]),
  ]);
  card.tabIndex = 0;
  card.addEventListener("click", () => navigate(`/replays/${replay.id}`));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") navigate(`/replays/${replay.id}`);
  });
  return card;
}

function renderEmptyState(): HTMLElement {
  return element("section", { className: "empty-state" }, [
    element("div", { className: "empty-glyph", text: "±" }),
    element("h2", { text: "No replays yet" }),
    element("p", { text: "Publish a manifest and it will appear here." }),
    element("code", { text: "diff-replay publish ./manifest.json" }),
  ]);
}

async function loadReplay(replayId: string, generation: number): Promise<void> {
  const { replay } = await api<{ replay: Replay }>(`/api/replays/${replayId}`);
  if (generation !== routeGeneration) return;
  currentReplay = replay;
  const { isOverview, folder } = parseOverviewHash();
  isOverviewActive = isOverview;
  zoomedDirPath = folder;
  renderReplay(replay);
  eventSource = new EventSource(`/api/replays/${replayId}/events`);
  eventSource.addEventListener("message", (event) => {
    const message = JSON.parse(event.data) as { type: string };
    if (message.type === "replay-updated") void refreshReplay(replayId, generation);
  });
}

async function refreshReplay(replayId: string, generation: number): Promise<void> {
  const { replay } = await api<{ replay: Replay }>(`/api/replays/${replayId}`);
  if (generation !== routeGeneration || currentReplay?.id !== replayId) return;
  currentReplay = replay;
  renderReplay(replay);
}

interface FileChurnMetric {
  filePath: string;
  fileName: string;
  dirPath: string;
  additions: number;
  deletions: number;
  size: number;
  ratio: number;
  color: string;
  borderColor: string;
  balanceTag: string;
}

interface TreemapItem<T> {
  id: string;
  weight: number;
  data: T;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayoutResult<T> extends Rect {
  item: TreemapItem<T>;
}

function extractStepDelta(
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

function computeMechanicalColors(
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

function computeReplayMetrics(steps: AtomicStep[]): FileChurnMetric[] {
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

function squarify<T>(items: TreemapItem<T>[], rect: Rect): LayoutResult<T>[] {
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
      const MIN_READABLE_WIDTH = 110;
      const widthTooShort = normalColWidth < MIN_READABLE_WIDTH;
      const bothShort = normalColWidth < MIN_READABLE_WIDTH && normalColHeight < MIN_READABLE_WIDTH;

      if (bothShort) {
        // 3. if the width and height is both short, normal short edge preference
        isVertical = false;
      } else if (widthTooShort) {
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
        const MIN_READABLE_WIDTH = 110;
        const widthTooShort = w < MIN_READABLE_WIDTH && h > w;
        const bothShort = w < MIN_READABLE_WIDTH && h < MIN_READABLE_WIDTH;

        let score: number;
        if (bothShort) {
          // 3. if the width and height is both short, normal short edge preference
          score = normalAspect;
        } else if (widthTooShort) {
          // 2. if the width is too short, prefer the wide orientation
          score = (h / w) * (MIN_READABLE_WIDTH / Math.max(1, w)) * 2.5;
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

interface TreeNode {
  name: string;
  fullPath: string;
  files: FileChurnMetric[];
  children: Map<string, TreeNode>;
}

function buildMetricTree(files: FileChurnMetric[]): TreeNode {
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

interface DirectoryBranch {
  dirPath: string;
  node: TreeNode;
  files: FileChurnMetric[];
}

function compactToBranchingNode(node: TreeNode): TreeNode {
  let curr = node;
  while (curr.files.length === 0 && curr.children.size === 1) {
    curr = Array.from(curr.children.values())[0]!;
  }
  return curr;
}

function getChildBranches(node: TreeNode): DirectoryBranch[] {
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
function renderBranchContent(
  branch: DirectoryBranch,
  replay: Replay,
  pixelRect: { w: number; h: number },
  depth = 1,
): HTMLElement {
  const container = element("div", { className: "treemap-dir-content" });
  const effectiveNode = compactToBranchingNode(branch.node);
  const subBranches = getChildBranches(effectiveNode);

  if (depth < 3 && subBranches.length > 1) {
    const subItems: TreemapItem<DirectoryBranch>[] = subBranches.map((sub) => ({
      id: sub.dirPath,
      weight: sub.files.reduce((sum, f) => sum + f.size, 0),
      data: sub,
    }));

    const subLayout = squarify(subItems, { x: 0, y: 0, w: pixelRect.w, h: pixelRect.h });

    for (const subRect of subLayout) {
      const sub = subRect.item.data;
      const subBox = element("div", {
        className: "treemap-sub-box",
        style: `left: calc(${subRect.x.toFixed(2)}% + 2px); top: calc(${subRect.y.toFixed(2)}% + 2px); width: calc(${subRect.w.toFixed(2)}% - 4px); height: calc(${subRect.h.toFixed(2)}% - 4px);`,
      });

      const prefixToStrip = branch.dirPath ? branch.dirPath + "/" : "";
      const shortName = sub.dirPath.startsWith(prefixToStrip)
        ? sub.dirPath.slice(prefixToStrip.length)
        : sub.dirPath;

      const subHeader = element(
        "div",
        {
          className: "treemap-sub-header",
          title: `Click to zoom into ${sub.dirPath}`,
        },
        [
          element("span", { text: `📁 ${shortName}` }),
          element("span", {
            className: "dir-loc",
            text: `${subRect.item.weight} LOC · Zoom ↗`,
          }),
        ],
        () => {
          console.log("[DEBUG] Zooming into nested folder:", sub.dirPath);
          isOverviewActive = true;
          zoomedDirPath = sub.dirPath;
          updateOverviewHash(zoomedDirPath);
          renderReplay(replay, "zoom-nested-folder-click");
        },
      );

      const subPixelW = (subRect.w / 100) * pixelRect.w;
      const subPixelH = (subRect.h / 100) * pixelRect.h;
      const subContent = renderBranchContent(
        sub,
        replay,
        { w: subPixelW, h: subPixelH },
        depth + 1,
      );

      subBox.append(subHeader, subContent);
      container.append(subBox);
    }
  } else {
    const fileItems: TreemapItem<FileChurnMetric>[] = branch.files.map((f) => ({
      id: f.filePath,
      weight: f.size,
      data: f,
    }));

    const fileLayout = squarify(fileItems, { x: 0, y: 0, w: pixelRect.w, h: pixelRect.h });

    for (const fileRect of fileLayout) {
      const file = fileRect.item.data;
      const tile = element(
        "div",
        {
          className: "treemap-file-tile",
          style: `left: calc(${fileRect.x.toFixed(2)}% + 1.5px); top: calc(${fileRect.y.toFixed(2)}% + 1.5px); width: calc(${fileRect.w.toFixed(2)}% - 3px); height: calc(${fileRect.h.toFixed(2)}% - 3px); background: ${file.color}; border: 1px solid ${file.borderColor};`,
        },
        [
          element("div", { className: "tile-content" }, [
            element("div", { className: "treemap-file-name", text: file.fileName }),
            element("div", { className: "treemap-file-meta" }, [
              element("span", { text: `+${file.additions} / -${file.deletions}` }),
              element("span", { text: `size: ${file.size}` }),
            ]),
          ]),
        ],
      );

      tile.title = `${file.filePath}\n+${file.additions} / -${file.deletions} lines\nSize: max(${file.additions}, ${file.deletions}) = ${file.size}\nBalance: ${file.balanceTag}`;
      container.append(tile);
    }
  }

  return container;
}

function getCanvasDimensionHint(): { w: number; h: number } {
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

function renderOverviewMain(replay: Replay): HTMLElement {
  const fileMetrics = computeReplayMetrics(replay.steps);
  const totalMaxLoc = fileMetrics.reduce((sum, f) => sum + f.size, 0);
  const totalAdditions = fileMetrics.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = fileMetrics.reduce((sum, f) => sum + f.deletions, 0);

  const tree = buildMetricTree(fileMetrics);

  const canvas = element("div", { className: "treemap-canvas" });
  let breadcrumbBar: HTMLElement;
  let activeFiles = fileMetrics;
  let displayTitle = "";
  const dim = getCanvasDimensionHint();

  if (zoomedDirPath !== null) {
    const currentZoom = zoomedDirPath;
    let targetNode: TreeNode | null = tree;
    for (const part of currentZoom.split("/")) {
      targetNode = targetNode?.children.get(part) ?? null;
    }

    activeFiles = targetNode
      ? collectDescendantFiles(targetNode)
      : fileMetrics.filter((f) => f.filePath.startsWith(currentZoom));
    const zoomedWeight = activeFiles.reduce((sum, f) => sum + f.size, 0);

    const breadcrumbSegments: (HTMLElement | string)[] = [
      element("button", { className: "breadcrumb-btn", text: "📁 All Folders" }, [], () => {
        console.log("[DEBUG] Zooming out to root via breadcrumb link");
        zoomedDirPath = null;
        updateOverviewHash(null);
        renderReplay(replay, "breadcrumb-root-click");
      }),
    ];

    const effectiveTarget = targetNode ? compactToBranchingNode(targetNode) : null;
    displayTitle = currentZoom;

    const parts = currentZoom.split("/");
    let accum = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      accum = accum ? `${accum}/${part}` : part;
      breadcrumbSegments.push(element("span", { className: "breadcrumb-sep", text: "/" }));
      if (i === parts.length - 1) {
        breadcrumbSegments.push(element("span", { className: "breadcrumb-active", text: part }));
      } else {
        const targetAccum = accum;
        breadcrumbSegments.push(
          element("button", { className: "breadcrumb-btn", text: part }, [], () => {
            console.log("[DEBUG] Zooming to ancestor folder:", targetAccum);
            zoomedDirPath = targetAccum;
            updateOverviewHash(zoomedDirPath);
            renderReplay(replay, "breadcrumb-ancestor-click");
          }),
        );
      }
    }

    breadcrumbBar = element("nav", { className: "treemap-breadcrumb-bar" }, [
      element("div", { className: "breadcrumb-path" }, breadcrumbSegments),
      button("← Back to all folders (Esc)", "breadcrumb-back-btn", () => {
        console.log("[DEBUG] Zooming out to root via back button");
        zoomedDirPath = null;
        updateOverviewHash(null);
        renderReplay(replay, "breadcrumb-back-button");
      }),
    ]);
    const dirBox = element("div", {
      className: "treemap-dir-box",
      style: "left: 3px; top: 3px; width: calc(100% - 6px); height: calc(100% - 6px);",
    });

    const dirHeader = element("div", { className: "treemap-dir-header", title: currentZoom }, [
      element("span", { text: `📁 ${currentZoom}` }),
      element("span", { className: "dir-loc", text: `${zoomedWeight} LOC · Zoomed View` }),
    ]);

    const targetBranch: DirectoryBranch = {
      dirPath: currentZoom,
      node: effectiveTarget ?? {
        name: currentZoom,
        fullPath: currentZoom,
        files: activeFiles,
        children: new Map(),
      },
      files: activeFiles,
    };

    const dirContent = renderBranchContent(targetBranch, replay, dim, 1);

    dirBox.append(dirHeader, dirContent);
    canvas.append(dirBox);
  } else {
    // Root View: Compact root if tree has single-child root with no direct files
    const displayRoot = compactToBranchingNode(tree);
    const dirBranches = getChildBranches(displayRoot);

    breadcrumbBar = element("nav", { className: "treemap-breadcrumb-bar" }, [
      element("div", { className: "breadcrumb-path" }, [
        element("span", { className: "breadcrumb-active", text: "📁 All Folders (Root)" }),
        element("span", {
          className: "breadcrumb-hint",
          text: "Click any folder header to zoom in",
        }),
      ]),
    ]);

    const dirItems: TreemapItem<DirectoryBranch>[] = dirBranches.map((b) => ({
      id: b.dirPath,
      weight: b.files.reduce((sum, f) => sum + f.size, 0),
      data: b,
    }));

    const dirLayout = squarify(dirItems, { x: 0, y: 0, w: dim.w, h: dim.h });

    for (const dirRect of dirLayout) {
      const branch = dirRect.item.data;
      const dirBox = element("div", {
        className: "treemap-dir-box",
        style: `left: calc(${dirRect.x.toFixed(2)}% + 3px); top: calc(${dirRect.y.toFixed(2)}% + 3px); width: calc(${dirRect.w.toFixed(2)}% - 6px); height: calc(${dirRect.h.toFixed(2)}% - 6px);`,
      });

      const dirHeader = element(
        "div",
        {
          className: "treemap-dir-header is-clickable",
          title: `Click to zoom into ${branch.dirPath}`,
        },
        [
          element("span", { text: `📁 ${branch.dirPath}` }),
          element("span", {
            className: "dir-loc",
            text: `${dirRect.item.weight} LOC · Zoom ↗`,
          }),
        ],
        () => {
          console.log("[DEBUG] Zooming into folder:", branch.dirPath);
          isOverviewActive = true;
          zoomedDirPath = branch.dirPath;
          updateOverviewHash(zoomedDirPath);
          renderReplay(replay, "zoom-folder-click");
        },
      );

      const branchPixelW = (dirRect.w / 100) * dim.w;
      const branchPixelH = (dirRect.h / 100) * dim.h;
      const dirContent = renderBranchContent(
        branch,
        replay,
        { w: branchPixelW, h: branchPixelH },
        1,
      );

      dirBox.append(dirHeader, dirContent);
      canvas.append(dirBox);
    }
  }

  const activeWeight = activeFiles.reduce((sum, f) => sum + f.size, 0);
  const activeAdditions = activeFiles.reduce((sum, f) => sum + f.additions, 0);
  const activeDeletions = activeFiles.reduce((sum, f) => sum + f.deletions, 0);

  return element("main", { className: "review-main" }, [
    element("header", { className: "review-header" }, [
      element("div", { className: "review-heading" }, [
        element("button", { className: "back-button", text: "Diff Replay" }, [], () =>
          navigate("/"),
        ),
        element("span", { className: "header-divider", text: "/" }),
        element("strong", { text: replay.title }),
        element("span", { className: "header-divider", text: "/" }),
        element("span", { style: "color: var(--lime); font-weight: 600;", text: "Stack Overview" }),
      ]),
      element("div", { className: "header-actions" }, [
        button("Back to review", "button primary", () => {
          console.log("[DEBUG] Exiting overview via Back to review button");
          isOverviewActive = false;
          zoomedDirPath = null;
          clearOverviewHash();
          renderReplay(replay, "back-to-review-button");
        }),
      ]),
    ]),
    element("div", { className: "overview-scroll" }, [
      element("section", { className: "treemap-hero" }, [
        element("p", { className: "eyebrow", text: "STACK CHURN HEATMAP · MECHANICAL FOOTPRINT" }),
        element("h1", { text: "Stack Overview" }),
        element("p", {
          text:
            zoomedDirPath !== null
              ? `Zoomed into folder: ${displayTitle}`
              : "Mechanical diff footprint across touched files in this replay stack.",
        }),
        element("div", { className: "treemap-stats-row" }, [
          element("span", { className: "treemap-stat-badge" }, [
            element("span", { text: "Files:" }),
            element("strong", { text: String(activeFiles.length) }),
          ]),
          element("span", { className: "treemap-stat-badge" }, [
            element("span", { text: "Max Churn LOC:" }),
            element("strong", { text: `${activeWeight} lines` }),
          ]),
          element("span", { className: "treemap-stat-badge" }, [
            element("span", { text: "Total Additions:" }),
            element("strong", { style: "color: #7ee787;", text: `+${activeAdditions}` }),
          ]),
          element("span", { className: "treemap-stat-badge" }, [
            element("span", { text: "Total Deletions:" }),
            element("strong", { style: "color: #ffa198;", text: `-${activeDeletions}` }),
          ]),
        ]),
      ]),
      breadcrumbBar,
      element("section", { className: "spectrum-legend-card" }, [
        element("div", { className: "spectrum-legend-top" }, [
          element("span", {
            text: "MECHANICAL RATIO: r = (Additions - Deletions) / (Additions + Deletions)",
          }),
          element("span", { text: "Size: max(Additions, Deletions)" }),
        ]),
        element("div", { className: "spectrum-legend-bar" }),
        element("div", { className: "spectrum-legend-ticks" }, [
          element("span", { style: "color: #ffa198;", text: "-1.0 (100% Deletion · Bright Red)" }),
          element("span", {
            style: "color: #e5e7eb; font-weight: 600;",
            text: "0.0 (50% Add / 50% Del · Neutral Gray)",
          }),
          element("span", {
            style: "color: #7ee787;",
            text: "+1.0 (100% Addition · Bright Green)",
          }),
        ]),
      ]),
      canvas,
    ]),
  ]);
}

function renderReplay(replay: Replay, reason = "render"): void {
  const renderId = ++renderReplayCounter;
  const t0 = performance.now();
  const preSnapshot = captureLayoutSnapshot();

  const callerLine =
    new Error().stack
      ?.split("\n")
      .slice(2, 4)
      .map((l) => l.trim())
      .join(" -> ") ?? "";

  console.log(
    `[DEBUG][renderReplay #${renderId}] START (reason: ${reason}) from ${callerLine}`,
    JSON.stringify({
      isOverviewActive,
      zoomedDirPath,
      hash: window.location.hash,
      preSnapshot,
    }),
  );

  const activeStep =
    replay.steps.find((step) => step.stepId === replay.state.activeStepId) ?? replay.steps[0]!;
  const activeIndex = replay.steps.indexOf(activeStep);
  const approved = Object.values(replay.state.stepStatus).filter(
    (status) => status === "approved",
  ).length;

  app.replaceChildren(
    element("div", { className: `workspace${sidebarsHidden ? " sidebars-hidden" : ""}` }, [
      renderStepRail(replay, activeStep, approved),
      isOverviewActive
        ? renderOverviewMain(replay)
        : element("main", { className: "review-main" }, [
            element("header", { className: "review-header" }, [
              element("div", { className: "review-heading" }, [
                element("button", { className: "back-button", text: "Diff Replay" }, [], () =>
                  navigate("/"),
                ),
                element("span", { className: "header-divider", text: "/" }),
                element("strong", { text: replay.title }),
              ]),
              element("div", { className: "header-actions" }, [
                segmentedControl(),
                button("Approve & next", "button primary", () => void approveAndAdvance()),
              ]),
            ]),
            element("div", { className: "review-scroll" }, [
              element("section", { className: "step-intro" }, [
                element("div", { className: "step-kicker" }, [
                  element("span", { text: `STEP ${activeStep.stepId}` }),
                  typeBadge(activeStep),
                  element("span", {
                    className: `risk risk-${riskClass(activeStep.risk)}`,
                    text: `${activeStep.risk} risk`,
                  }),
                ]),
                element("h1", { text: activeStep.action }),
                element("p", { text: activeStep.takeaway }),
                element("div", { className: "step-meta" }, [
                  element("code", { text: activeStep.filePath }),
                  element("span", { text: `${activeIndex + 1} of ${replay.steps.length}` }),
                ]),
              ]),
              renderDiff(activeStep),
            ]),
          ]),
      renderNotes(replay, activeStep),
    ]),
  );

  const tSync = performance.now();
  const postSyncSnapshot = captureLayoutSnapshot();
  const syncDiff = diffSnapshots(preSnapshot, postSyncSnapshot);
  console.log(
    `[DEBUG][renderReplay #${renderId}] DOM REPLACED (${(tSync - t0).toFixed(2)}ms) SYNC_DIFF:`,
    JSON.stringify(syncDiff),
  );

  requestAnimationFrame(() => {
    const tRaf = performance.now();
    const rafSnapshot = captureLayoutSnapshot();
    const rafDiff = diffSnapshots(postSyncSnapshot, rafSnapshot);
    console.log(
      `[DEBUG][renderReplay #${renderId}] rAF FRAME (${(tRaf - t0).toFixed(2)}ms) RAF_DIFF:`,
      JSON.stringify(rafDiff),
    );
  });
}

function renderStepRail(replay: Replay, activeStep: AtomicStep, approved: number): HTMLElement {
  const fileMetrics = computeReplayMetrics(replay.steps);
  const totalMaxLoc = fileMetrics.reduce((sum, f) => sum + f.size, 0);

  const rootRow = element(
    "button",
    {
      className: `step-row step-zero-row ${isOverviewActive ? "active" : ""}`,
    },
    [
      element("span", { className: "step-index zero-index", text: "⊞" }),
      element("span", { className: "step-copy" }, [
        element("strong", { text: "Stack Overview" }),
        element("small", { text: `${fileMetrics.length} files · ${totalMaxLoc} LOC max` }),
      ]),
    ],
    () => {
      console.log("[DEBUG] Clicked rootRow (Stack Overview in sidebar)");
      isOverviewActive = true;
      zoomedDirPath = null;
      updateOverviewHash(null);
      renderReplay(replay, "root-row-click");
    },
  );

  const divider = element("div", { className: "step-section-divider" }, [
    element("span", { text: `STEPS (${replay.steps.length})` }),
  ]);

  const stepRows = replay.steps.map((step, index) => {
    const status = replay.state.stepStatus[step.stepId];
    const badge = element("span", {
      className: "step-index",
      text: status === "approved" ? "✓" : status === "flagged" ? "!" : String(index + 1),
    });
    if (status === "approved") {
      badge.title = "Unapprove";
      badge.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void setStatus(step.stepId, null);
      });
    }
    return element(
      "button",
      {
        className: `step-row ${step.stepId === activeStep.stepId && !isOverviewActive ? "active" : ""} ${status ?? ""}`,
      },
      [
        badge,
        element("span", { className: "step-copy" }, [
          element("strong", { text: step.action }),
          ...(step.isCodegen || step.isTest
            ? [
                element("span", { className: "step-copy-meta" }, [
                  typeBadge(step),
                  element("small", { text: step.stepId }),
                ]),
              ]
            : [element("small", { text: step.stepId })]),
        ]),
      ],
      () => {
        isOverviewActive = false;
        zoomedDirPath = null;
        clearOverviewHash();
        void selectStep(step.stepId);
      },
    );
  });

  return element("aside", { className: "step-rail" }, [
    element("div", { className: "rail-header" }, [
      element("p", { className: "eyebrow", text: replay.repository ?? "REPLAY" }),
      element("h2", { text: replay.title }),
      element("div", { className: "rail-progress" }, [
        element("span", { text: `${approved} of ${replay.steps.length}` }),
        element("div", { className: "progress-track" }, [
          element("span", { style: `width: ${(approved / replay.steps.length) * 100}%` }),
        ]),
      ]),
    ]),
    element("nav", { className: "step-list", ariaLabel: "Replay steps" }, [
      rootRow,
      divider,
      ...stepRows,
    ]),
  ]);
}

function renderNotes(replay: Replay, activeStep: AtomicStep): HTMLElement {
  const form = element("form", { className: "note-form" }, [
    element("textarea", {
      name: "note",
      placeholder: isOverviewActive
        ? "Leave a general note on this replay..."
        : `Leave a note on step ${activeStep.stepId}...`,
      rows: "3",
    }),
    button("Add note", "button secondary", undefined, "submit"),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const textarea = form.querySelector<HTMLTextAreaElement>("textarea")!;
    const text = textarea.value.trim();
    if (text) void addNote(text, isOverviewActive ? undefined : activeStep.stepId);
  });
  return element("aside", { className: "notes-panel" }, [
    element("header", {}, [
      element("div", {}, [
        element("p", { className: "eyebrow", text: "ACCUMULATED" }),
        element("h2", { text: "Review notes" }),
      ]),
      element("span", { className: "notes-count", text: String(replay.state.notes.length) }),
    ]),
    replay.state.notes.length
      ? element(
          "div",
          { className: "notes-list" },
          replay.state.notes.map((note) => renderNote(note, replay, activeStep)),
        )
      : element("div", { className: "notes-empty", text: "Notes from every pass collect here." }),
    form,
  ]);
}

function renderNote(note: ReviewNote, replay: Replay, activeStep: AtomicStep): HTMLElement {
  const hasStep = Boolean(note.stepId && replay.steps.some((step) => step.stepId === note.stepId));
  const isActive = Boolean(note.stepId && note.stepId === activeStep.stepId);
  const card = element(
    "article",
    {
      className: `note${hasStep ? " is-clickable" : ""}${isActive ? " active" : ""}`,
    },
    [
      element("div", { className: "note-topline" }, [
        element("span", { text: note.stepId ? `Step ${note.stepId}` : "General" }),
        element(
          "button",
          { className: "note-delete", text: "Delete", type: "button" },
          [],
          (event) => {
            event.stopPropagation();
            void deleteNote(note.id);
          },
        ),
      ]),
      element("p", { text: note.text }),
      element("time", { text: relativeTime(note.createdAt), title: note.createdAt }),
    ],
    hasStep && note.stepId
      ? () => {
          isOverviewActive = false;
          void selectStep(note.stepId!);
        }
      : undefined,
  );
  if (hasStep && note.stepId) {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open step ${note.stepId}`);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        isOverviewActive = false;
        void selectStep(note.stepId!);
      }
    });
  }
  return card;
}

function segmentedControl(): HTMLElement {
  return element("div", { className: "segments" }, [
    element(
      "button",
      { className: viewMode === "split" ? "active" : "", text: "Split" },
      [],
      () => {
        viewMode = "split";
        if (currentReplay) renderReplay(currentReplay);
      },
    ),
    element(
      "button",
      { className: viewMode === "unified" ? "active" : "", text: "Unified" },
      [],
      () => {
        viewMode = "unified";
        if (currentReplay) renderReplay(currentReplay);
      },
    ),
  ]);
}

function typeBadge(step: AtomicStep): HTMLElement {
  if (step.isCodegen) return element("span", { className: "type-badge codegen", text: "CODEGEN" });
  if (step.isTest) return element("span", { className: "type-badge test", text: "TEST" });
  return element("span", { className: "type-badge", text: "PRODUCT" });
}

async function selectStep(stepId: string): Promise<boolean> {
  const replay = currentReplay;
  if (!replay) return false;
  if (replay.state.activeStepId === stepId) return true;
  const updated = await mutateReplay(replay.id, `/api/replays/${replay.id}/state`, {
    method: "PATCH",
    body: JSON.stringify({ activeStepId: stepId }),
  });
  return Boolean(updated);
}

async function setStatus(stepId: string, status: StepStatus | null): Promise<boolean> {
  const replay = currentReplay;
  if (!replay) return false;
  const updated = await mutateReplay(
    replay.id,
    `/api/replays/${replay.id}/steps/${encodeURIComponent(stepId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
  return Boolean(updated);
}

async function approveAndAdvance(): Promise<void> {
  const replay = currentReplay;
  if (!replay) return;
  const index = replay.steps.findIndex((step) => step.stepId === replay.state.activeStepId);
  const step = replay.steps[index];
  if (!step) return;
  if (!(await setStatus(step.stepId, "approved"))) return;
  if (currentReplay?.id !== replay.id) return;
  const next = replay.steps[Math.min(index + 1, replay.steps.length - 1)];
  if (next && next.stepId !== step.stepId) await selectStep(next.stepId);
}

async function addNote(text: string, stepId?: string): Promise<void> {
  const replayId = currentReplay?.id;
  if (!replayId) return;
  await mutateReplay(replayId, `/api/replays/${replayId}/notes`, {
    method: "POST",
    body: JSON.stringify({ text, stepId }),
  });
}

async function deleteNote(noteId: string): Promise<void> {
  const replayId = currentReplay?.id;
  if (!replayId) return;
  await mutateReplay(replayId, `/api/replays/${replayId}/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
}

async function mutateReplay(
  replayId: string,
  url: string,
  init: RequestInit,
): Promise<Replay | null> {
  const operation = async (): Promise<Replay | null> => {
    try {
      const { replay } = await api<{ replay: Replay }>(url, init);
      if (currentReplay?.id === replayId) {
        currentReplay = replay;
        renderReplay(replay);
      }
      return replay;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The review change could not be saved");
      return null;
    }
  };
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function showToast(message: string): void {
  const toast = element("div", { className: "toast", role: "alert", text: message });
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 5_000);
}

interface ParsedFile {
  path: string;
  hunks: ParsedHunk[];
}

interface ParsedHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: ParsedLine[];
}

interface ParsedLine {
  type: "add" | "delete" | "context";
  content: string;
}

const COPY_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';

const CHECK_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

async function copyToClipboard(text: string): Promise<boolean> {
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

function renderCopyPathButton(path: string): HTMLElement {
  const button = element("button", {
    className: "copy-path-button",
    type: "button",
    ariaLabel: "Copy file path",
  });
  button.title = "Copy file path";
  button.innerHTML = COPY_ICON_SVG;
  let resetTimer: number | null = null;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const copied = await copyToClipboard(path);
    if (!copied) {
      showToast("Failed to copy file path");
      return;
    }
    button.innerHTML = CHECK_ICON_SVG;
    button.classList.add("copied");
    button.title = "Copied!";
    if (resetTimer != null) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      button.innerHTML = COPY_ICON_SVG;
      button.classList.remove("copied");
      button.title = "Copy file path";
      resetTimer = null;
    }, 1_500);
  });
  return button;
}

function renderDiff(step: AtomicStep): HTMLElement {
  const files = parseDiff(step.diff);
  if (!files.length) return element("pre", { className: "raw-diff", text: step.diff });
  return element(
    "section",
    { className: `diff-stack ${viewMode}` },
    files.map((file) => {
      const body = element("div", { className: "diff-body" });
      if (viewMode === "split") {
        body.append(renderSplitFile(file));
      } else {
        for (const hunk of file.hunks) {
          body.append(element("div", { className: "hunk-header", text: hunk.header }));
          body.append(renderUnifiedHunk(hunk));
        }
      }
      return element("article", { className: "diff-file" }, [
        element("header", {}, [
          element("code", { text: file.path, title: file.path }),
          renderCopyPathButton(file.path),
        ]),
        body,
      ]);
    }),
  );
}

function renderUnifiedHunk(hunk: ParsedHunk): HTMLElement {
  const rows: HTMLElement[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const line of hunk.lines) {
    const oldNumber = line.type === "add" ? "" : String(oldLine++);
    const newNumber = line.type === "delete" ? "" : String(newLine++);
    rows.push(
      element("div", { className: `diff-row ${line.type}` }, [
        element("span", { className: "line-number", text: oldNumber }),
        element("span", { className: "line-number", text: newNumber }),
        element("span", {
          className: "line-prefix",
          text: line.type === "add" ? "+" : line.type === "delete" ? "-" : " ",
        }),
        element("code", { text: line.content }),
      ]),
    );
  }
  return element("div", { className: "unified-lines" }, rows);
}

function renderSplitFile(file: ParsedFile): HTMLElement {
  const left: HTMLElement[] = [];
  const right: HTMLElement[] = [];
  for (const hunk of file.hunks) {
    left.push(element("div", { className: "hunk-header", text: hunk.header }));
    right.push(element("div", { className: "hunk-header", text: hunk.header }));
    appendSplitHunk(hunk, left, right);
  }
  return element("div", { className: "split-lines" }, [
    element("div", { className: "split-pane" }, [
      element("div", { className: "split-pane-inner" }, left),
    ]),
    element("div", { className: "split-pane" }, [
      element("div", { className: "split-pane-inner" }, right),
    ]),
  ]);
}

function appendSplitHunk(hunk: ParsedHunk, left: HTMLElement[], right: HTMLElement[]): void {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index]!;
    if (line.type === "context") {
      left.push(diffHalf(String(oldLine++), line));
      right.push(diffHalf(String(newLine++), line));
      index += 1;
      continue;
    }
    const deletions: ParsedLine[] = [];
    const additions: ParsedLine[] = [];
    while (index < hunk.lines.length && hunk.lines[index]!.type !== "context") {
      const changed = hunk.lines[index++]!;
      if (changed.type === "delete") deletions.push(changed);
      else additions.push(changed);
    }
    const rowCount = Math.max(deletions.length, additions.length);
    for (let row = 0; row < rowCount; row += 1) {
      const deletion = deletions[row];
      const addition = additions[row];
      left.push(diffHalf(deletion ? String(oldLine++) : "", deletion));
      right.push(diffHalf(addition ? String(newLine++) : "", addition));
    }
  }
}

function diffHalf(number: string, line: ParsedLine | undefined): HTMLElement {
  return element("div", { className: `diff-half ${line?.type ?? "empty"}` }, [
    element("span", { className: "line-number", text: number }),
    element("span", {
      className: "line-prefix",
      text: line?.type === "add" ? "+" : line?.type === "delete" ? "-" : " ",
    }),
    element("code", { text: line?.content ?? "" }),
  ]);
}

function parseDiff(diff: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let file: ParsedFile | null = null;
  let hunk: ParsedHunk | null = null;
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

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok)
    throw new Error((await response.text()) || `Request failed: ${response.status}`);
  return (await response.json()) as T;
}

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  void route();
}

function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : "An unexpected error occurred";
  app.replaceChildren(
    element("main", { className: "error-page" }, [
      element("p", { className: "eyebrow", text: "DIFF REPLAY" }),
      element("h1", { text: "Could not load this replay" }),
      element("pre", { text: message }),
      button("Back to replays", "button primary", () => navigate("/")),
    ]),
  );
}

function button(
  text: string,
  className: string,
  onClick?: () => void,
  type: "button" | "submit" = "button",
): HTMLButtonElement {
  const result = element("button", { className, text, type }) as HTMLButtonElement;
  if (onClick) result.addEventListener("click", onClick);
  return result;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: (HTMLElement | string)[] = [],
  onClick?: (event: Event) => void,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "text") node.textContent = value;
    else if (key === "className") node.className = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key === "ariaLabel") node.setAttribute("aria-label", value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function riskClass(risk: string): string {
  const normalized = risk.toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium")) return "medium";
  return "low";
}

function relativeTime(value: string): string {
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

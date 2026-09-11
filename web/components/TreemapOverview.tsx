import { For, Show, createMemo } from "solid-js";

import type { DirectoryBranch, FileChurnMetric, Rect, Replay, TreemapItem } from "../types.js";
import {
  buildMetricTree,
  compactToBranchingNode,
  computeReplayMetrics,
  getCanvasDimensionHint,
  getChildBranches,
  squarify,
} from "../utils.js";

interface TreemapOverviewProps {
  replay: Replay;
  zoomedPath: string | null;
  onZoom: (path: string | null) => void;
}

interface BranchContentProps {
  branch: DirectoryBranch;
  pixelRect: Pick<Rect, "w" | "h">;
  depth: number;
  onZoom: (path: string) => void;
}

function collectDescendantFiles(node: DirectoryBranch["node"]): FileChurnMetric[] {
  const files = [...node.files];
  for (const child of node.children.values()) {
    files.push(...collectDescendantFiles(child));
  }
  return files;
}

function findNode(node: DirectoryBranch["node"], path: string): DirectoryBranch["node"] | null {
  if (path === "root") return node;

  let current: DirectoryBranch["node"] | null = node;
  for (const segment of path.split("/")) {
    current = current.children.get(segment) ?? null;
    if (!current) return null;
  }
  return current;
}

function BranchContent(props: BranchContentProps) {
  const effectiveNode = () => compactToBranchingNode(props.branch.node);
  const subBranches = () => getChildBranches(effectiveNode());
  const shouldSplitBranches = () => props.depth < 3 && subBranches().length > 1;
  const subLayout = () => {
    const items: TreemapItem<DirectoryBranch>[] = subBranches().map((branch) => ({
      id: branch.dirPath,
      weight: branch.files.reduce((sum, file) => sum + file.size, 0),
      data: branch,
    }));
    return squarify(items, { x: 0, y: 0, w: props.pixelRect.w, h: props.pixelRect.h });
  };
  const fileLayout = () => {
    const items: TreemapItem<FileChurnMetric>[] = props.branch.files.map((file) => ({
      id: file.filePath,
      weight: file.size,
      data: file,
    }));
    return squarify(items, { x: 0, y: 0, w: props.pixelRect.w, h: props.pixelRect.h });
  };

  return (
    <div class={props.depth === 1 ? "treemap-dir-content" : "treemap-sub-content"}>
      <Show
        when={shouldSplitBranches()}
        fallback={
          <For each={fileLayout()}>
            {(fileRect) => {
              const file = fileRect.item.data;
              return (
                <div
                  class="treemap-file-tile"
                  style={{
                    left: `calc(${fileRect.x.toFixed(2)}% + 1.5px)`,
                    top: `calc(${fileRect.y.toFixed(2)}% + 1.5px)`,
                    width: `calc(${fileRect.w.toFixed(2)}% - 3px)`,
                    height: `calc(${fileRect.h.toFixed(2)}% - 3px)`,
                    background: file.color,
                    border: `1px solid ${file.borderColor}`,
                  }}
                  title={`${file.filePath}\n+${file.additions} / -${file.deletions} lines\nSize: max(${file.additions}, ${file.deletions}) = ${file.size}\nBalance: ${file.balanceTag}`}
                >
                  <div class="tile-content">
                    <div class="treemap-file-name">{file.fileName}</div>
                    <div class="treemap-file-meta">
                      <span>
                        +{file.additions} / -{file.deletions}
                      </span>
                      <span>size: {file.size}</span>
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        }
      >
        <For each={subLayout()}>
          {(subRect) => {
            const sub = subRect.item.data;
            const prefix = props.branch.dirPath ? `${props.branch.dirPath}/` : "";
            const shortName = sub.dirPath.startsWith(prefix)
              ? sub.dirPath.slice(prefix.length)
              : sub.dirPath;
            const pixelRect = {
              w: (subRect.w / 100) * props.pixelRect.w,
              h: (subRect.h / 100) * props.pixelRect.h,
            };

            return (
              <div
                class="treemap-sub-box"
                style={{
                  left: `calc(${subRect.x.toFixed(2)}% + 2px)`,
                  top: `calc(${subRect.y.toFixed(2)}% + 2px)`,
                  width: `calc(${subRect.w.toFixed(2)}% - 4px)`,
                  height: `calc(${subRect.h.toFixed(2)}% - 4px)`,
                }}
              >
                <div
                  class="treemap-sub-header"
                  title={`Click to zoom into ${sub.dirPath}`}
                  onClick={() => props.onZoom(sub.dirPath)}
                >
                  <span>📁 {shortName}</span>
                  <span class="dir-loc">{subRect.item.weight} LOC · Zoom ↗</span>
                </div>
                <BranchContent
                  branch={sub}
                  pixelRect={pixelRect}
                  depth={props.depth + 1}
                  onZoom={props.onZoom}
                />
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}

export default function TreemapOverview(props: TreemapOverviewProps) {
  const fileMetrics = createMemo(() => computeReplayMetrics(props.replay.steps));
  const totalMaxLoc = createMemo(() => fileMetrics().reduce((sum, file) => sum + file.size, 0));
  const totalAdditions = createMemo(() =>
    fileMetrics().reduce((sum, file) => sum + file.additions, 0),
  );
  const totalDeletions = createMemo(() =>
    fileMetrics().reduce((sum, file) => sum + file.deletions, 0),
  );
  const tree = createMemo(() => buildMetricTree(fileMetrics()));
  const dim = getCanvasDimensionHint();

  const targetNode = createMemo(() =>
    props.zoomedPath === null ? null : findNode(tree(), props.zoomedPath),
  );
  const effectiveTarget = createMemo(() => {
    const target = targetNode();
    return target ? compactToBranchingNode(target) : null;
  });
  const activeFiles = createMemo(() => {
    if (props.zoomedPath === null) return fileMetrics();
    return targetNode()
      ? collectDescendantFiles(targetNode()!)
      : fileMetrics().filter((file) => file.filePath.startsWith(props.zoomedPath!));
  });
  const activeWeight = createMemo(() => activeFiles().reduce((sum, file) => sum + file.size, 0));
  const activeAdditions = createMemo(() =>
    activeFiles().reduce((sum, file) => sum + file.additions, 0),
  );
  const activeDeletions = createMemo(() =>
    activeFiles().reduce((sum, file) => sum + file.deletions, 0),
  );
  const displayRoot = createMemo(() => compactToBranchingNode(tree()));
  const dirBranches = createMemo(() => getChildBranches(displayRoot()));
  const dirLayout = createMemo(() => {
    const items: TreemapItem<DirectoryBranch>[] = dirBranches().map((branch) => ({
      id: branch.dirPath,
      weight: branch.files.reduce((sum, file) => sum + file.size, 0),
      data: branch,
    }));
    return squarify(items, { x: 0, y: 0, w: dim.w, h: dim.h });
  });
  const targetBranch = createMemo<DirectoryBranch>(() => {
    const path = props.zoomedPath!;
    return {
      dirPath: path,
      node: effectiveTarget() ?? {
        name: path,
        fullPath: path,
        files: activeFiles(),
        children: new Map(),
      },
      files: activeFiles(),
    };
  });
  const displayTitle = createMemo(() => props.zoomedPath ?? "");
  const breadcrumbParts = createMemo(() => props.zoomedPath?.split("/") ?? []);

  return (
    <div class="overview-scroll">
      <section class="treemap-hero">
        <p class="eyebrow">STACK CHURN HEATMAP · MECHANICAL FOOTPRINT</p>
        <h1>Stack Overview</h1>
        <p>
          {props.zoomedPath !== null
            ? `Zoomed into folder: ${displayTitle()}`
            : "Mechanical diff footprint across touched files in this replay stack."}
        </p>
        <div class="treemap-stats-row">
          <span class="treemap-stat-badge">
            <span>Files:</span>
            <strong>{activeFiles().length}</strong>
          </span>
          <span class="treemap-stat-badge">
            <span>Max Churn LOC:</span>
            <strong>{props.zoomedPath === null ? totalMaxLoc() : activeWeight()} lines</strong>
          </span>
          <span class="treemap-stat-badge">
            <span>Total Additions:</span>
            <strong style={{ color: "#7ee787" }}>
              +{props.zoomedPath === null ? totalAdditions() : activeAdditions()}
            </strong>
          </span>
          <span class="treemap-stat-badge">
            <span>Total Deletions:</span>
            <strong style={{ color: "#ffa198" }}>
              -{props.zoomedPath === null ? totalDeletions() : activeDeletions()}
            </strong>
          </span>
        </div>
      </section>

      <Show
        when={props.zoomedPath !== null}
        fallback={
          <nav class="treemap-breadcrumb-bar">
            <div class="breadcrumb-path">
              <span class="breadcrumb-active">📁 All Folders (Root)</span>
              <span class="breadcrumb-hint">Click any folder header to zoom in</span>
            </div>
          </nav>
        }
      >
        <nav class="treemap-breadcrumb-bar">
          <div class="breadcrumb-path">
            <button class="breadcrumb-btn" onClick={() => props.onZoom(null)}>
              📁 All Folders
            </button>
            <For each={breadcrumbParts()}>
              {(part, index) => {
                const ancestorPath = () =>
                  breadcrumbParts()
                    .slice(0, index() + 1)
                    .join("/");
                return (
                  <>
                    <span class="breadcrumb-sep">/</span>
                    <Show
                      when={index() < breadcrumbParts().length - 1}
                      fallback={<span class="breadcrumb-active">{part}</span>}
                    >
                      <button class="breadcrumb-btn" onClick={() => props.onZoom(ancestorPath())}>
                        {part}
                      </button>
                    </Show>
                  </>
                );
              }}
            </For>
          </div>
          <button class="breadcrumb-back-btn" onClick={() => props.onZoom(null)}>
            ← Back to all folders (Esc)
          </button>
        </nav>
      </Show>

      <section class="spectrum-legend-card">
        <div class="spectrum-legend-top">
          <span>MECHANICAL RATIO: r = (Additions - Deletions) / (Additions + Deletions)</span>
          <span>Size: max(Additions, Deletions)</span>
        </div>
        <div class="spectrum-legend-bar" />
        <div class="spectrum-legend-ticks">
          <span style={{ color: "#ffa198" }}>-1.0 (100% Deletion · Bright Red)</span>
          <span style={{ color: "#e5e7eb", "font-weight": 600 }}>
            0.0 (50% Add / 50% Del · Neutral Gray)
          </span>
          <span style={{ color: "#7ee787" }}>+1.0 (100% Addition · Bright Green)</span>
        </div>
      </section>

      <div class="treemap-canvas">
        <Show
          when={props.zoomedPath !== null}
          fallback={
            <For each={dirLayout()}>
              {(dirRect) => {
                const branch = dirRect.item.data;
                return (
                  <div
                    class="treemap-dir-box"
                    style={{
                      left: `calc(${dirRect.x.toFixed(2)}% + 3px)`,
                      top: `calc(${dirRect.y.toFixed(2)}% + 3px)`,
                      width: `calc(${dirRect.w.toFixed(2)}% - 6px)`,
                      height: `calc(${dirRect.h.toFixed(2)}% - 6px)`,
                    }}
                  >
                    <div
                      class="treemap-dir-header is-clickable"
                      title={`Click to zoom into ${branch.dirPath}`}
                      onClick={() => props.onZoom(branch.dirPath)}
                    >
                      <span>📁 {branch.dirPath}</span>
                      <span class="dir-loc">{dirRect.item.weight} LOC · Zoom ↗</span>
                    </div>
                    <BranchContent
                      branch={branch}
                      pixelRect={{ w: (dirRect.w / 100) * dim.w, h: (dirRect.h / 100) * dim.h }}
                      depth={1}
                      onZoom={(path) => props.onZoom(path)}
                    />
                  </div>
                );
              }}
            </For>
          }
        >
          <div
            class="treemap-dir-box"
            style={{
              left: "3px",
              top: "3px",
              width: "calc(100% - 6px)",
              height: "calc(100% - 6px)",
            }}
          >
            <div class="treemap-dir-header" title={displayTitle()}>
              <span>📁 {displayTitle()}</span>
              <span class="dir-loc">{activeWeight()} LOC · Zoomed View</span>
            </div>
            <BranchContent
              branch={targetBranch()}
              pixelRect={dim}
              depth={1}
              onZoom={(path) => props.onZoom(path)}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}

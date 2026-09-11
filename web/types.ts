export type {
  AtomicStep,
  Replay,
  ReplaySummary,
  ReviewNote,
  StepStatus,
} from "../src/contracts.js";

export interface FileChurnMetric {
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

export interface TreemapItem<T> {
  id: string;
  weight: number;
  data: T;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult<T> extends Rect {
  item: TreemapItem<T>;
}

export interface TreeNode {
  name: string;
  fullPath: string;
  files: FileChurnMetric[];
  children: Map<string, TreeNode>;
}

export interface DirectoryBranch {
  dirPath: string;
  node: TreeNode;
  files: FileChurnMetric[];
}

export interface ParsedFile {
  path: string;
  hunks: ParsedHunk[];
}

export interface ParsedHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: ParsedLine[];
}

export interface ParsedLine {
  type: "add" | "delete" | "context";
  content: string;
}

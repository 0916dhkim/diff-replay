import type { Replay, StepStatus } from "./types.js";

const STORAGE_WARNING =
  "Review progress could not be saved in this browser. Approvals will not change until storage is available.";
const INVALID_WARNING =
  "Saved review progress is invalid. Showing the exported snapshot instead; the next change will replace it.";

type Statuses = Record<string, StepStatus>;

function contentIdentity(replay: Replay): string {
  return JSON.stringify(replay.steps.map((step) => [step.stepId, step.diffHash]));
}

export function reviewStorageKey(replay: Replay): string {
  const identity = contentIdentity(replay);
  // Keep localStorage keys short even for very large replays. The stored identity is
  // compared in full on read, so a hash collision cannot load unrelated progress.
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < identity.length; i += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(identity.charCodeAt(i))) * 0x100000001b3n);
  }
  return `diff-replay:offline:${replay.id}:${hash.toString(16).padStart(16, "0")}`;
}

export function loadOfflineStatuses(replay: Replay): {
  statuses: Statuses;
  warning: string | null;
  canWrite: boolean;
} {
  const snapshot = { ...replay.state.stepStatus };
  let value: string | null;
  try {
    value = window.localStorage.getItem(reviewStorageKey(replay));
  } catch {
    return { statuses: snapshot, warning: STORAGE_WARNING, canWrite: false };
  }
  if (value === null) {
    return { statuses: snapshot, warning: null, canWrite: true };
  }

  try {
    const saved: unknown = JSON.parse(value);
    if (typeof saved !== "object" || saved === null || Array.isArray(saved)) {
      throw new Error("Invalid saved progress");
    }
    if (
      !("version" in saved) ||
      saved.version !== 1 ||
      !("identity" in saved) ||
      saved.identity !== contentIdentity(replay)
    ) {
      throw new Error("Saved progress belongs to a different replay");
    }
    if (
      !("stepStatus" in saved) ||
      typeof saved.stepStatus !== "object" ||
      saved.stepStatus === null ||
      Array.isArray(saved.stepStatus)
    ) {
      throw new Error("Invalid saved statuses");
    }
    const validIds = new Set(replay.steps.map((step) => step.stepId));
    const statuses: Statuses = {};
    for (const [id, status] of Object.entries(saved.stepStatus)) {
      if (!validIds.has(id) || (status !== "approved" && status !== "flagged")) {
        throw new Error("Invalid saved status");
      }
      statuses[id] = status;
    }
    return { statuses, warning: null, canWrite: true };
  } catch {
    return { statuses: snapshot, warning: INVALID_WARNING, canWrite: true };
  }
}

export function saveOfflineStatuses(replay: Replay, statuses: Statuses): boolean {
  try {
    window.localStorage.setItem(
      reviewStorageKey(replay),
      JSON.stringify({ version: 1, identity: contentIdentity(replay), stepStatus: statuses }),
    );
    return true;
  } catch {
    return false;
  }
}

export { STORAGE_WARNING };

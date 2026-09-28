import { afterEach, describe, expect, it, vi } from "vitest";

import type { Replay } from "../src/contracts.js";
import {
  loadOfflineStatuses,
  reviewStorageKey,
  saveOfflineStatuses,
} from "../web/offline-storage.js";

const replay: Replay = {
  id: "0123456789abcdef",
  sourceKey: "repo#one",
  title: "One step",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
  steps: [
    {
      stepId: "one",
      diffHash: "a".repeat(64),
      action: "Add one",
      takeaway: "One added",
      risk: "Low",
      diff: "+one",
      filePath: "one.ts",
      fileName: "one.ts",
      isCodegen: false,
      isTest: false,
    },
  ],
  state: { activeStepId: "one", stepStatus: { one: "approved" }, notes: [] },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline approval persistence", () => {
  it("seeds from the export and restores saved approvals, including unapprovals", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    expect(loadOfflineStatuses(replay).statuses).toEqual({ one: "approved" });
    expect(saveOfflineStatuses(replay, {})).toBe(true);
    expect(loadOfflineStatuses(replay)).toMatchObject({ statuses: {}, warning: null });
  });

  it("isolates content revisions and refuses invalid saved state", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    expect(saveOfflineStatuses(replay, { one: "flagged" })).toBe(true);
    const revised = {
      ...replay,
      steps: [{ ...replay.steps[0]!, diffHash: "b".repeat(64) }],
    };
    expect(reviewStorageKey(revised)).not.toBe(reviewStorageKey(replay));
    expect(loadOfflineStatuses(revised).statuses).toEqual({ one: "approved" });
    stored.set(reviewStorageKey(replay), '{"version":1,"identity":"other","stepStatus":{}}');
    expect(loadOfflineStatuses(replay)).toMatchObject({
      statuses: { one: "approved" },
      canWrite: true,
    });
    expect(loadOfflineStatuses(replay).warning).toContain("invalid");
  });

  it("reports unavailable storage rather than claiming the approval persisted", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(loadOfflineStatuses(replay)).toMatchObject({
      statuses: { one: "approved" },
      canWrite: false,
    });
    expect(saveOfflineStatuses(replay, {})).toBe(false);
  });
});

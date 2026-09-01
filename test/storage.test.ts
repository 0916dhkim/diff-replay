import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReplayStore, replayIdForSource } from "../src/storage.js";
import { computeCanonicalDiffHash } from "../src/review-content-hash.js";
import { makeReplay, makeStep } from "./fixtures.js";

describe("ReplayStore", () => {
  let directory: string;
  let store: ReplayStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "diff-replay-test-"));
    store = new ReplayStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps concurrent replays isolated", async () => {
    const first = await store.sync(makeReplay("repo#101", "First replay"));
    const second = await store.sync(makeReplay("repo#102", "Second replay"));

    await store.setStepStatus(first.id, "1.1", "approved");
    await store.addNote(second.id, "Check this separately", "1.1");

    expect((await store.get(first.id)).state.stepStatus).toEqual({ "1.1": "approved" });
    expect((await store.get(first.id)).state.notes).toEqual([]);
    expect((await store.get(second.id)).state.stepStatus).toEqual({});
    expect((await store.get(second.id)).state.notes).toHaveLength(1);
    expect(await store.list()).toHaveLength(2);
  });

  it("upserts a source key and preserves only unchanged step decisions", async () => {
    const input = makeReplay("repo#101");
    input.steps.push(makeStep("1.2", "+const second = true;"));
    const original = await store.sync(input);
    await store.setStepStatus(original.id, "1.1", "approved");
    await store.setStepStatus(original.id, "1.2", "flagged");
    await store.addNote(original.id, "Retain this feedback", "1.2");

    const updated = makeReplay("repo#101");
    updated.steps = [makeStep("1.1", "+const answer = 42;"), makeStep("1.2", "+changed")];
    const synchronized = await store.sync(updated);

    expect(synchronized.id).toBe(original.id);
    expect(synchronized.state.stepStatus).toEqual({ "1.1": "approved" });
    expect(synchronized.state.notes).toHaveLength(1);
  });

  it("serializes concurrent state mutations for one replay", async () => {
    const input = makeReplay("repo#101");
    input.steps.push(makeStep("1.2", "+const second = true;"));
    const replay = await store.sync(input);

    await Promise.all([
      store.setStepStatus(replay.id, "1.1", "approved"),
      store.setStepStatus(replay.id, "1.2", "flagged"),
    ]);

    expect((await store.get(replay.id)).state.stepStatus).toEqual({
      "1.1": "approved",
      "1.2": "flagged",
    });
  });

  it("serializes mutations from separate store instances", async () => {
    const input = makeReplay("repo#101");
    input.steps.push(makeStep("1.2", "+const second = true;"));
    const replay = await store.sync(input);
    const secondStore = new ReplayStore(directory);

    await Promise.all([
      store.setStepStatus(replay.id, "1.1", "approved"),
      secondStore.setStepStatus(replay.id, "1.2", "flagged"),
    ]);

    expect((await store.get(replay.id)).state.stepStatus).toEqual({
      "1.1": "approved",
      "1.2": "flagged",
    });
  });

  it("rejects replay IDs before resolving storage paths", async () => {
    await expect(store.get("../outside-replay")).rejects.toThrow("Invalid replay ID");
  });

  it("preserves statuses for step IDs that match object prototype properties", async () => {
    const input = makeReplay("repo#prototype-key");
    input.steps = [makeStep("toString", "+safe key")];
    const replay = await store.sync(input);
    await store.setStepStatus(replay.id, "toString", "approved");

    const synchronized = await store.sync(input);

    expect(synchronized.state.stepStatus).toEqual({ toString: "approved" });
  });

  it("lists valid replays when another snapshot is corrupt", async () => {
    const valid = await store.sync(makeReplay("repo#valid"));
    const corruptId = "0000000000000000";
    const corruptDirectory = path.join(directory, "replays", corruptId);
    await mkdir(corruptDirectory);
    await writeFile(path.join(corruptDirectory, "replay.json"), "{}");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await store.list()).map((replay) => replay.id)).toEqual([valid.id]);
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("recovers a lock owned by a process that no longer exists", async () => {
    const sourceKey = "repo#orphaned-lock";
    const replayId = replayIdForSource(sourceKey);
    const lockDirectory = path.join(directory, "replays", `${replayId}.lock`);
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      path.join(lockDirectory, "owner.json"),
      JSON.stringify({ pid: 2_147_483_647, token: "orphan" }),
    );

    await expect(store.sync(makeReplay(sourceKey))).resolves.toMatchObject({ id: replayId });
  });

  it("rejects snapshots whose identity does not match their directory", async () => {
    const replay = await store.sync(makeReplay("repo#identity"));
    const mismatchedId = "0000000000000000";
    const mismatchedDirectory = path.join(directory, "replays", mismatchedId);
    await mkdir(mismatchedDirectory);
    await writeFile(
      path.join(mismatchedDirectory, "replay.json"),
      await readFile(path.join(directory, "replays", replay.id, "replay.json")),
    );

    await expect(store.get(mismatchedId)).rejects.toThrow("snapshot identity mismatch");
  });

  it("ignores producer-supplied diffHash and persists canonical hash", async () => {
    const input = makeReplay("repo#hash-override");
    input.steps = [
      {
        ...makeStep("1.1", "+const calculated = true;"),
        diffHash: "ffffffffffffffff",
      },
    ];

    const synchronized = await store.sync(input);
    const expectedHash = computeCanonicalDiffHash({
      filePath: "src/1.1.ts",
      diff: "+const calculated = true;",
    });

    expect(synchronized.steps[0]!.diffHash).toBe(expectedHash);
    expect(synchronized.steps[0]!.diffHash).not.toBe("ffffffffffffffff");
  });

  it("migrates legacy snapshots and preserves approved and flagged decisions across volatile diff changes", async () => {
    const sourceKey = "repo#migration";
    const replayId = replayIdForSource(sourceKey);
    const replayDirectory = path.join(directory, "replays", replayId);
    await mkdir(replayDirectory, { recursive: true });

    const legacyDiff1 = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " old context 1",
      "+const answer = 42;",
      " old context 2",
    ].join("\n");

    const legacyDiff2 = [
      "diff --git a/src/b.ts b/src/b.ts",
      "index 3333333..4444444 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,3 +1,4 @@",
      " old context 3",
      "+const flagMe = true;",
      " old context 4",
    ].join("\n");

    const legacySnapshot = {
      id: replayId,
      sourceKey,
      title: "Legacy Replay",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      steps: [
        {
          stepId: "1.1",
          diffHash: "aaaaaaaaaaaaaaaa",
          action: "Step 1",
          takeaway: "Takeaway 1",
          risk: "Low",
          diff: legacyDiff1,
          filePath: "src/a.ts",
          fileName: "a.ts",
          isCodegen: false,
          isTest: false,
        },
        {
          stepId: "1.2",
          diffHash: "bbbbbbbbbbbbbbbb",
          action: "Step 2",
          takeaway: "Takeaway 2",
          risk: "Medium",
          diff: legacyDiff2,
          filePath: "src/b.ts",
          fileName: "b.ts",
          isCodegen: false,
          isTest: false,
        },
      ],
      state: {
        activeStepId: "1.1",
        stepStatus: {
          "1.1": "approved",
          "1.2": "flagged",
        },
        notes: [],
      },
    };

    await writeFile(
      path.join(replayDirectory, "replay.json"),
      JSON.stringify(legacySnapshot, null, 2),
    );

    const shiftedDiff1 = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 9999999..8888888 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -100,5 +100,6 @@ function shifted() {",
      " shifted context line",
      "+const answer = 42;",
      " trailing context",
    ].join("\r\n");

    const shiftedDiff2 = [
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -200,3 +200,4 @@",
      " different context line",
      "+const flagMe = true;",
    ].join("\n");

    const incoming = {
      sourceKey,
      title: "Migrated Replay",
      steps: [
        {
          stepId: "1.1",
          action: "Step 1",
          takeaway: "Takeaway 1",
          risk: "Low",
          diff: shiftedDiff1,
          filePath: "src/a.ts",
          fileName: "a.ts",
          isCodegen: false,
          isTest: false,
        },
        {
          stepId: "1.2",
          action: "Step 2",
          takeaway: "Takeaway 2",
          risk: "Medium",
          diff: shiftedDiff2,
          filePath: "src/b.ts",
          fileName: "b.ts",
          isCodegen: false,
          isTest: false,
        },
      ],
    };

    const synchronized = await store.sync(incoming);

    expect(synchronized.state.stepStatus).toEqual({
      "1.1": "approved",
      "1.2": "flagged",
    });

    const canonical1 = computeCanonicalDiffHash({ filePath: "src/a.ts", diff: shiftedDiff1 });
    const canonical2 = computeCanonicalDiffHash({ filePath: "src/b.ts", diff: shiftedDiff2 });

    expect(synchronized.steps[0]!.diffHash).toBe(canonical1);
    expect(synchronized.steps[1]!.diffHash).toBe(canonical2);
  });

  it("resets review status when reviewed additions or removals actually change", async () => {
    const input = makeReplay("repo#actual-change");
    input.steps = [makeStep("1.1", "+const value = 1;")];
    const initial = await store.sync(input);
    await store.setStepStatus(initial.id, "1.1", "approved");

    const updated = makeReplay("repo#actual-change");
    updated.steps = [makeStep("1.1", "+const value = 2;")];
    const synchronized = await store.sync(updated);

    expect(synchronized.state.stepStatus).toEqual({});
  });
});

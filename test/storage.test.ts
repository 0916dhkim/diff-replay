import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReplayStore, replayIdForSource } from "../src/storage.js";
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
});

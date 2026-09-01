import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Replay } from "../src/contracts.js";
import { createApp } from "../src/server.js";
import { ReplayStore } from "../src/storage.js";
import { makeReplay } from "./fixtures.js";

describe("replay API", () => {
  let app: FastifyInstance;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "diff-replay-api-test-"));
    app = await createApp({ store: new ReplayStore(directory), publicDirectory: null });
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("publishes and updates independent replays", async () => {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/replays",
      payload: makeReplay("repo#101"),
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/replays",
      payload: makeReplay("repo#102"),
    });
    const first = firstResponse.json<{ replay: Replay }>().replay;
    const second = secondResponse.json<{ replay: Replay }>().replay;

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(first.id).not.toBe(second.id);

    await app.inject({
      method: "PATCH",
      url: `/api/replays/${first.id}/steps/1.1`,
      payload: { status: "approved" },
    });
    const firstRead = await app.inject({ method: "GET", url: `/api/replays/${first.id}` });
    const secondRead = await app.inject({ method: "GET", url: `/api/replays/${second.id}` });

    expect(firstRead.json<{ replay: Replay }>().replay.state.stepStatus).toEqual({
      "1.1": "approved",
    });
    expect(secondRead.json<{ replay: Replay }>().replay.state.stepStatus).toEqual({});
  });

  it("adds and deletes notes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/replays",
      payload: makeReplay("repo#notes"),
    });
    const replay = created.json<{ replay: Replay }>().replay;
    const added = await app.inject({
      method: "POST",
      url: `/api/replays/${replay.id}/notes`,
      payload: { text: "looks wrong", stepId: "1.1" },
    });
    const noteId = added.json<{ replay: Replay }>().replay.state.notes[0]!.id;
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/replays/${replay.id}/notes/${noteId}`,
    });

    expect(added.statusCode).toBe(201);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json<{ replay: Replay }>().replay.state.notes).toEqual([]);
  });

  it("rejects state updates for unknown steps", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/replays",
      payload: makeReplay("repo#101"),
    });
    const replay = created.json<{ replay: Replay }>().replay;
    const response = await app.inject({
      method: "PATCH",
      url: `/api/replays/${replay.id}/steps/missing`,
      payload: { status: "approved" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid replay IDs and duplicate step IDs", async () => {
    const traversal = await app.inject({ method: "GET", url: "/api/replays/%2e%2e%2f" });
    const duplicate = makeReplay("repo#duplicate");
    duplicate.steps.push(duplicate.steps[0]!);
    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/api/replays",
      payload: duplicate,
    });

    expect(traversal.statusCode).toBe(400);
    expect(duplicateResponse.statusCode).toBe(400);
  });

  it("accepts manifests larger than Fastify's default limit", async () => {
    const replay = makeReplay("repo#large");
    replay.steps[0]!.diff = "x".repeat(1_100_000);
    const response = await app.inject({
      method: "POST",
      url: "/api/replays",
      payload: replay,
    });

    expect(response.statusCode).toBe(201);
  });

  it("preserves client status codes for malformed JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/replays",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
  });

  it("serves the production UI and replay routes", async () => {
    const publicDirectory = path.join(directory, "public");
    await mkdir(publicDirectory);
    await writeFile(path.join(publicDirectory, "index.html"), "<title>Diff Replay</title>");
    const productionApp = await createApp({
      store: new ReplayStore(path.join(directory, "production")),
      publicDirectory,
    });

    try {
      expect((await productionApp.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
      expect(
        (await productionApp.inject({ method: "GET", url: "/replays/0123456789abcdef" }))
          .statusCode,
      ).toBe(200);
    } finally {
      await productionApp.close();
    }
  });

  it("accepts a manifest without diffHash and returns derived canonical hashes", async () => {
    const payload = {
      sourceKey: "repo#no-diff-hash",
      title: "Replay Without Producer Hashes",
      steps: [
        {
          stepId: "step-1",
          action: "Add greeting",
          takeaway: "Greeting function added",
          risk: "Low",
          diff: "+export const hello = () => 'world';",
          filePath: "src/hello.ts",
          fileName: "hello.ts",
          isCodegen: false,
          isTest: false,
        },
      ],
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/replays",
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ replay: Replay }>();
    expect(body.replay.steps[0]!.diffHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

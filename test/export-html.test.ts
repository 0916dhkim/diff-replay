import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderOfflineHtml } from "../src/export-html.js";
import type { Replay } from "../src/contracts.js";

describe("offline HTML export", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("embeds assets and replay safely without external dependencies or notes", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "diff-replay-export-test-"));
    await mkdir(path.join(directory, "assets"));
    await writeFile(
      path.join(directory, "offline.html"),
      '<!doctype html><html><head><link rel="stylesheet" crossorigin href="/assets/offline.css"></head><body><div id="app"></div><script type="module" crossorigin src="/assets/offline.js"></script></body></html>',
    );
    await writeFile(
      path.join(directory, "assets/offline.css"),
      '@import url("https://fonts.googleapis.com/css2?family=Manrope");body{color:red}',
    );
    await writeFile(path.join(directory, "assets/offline.js"), 'document.title="Offline";');

    const replay = {
      id: "0123456789abcdef",
      title: "</script><img src=x onerror=alert(1)>",
      state: {
        activeStepId: "one",
        stepStatus: { one: "approved" },
        notes: [{ text: "private note" }],
      },
      steps: [
        { stepId: "one", diffHash: "a".repeat(64), diff: "</script><script>alert(1)</script>" },
      ],
    } as unknown as Replay;

    const html = await renderOfflineHtml(directory, replay);
    expect(html).not.toContain('src="/assets/');
    expect(html).not.toContain('href="/assets/');
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("private note");
    expect(html).not.toContain("</script><img src=x onerror=alert(1)>");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).toContain('"stepStatus":{"one":"approved"}');
    expect(html).toContain("body{color:red}");
    expect(html).toContain('document.title="Offline";');
  });

  it("inlines a minified bundle without expanding replacement tokens", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "diff-replay-export-test-"));
    await mkdir(path.join(directory, "assets"));
    await writeFile(
      path.join(directory, "offline.html"),
      '<link rel="stylesheet" crossorigin href="/assets/offline.css"><script type="module" crossorigin src="/assets/offline.js"></script>',
    );
    await writeFile(
      path.join(directory, "assets/offline.css"),
      '@import "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500&display=swap";body{color:red}',
    );
    await writeFile(path.join(directory, "assets/offline.js"), 'const source="$& $` $\'";');
    const replay = {
      id: "0123456789abcdef",
      state: { activeStepId: "one", stepStatus: {}, notes: [] },
      steps: [],
    } as unknown as Replay;
    const html = await renderOfflineHtml(directory, replay);
    expect(html).toContain('const source="$& $` $\'";');
    expect(html).not.toContain('src="/assets/');
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("rejects a missing offline build rather than returning a broken download", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "diff-replay-export-test-"));
    await writeFile(path.join(directory, "offline.html"), "<html></html>");
    await expect(renderOfflineHtml(directory, {} as Replay)).rejects.toThrow(
      "Offline viewer build assets are missing",
    );
  });
});

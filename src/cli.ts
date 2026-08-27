#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { replayInputSchema } from "./contracts.js";
import { createApp } from "./server.js";
import { ReplayStore } from "./storage.js";

const command = process.argv[2] ?? "serve";
const arguments_ = process.argv.slice(3);

if (command === "serve") {
  await serve(arguments_);
} else if (command === "publish") {
  await publish(arguments_);
} else {
  printUsage();
  process.exitCode = 1;
}

async function serve(args: string[]): Promise<void> {
  const port = Number(readOption(args, "--port") ?? process.env.DIFF_REPLAY_PORT ?? 7890);
  const host = readOption(args, "--host") ?? process.env.DIFF_REPLAY_HOST ?? "127.0.0.1";
  const dataDirectory =
    readOption(args, "--data-dir") ??
    process.env.DIFF_REPLAY_DATA_DIR ??
    path.join(os.homedir(), ".diff-replay");
  const apiOnly = args.includes("--api-only");
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const app = await createApp({
    store: new ReplayStore(dataDirectory),
    publicDirectory: apiOnly ? null : path.join(moduleDirectory, "public"),
    logger: true,
  });
  await app.listen({ host, port });
  console.log(`Diff Replay is running at http://${host}:${port}`);
}

async function publish(args: string[]): Promise<void> {
  const manifestPath = args.find((argument) => !argument.startsWith("--"));
  if (!manifestPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const server = readOption(args, "--server") ?? "http://127.0.0.1:7890";
  const manifest = replayInputSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const response = await fetch(`${server}/api/replays`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(manifest),
  });
  if (!response.ok) {
    throw new Error(`Diff Replay returned ${response.status}: ${await response.text()}`);
  }
  const result = (await response.json()) as { url: string };
  console.log(new URL(result.url, server).toString());
}

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

function printUsage(): void {
  console.log(`Usage:
  diff-replay serve [--host 127.0.0.1] [--port 7890] [--data-dir ~/.diff-replay] [--api-only]
  diff-replay publish <manifest.json> [--server http://127.0.0.1:7890]`);
}

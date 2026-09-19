#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./server.js";
import { ReplayStore } from "./storage.js";

const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("-") ? rawArgs[0] : "serve";
const arguments_ = rawArgs[0] && !rawArgs[0].startsWith("-") ? rawArgs.slice(1) : rawArgs;

if (command === "serve") {
  await serve(arguments_);
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

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

function printUsage(): void {
  console.log(`Usage:
  diff-replay [serve] [--host 127.0.0.1] [--port 7890] [--data-dir ~/.diff-replay] [--api-only]`);
}

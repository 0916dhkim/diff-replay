import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { replaySchema } from "./contracts.js";
import type {
  AtomicStep,
  Replay,
  ReplayInput,
  ReplayMetadata,
  ReplayState,
  ReplaySummary,
  ReviewNote,
  StepStatus,
} from "./contracts.js";

export class ReplayNotFoundError extends Error {}
export class InvalidReplayMutationError extends Error {}

export class ReplayStore {
  readonly rootDirectory: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory;
  }

  async initialize(): Promise<void> {
    await mkdir(this.replaysDirectory(), { recursive: true });
  }

  async sync(input: ReplayInput): Promise<Replay> {
    const id = replayIdForSource(input.sourceKey);
    return this.withReplayLock(id, async () => {
      const existing = await this.readReplayOrNull(id);
      if (existing && existing.sourceKey !== input.sourceKey) {
        throw new InvalidReplayMutationError("Replay ID collision detected");
      }

      const now = new Date().toISOString();
      const metadata: ReplayMetadata = {
        id,
        sourceKey: input.sourceKey,
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.repository ? { repository: input.repository } : {}),
        ...(input.baseRef ? { baseRef: input.baseRef } : {}),
        ...(input.headRef ? { headRef: input.headRef } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const replay: Replay = {
        ...metadata,
        steps: input.steps,
        state: synchronizeState(existing, input.steps),
      };
      await mkdir(this.replayDirectory(id), { recursive: true });
      await writeJsonAtomically(this.replayPath(id), replay);
      return replay;
    });
  }

  async get(id: string): Promise<Replay> {
    const replay = await this.readReplayOrNull(id);
    if (!replay) throw new ReplayNotFoundError(`Replay ${id} was not found`);
    return replay;
  }

  async list(): Promise<ReplaySummary[]> {
    await this.initialize();
    const entries = await readdir(this.replaysDirectory(), { withFileTypes: true });
    const results = await Promise.allSettled(
      entries
        .filter((entry) => entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name))
        .map((entry) => this.readReplayOrNull(entry.name)),
    );
    const replays = results.flatMap((result) => {
      if (result.status === "fulfilled") return result.value ? [result.value] : [];
      console.error("Skipping unreadable replay snapshot", result.reason);
      return [];
    });
    return replays
      .map((replay) => ({
        id: replay.id,
        sourceKey: replay.sourceKey,
        title: replay.title,
        ...(replay.description ? { description: replay.description } : {}),
        ...(replay.repository ? { repository: replay.repository } : {}),
        ...(replay.baseRef ? { baseRef: replay.baseRef } : {}),
        ...(replay.headRef ? { headRef: replay.headRef } : {}),
        createdAt: replay.createdAt,
        updatedAt: replay.updatedAt,
        totalSteps: replay.steps.length,
        approvedSteps: Object.values(replay.state.stepStatus).filter(
          (status) => status === "approved",
        ).length,
        flaggedSteps: Object.values(replay.state.stepStatus).filter(
          (status) => status === "flagged",
        ).length,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async setActiveStep(id: string, activeStepId: string): Promise<Replay> {
    return this.mutateState(id, (replay) => {
      if (!replay.steps.some((step) => step.stepId === activeStepId)) {
        throw new InvalidReplayMutationError(`Step ${activeStepId} does not exist`);
      }
      replay.state.activeStepId = activeStepId;
    });
  }

  async setStepStatus(id: string, stepId: string, status: StepStatus | null): Promise<Replay> {
    return this.mutateState(id, (replay) => {
      if (!replay.steps.some((step) => step.stepId === stepId)) {
        throw new InvalidReplayMutationError(`Step ${stepId} does not exist`);
      }
      if (status) replay.state.stepStatus[stepId] = status;
      else delete replay.state.stepStatus[stepId];
    });
  }

  async addNote(id: string, text: string, stepId?: string): Promise<Replay> {
    return this.mutateState(id, (replay) => {
      if (stepId && !replay.steps.some((step) => step.stepId === stepId)) {
        throw new InvalidReplayMutationError(`Step ${stepId} does not exist`);
      }
      const note: ReviewNote = {
        id: randomUUID(),
        text,
        ...(stepId ? { stepId } : {}),
        createdAt: new Date().toISOString(),
      };
      replay.state.notes.push(note);
    });
  }

  async deleteNote(id: string, noteId: string): Promise<Replay> {
    return this.mutateState(id, (replay) => {
      replay.state.notes = replay.state.notes.filter((note) => note.id !== noteId);
    });
  }

  private async mutateState(id: string, mutation: (replay: Replay) => void): Promise<Replay> {
    assertReplayId(id);
    return this.withReplayLock(id, async () => {
      const replay = await this.get(id);
      mutation(replay);
      replay.updatedAt = new Date().toISOString();
      await writeJsonAtomically(this.replayPath(id), replay);
      return replay;
    });
  }

  private async readReplayOrNull(id: string): Promise<Replay | null> {
    assertReplayId(id);
    try {
      const replay = replaySchema.parse(JSON.parse(await readFile(this.replayPath(id), "utf8")));
      if (replay.id !== id || replayIdForSource(replay.sourceKey) !== id) {
        throw new Error(`Replay snapshot identity mismatch for ${id}`);
      }
      return replay;
    } catch (error) {
      if (isFileError(error, "ENOENT")) return null;
      throw error;
    }
  }

  private async withReplayLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return this.withLock(id, async () => {
      await this.initialize();
      const lockPath = path.join(this.replaysDirectory(), `${id}.lock`);
      const releaseFileLock = await acquireFileLock(lockPath);
      try {
        return await operation();
      } finally {
        await releaseFileLock();
      }
    });
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.locks.set(id, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }

  private replaysDirectory(): string {
    return path.join(this.rootDirectory, "replays");
  }

  private replayPath(id: string): string {
    assertReplayId(id);
    return path.join(this.replayDirectory(id), "replay.json");
  }

  private replayDirectory(id: string): string {
    assertReplayId(id);
    return path.join(this.replaysDirectory(), id);
  }
}

export function replayIdForSource(sourceKey: string): string {
  return createHash("sha256").update(sourceKey).digest("hex").slice(0, 16);
}

function synchronizeState(existing: Replay | null, steps: AtomicStep[]): ReplayState {
  const priorHashes = new Map(existing?.steps.map((step) => [step.stepId, step.diffHash]) ?? []);
  const stepStatus: Record<string, StepStatus> = {};
  for (const step of steps) {
    const priorStatus =
      existing && Object.hasOwn(existing.state.stepStatus, step.stepId)
        ? existing.state.stepStatus[step.stepId]
        : undefined;
    if (priorStatus && priorHashes.get(step.stepId) === step.diffHash) {
      stepStatus[step.stepId] = priorStatus;
    }
  }
  const activeStepId = steps.some((step) => step.stepId === existing?.state.activeStepId)
    ? existing!.state.activeStepId
    : steps[0]!.stepId;
  return {
    activeStepId,
    stepStatus,
    notes: existing?.state.notes ?? [],
  };
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function assertReplayId(id: string): void {
  if (!/^[a-f0-9]{16}$/.test(id)) {
    throw new InvalidReplayMutationError("Invalid replay ID");
  }
}

async function acquireFileLock(lockPath: string): Promise<() => Promise<void>> {
  const timeoutAt = Date.now() + 10_000;
  const token = randomUUID();
  const ownerPath = path.join(lockPath, "owner.json");
  const candidatePath = `${lockPath}.${token}.candidate`;
  await mkdir(candidatePath);
  await writeFile(
    path.join(candidatePath, "owner.json"),
    JSON.stringify({ pid: process.pid, token }),
    "utf8",
  );
  while (true) {
    try {
      await rename(candidatePath, lockPath);
    } catch (error) {
      if (!isFileError(error, "EEXIST") && !isFileError(error, "ENOTEMPTY")) {
        await rm(candidatePath, { recursive: true, force: true });
        throw error;
      }
      const owner = await readLockOwner(ownerPath);
      if (owner && !isProcessAlive(owner.pid)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= timeoutAt) {
        await rm(candidatePath, { recursive: true, force: true });
        throw new InvalidReplayMutationError("Timed out waiting for replay lock");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    return async () => {
      const owner = await readLockOwner(ownerPath);
      if (owner?.token === token) await rm(lockPath, { recursive: true, force: true });
    };
  }
}

async function readLockOwner(ownerPath: string): Promise<{ pid: number; token: string } | null> {
  try {
    const value = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
    if (
      value &&
      typeof value === "object" &&
      "pid" in value &&
      typeof value.pid === "number" &&
      "token" in value &&
      typeof value.token === "string"
    ) {
      return { pid: value.pid, token: value.token };
    }
  } catch (error) {
    if (!isFileError(error, "ENOENT") && !(error instanceof SyntaxError)) throw error;
  }
  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isFileError(error, "ESRCH");
  }
}

function isFileError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

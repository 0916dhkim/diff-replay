import type { AtomicStepInput, ReplayInput } from "../src/contracts.js";

export function makeReplay(sourceKey: string, title = sourceKey): ReplayInput {
  return {
    sourceKey,
    title,
    repository: "example/repository",
    steps: [makeStep("1.1", "+const answer = 42;")],
  };
}

export function makeStep(stepId: string, diff: string): AtomicStepInput {
  return {
    stepId,
    action: `Update ${stepId}`,
    takeaway: `Changes for ${stepId}`,
    risk: "Low",
    diff,
    filePath: `src/${stepId}.ts`,
    fileName: `${stepId}.ts`,
    isCodegen: false,
    isTest: false,
  };
}

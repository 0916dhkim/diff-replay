import { z } from "zod";

export const atomicStepSchema = z.object({
  stepId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
    .refine((value) => !["__proto__", "prototype", "constructor"].includes(value)),
  diffHash: z.string().regex(/^[a-f0-9]{16,64}$/i),
  action: z.string().min(1),
  takeaway: z.string().min(1),
  risk: z.string().min(1),
  diff: z.string(),
  filePath: z.string().min(1),
  fileName: z.string().min(1),
  prNumber: z.union([z.string(), z.number()]).optional(),
  prTitle: z.string().optional(),
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
  lineCount: z.number().int().nonnegative().optional(),
  isCodegen: z.boolean().default(false),
  isTest: z.boolean().default(false),
  generatedFileList: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const atomicStepsSchema = z
  .array(atomicStepSchema)
  .min(1)
  .max(10_000)
  .superRefine((steps, context) => {
    const stepIds = new Set<string>();
    for (const [index, step] of steps.entries()) {
      if (stepIds.has(step.stepId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate step ID: ${step.stepId}`,
          path: [index, "stepId"],
        });
      }
      stepIds.add(step.stepId);
    }
  });

export const atomicStepInputSchema = atomicStepSchema.extend({
  diffHash: z
    .string()
    .regex(/^[a-f0-9]{16,64}$/i)
    .optional(),
});

export const atomicStepsInputSchema = z
  .array(atomicStepInputSchema)
  .min(1)
  .max(10_000)
  .superRefine((steps, context) => {
    const stepIds = new Set<string>();
    for (const [index, step] of steps.entries()) {
      if (stepIds.has(step.stepId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate step ID: ${step.stepId}`,
          path: [index, "stepId"],
        });
      }
      stepIds.add(step.stepId);
    }
  });

export const replayInputSchema = z.object({
  sourceKey: z.string().min(1).max(500),
  title: z.string().min(1).max(200),
  description: z.string().max(1_000).optional(),
  repository: z.string().max(500).optional(),
  baseRef: z.string().max(200).optional(),
  headRef: z.string().max(200).optional(),
  steps: atomicStepsInputSchema,
});

export const stepStatusSchema = z.enum(["approved", "flagged"]);

export const setStepStatusSchema = z.object({
  status: stepStatusSchema.nullable(),
});

export const setActiveStepSchema = z.object({
  activeStepId: z.string().min(1),
});

export const addNoteSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  stepId: z.string().min(1).optional(),
});

export type AtomicStep = z.infer<typeof atomicStepSchema>;
export type AtomicStepInput = z.infer<typeof atomicStepInputSchema>;
export type ReplayInput = z.infer<typeof replayInputSchema>;
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const reviewNoteSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  stepId: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export const replayStateSchema = z.object({
  activeStepId: z.string(),
  stepStatus: z.record(z.string(), stepStatusSchema),
  notes: z.array(reviewNoteSchema),
});

export const replaySchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{16}$/),
    sourceKey: z.string(),
    title: z.string(),
    description: z.string().optional(),
    repository: z.string().optional(),
    baseRef: z.string().optional(),
    headRef: z.string().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    steps: atomicStepsSchema,
    state: replayStateSchema,
  })
  .superRefine((replay, context) => {
    const stepIds = new Set(replay.steps.map((step) => step.stepId));
    if (!stepIds.has(replay.state.activeStepId)) {
      context.addIssue({
        code: "custom",
        message: "Active step does not exist",
        path: ["state", "activeStepId"],
      });
    }
    for (const stepId of Object.keys(replay.state.stepStatus)) {
      if (!stepIds.has(stepId)) {
        context.addIssue({
          code: "custom",
          message: `Status references unknown step: ${stepId}`,
          path: ["state", "stepStatus", stepId],
        });
      }
    }
  });

export interface ReplayMetadata {
  id: string;
  sourceKey: string;
  title: string;
  description?: string;
  repository?: string;
  baseRef?: string;
  headRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewNote {
  id: string;
  text: string;
  stepId?: string;
  createdAt: string;
}

export interface ReplayState {
  activeStepId: string;
  stepStatus: Record<string, StepStatus>;
  notes: ReviewNote[];
}

export interface Replay extends ReplayMetadata {
  steps: AtomicStep[];
  state: ReplayState;
}

export interface ReplaySummary extends ReplayMetadata {
  approvedSteps: number;
  flaggedSteps: number;
  totalSteps: number;
}

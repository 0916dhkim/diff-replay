import { createMemo, For, Show } from "solid-js";
import type { AtomicStep, Replay, StepStatus } from "../types.js";
import { computeReplayMetrics, typeBadge } from "../utils.js";

interface StepRailProps {
  replay: Replay;
  activeStepId: string;
  isOverview: boolean;
  onSelectStep: (stepId: string) => void;
  onToggleOverview: () => void;
  onUnapprove: (stepId: string) => void;
}

export default function StepRail(props: StepRailProps) {
  const fileMetrics = createMemo(() => computeReplayMetrics(props.replay.steps));
  const totalMaxLoc = createMemo(() => fileMetrics().reduce((sum, file) => sum + file.size, 0));
  const approvedCount = createMemo(
    () =>
      Object.values(props.replay.state.stepStatus).filter((status) => status === "approved").length,
  );

  return (
    <aside class="step-rail">
      <div class="rail-header">
        <p class="eyebrow">{props.replay.repository ?? "REPLAY"}</p>
        <h2>{props.replay.title}</h2>
        <div class="rail-progress">
          <span>
            {approvedCount()} of {props.replay.steps.length}
          </span>
          <div class="progress-track">
            <span
              style={{
                width: `${(approvedCount() / Math.max(1, props.replay.steps.length)) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>
      <nav class="step-list" aria-label="Replay steps">
        <button
          class={`step-row step-zero-row ${props.isOverview ? "active" : ""}`}
          onClick={props.onToggleOverview}
        >
          <span class="step-index zero-index">⊞</span>
          <span class="step-copy">
            <strong>Stack Overview</strong>
            <small>
              {fileMetrics().length} files · {totalMaxLoc()} LOC max
            </small>
          </span>
        </button>
        <div class="step-section-divider">
          <span>STEPS ({props.replay.steps.length})</span>
        </div>
        <For each={props.replay.steps}>
          {(step, index) => (
            <StepRow
              step={step}
              index={index()}
              isActive={step.stepId === props.activeStepId && !props.isOverview}
              status={props.replay.state.stepStatus[step.stepId]}
              onSelect={props.onSelectStep}
              onUnapprove={props.onUnapprove}
            />
          )}
        </For>
      </nav>
    </aside>
  );
}

function StepRow(props: {
  step: AtomicStep;
  index: number;
  isActive: boolean;
  status: StepStatus | undefined;
  onSelect: (stepId: string) => void;
  onUnapprove: (stepId: string) => void;
}) {
  const badge = typeBadge(props.step);

  return (
    <button
      class={`step-row ${props.isActive ? "active" : ""} ${props.status ?? ""}`}
      onClick={() => props.onSelect(props.step.stepId)}
    >
      <span
        class="step-index"
        title={props.status === "approved" ? "Unapprove" : undefined}
        onClick={(event) => {
          if (props.status === "approved") {
            event.preventDefault();
            event.stopPropagation();
            props.onUnapprove(props.step.stepId);
          }
        }}
      >
        {props.status === "approved"
          ? "✓"
          : props.status === "flagged"
            ? "!"
            : String(props.index + 1)}
      </span>
      <span class="step-copy">
        <strong>{props.step.action}</strong>
        <span class="step-copy-meta">
          <Show when={badge === "CODEGEN"}>
            <span class="type-badge codegen">CODEGEN</span>
          </Show>
          <Show when={badge === "TEST"}>
            <span class="type-badge test">TEST</span>
          </Show>
          <Show when={badge === "PRODUCT"}>
            <span class="type-badge">PRODUCT</span>
          </Show>
          <small>{props.step.stepId}</small>
        </span>
      </span>
    </button>
  );
}

import { createMemo, For, Show } from "solid-js";
import type { AtomicStep, Replay, StepStatus } from "../types.js";
import { computeReplayMetrics, typeBadge } from "../utils.js";

interface StepRailProps {
  replay: Replay;
  activeStepId: string;
  isOverview: boolean;
  selectedFile: string | null;
  onSelectStep: (stepId: string) => void;
  onToggleOverview: () => void;
  onUnapprove: (stepId: string) => void;
  onClearFilter: () => void;
}

export default function StepRail(props: StepRailProps) {
  const fileMetrics = createMemo(() => computeReplayMetrics(props.replay.steps));
  const totalMaxLoc = createMemo(() => fileMetrics().reduce((sum, file) => sum + file.size, 0));
  const approvedCount = createMemo(
    () =>
      Object.values(props.replay.state.stepStatus).filter((status) => status === "approved").length,
  );
  const displayedSteps = createMemo(() => {
    const file = props.selectedFile;
    if (!file) return props.replay.steps;
    return props.replay.steps.filter(
      (s) => s.filePath === file || s.diff.includes(`b/${file}`) || s.diff.includes(`a/${file}`),
    );
  });

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
        <Show
          when={props.selectedFile}
          fallback={
            <div class="step-section-divider">
              <span>STEPS ({props.replay.steps.length})</span>
            </div>
          }
        >
          <div class="step-filter-banner">
            <div class="filter-copy">
              <svg
                class="filter-icon"
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M1.5 2.5a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 .53 1.28L9.5 7.81v5.44a.75.75 0 0 1-1.13.65l-2-1.15A.75.75 0 0 1 6 12.1V7.81L1.72 3.03a.75.75 0 0 1-.22-.53Z" />
              </svg>
              <strong class="filter-filename" title={props.selectedFile!}>
                {props.selectedFile!.split("/").pop()}
              </strong>
            </div>
            <button
              class="filter-clear-btn"
              type="button"
              onClick={props.onClearFilter}
              aria-label="Clear file filter"
              title="Clear file filter (Esc)"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
        </Show>
        <For each={displayedSteps()}>
          {(step) => {
            const originalIndex = () => props.replay.steps.indexOf(step);
            return (
              <StepRow
                step={step}
                index={originalIndex()}
                isActive={step.stepId === props.activeStepId && !props.isOverview}
                status={props.replay.state.stepStatus[step.stepId]}
                onSelect={props.onSelectStep}
                onUnapprove={props.onUnapprove}
              />
            );
          }}
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

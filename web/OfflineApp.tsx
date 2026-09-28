import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Replay, StepStatus } from "./types.js";
import StepRail from "./components/StepRail.jsx";
import DiffViewer from "./components/DiffViewer.jsx";
import TreemapOverview from "./components/TreemapOverview.jsx";
import { loadOfflineStatuses, saveOfflineStatuses, STORAGE_WARNING } from "./offline-storage.js";

export default function OfflineApp(props: { replay: Replay }) {
  const loaded = loadOfflineStatuses(props.replay);
  const [statuses, setStatuses] = createSignal(loaded.statuses);
  const [warning, setWarning] = createSignal(loaded.warning);
  const [canWrite] = createSignal(loaded.canWrite);
  const [activeStepId, setActiveStepId] = createSignal(props.replay.state.activeStepId);
  const [isOverview, setIsOverview] = createSignal(false);
  const [zoomedPath, setZoomedPath] = createSignal<string | null>(null);
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"split" | "unified">("split");

  const currentReplay = createMemo<Replay>(() => ({
    ...props.replay,
    state: { ...props.replay.state, stepStatus: statuses() },
  }));
  const activeIndex = () =>
    Math.max(
      0,
      props.replay.steps.findIndex((step) => step.stepId === activeStepId()),
    );
  const activeStep = () => props.replay.steps[activeIndex()]!;

  const selectReviewStep = (stepId: string) => {
    setIsOverview(false);
    setZoomedPath(null);
    setActiveStepId(stepId);
  };

  const toggleOverview = () => {
    setIsOverview((overview) => !overview);
    setZoomedPath(null);
    setSelectedFile(null);
  };

  const setStatus = (stepId: string, status: StepStatus | null): boolean => {
    if (!canWrite()) {
      setWarning(STORAGE_WARNING);
      return false;
    }
    const updated = { ...statuses() };
    if (status === null) {
      delete updated[stepId];
    } else {
      updated[stepId] = status;
    }
    if (!saveOfflineStatuses(props.replay, updated)) {
      setWarning(STORAGE_WARNING);
      return false;
    }
    setStatuses(updated);
    setWarning(null);
    return true;
  };

  const approveAndAdvance = () => {
    const index = activeIndex();
    const step = activeStep();
    if (step && setStatus(step.stepId, "approved")) {
      const next = props.replay.steps[index + 1];
      if (next) {
        selectReviewStep(next.stepId);
      }
    }
  };

  createEffect(
    () => undefined,
    () => {
      document.title = `${props.replay.title} | Diff Replay · Offline export`;
      const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target;
        if (
          (target instanceof HTMLElement &&
            (target.isContentEditable || target.matches("input, textarea, select"))) ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          return;
        }
        if (event.key === "Escape") {
          if (selectedFile() !== null) {
            event.preventDefault();
            setSelectedFile(null);
          } else if (isOverview()) {
            event.preventDefault();
            const path = zoomedPath();
            if (path !== null) {
              const slash = path.lastIndexOf("/");
              setZoomedPath(slash === -1 ? null : path.slice(0, slash));
            } else {
              setIsOverview(false);
            }
          }
        } else if (event.code === "Space") {
          event.preventDefault();
          if (isOverview()) {
            setIsOverview(false);
            setZoomedPath(null);
            setSelectedFile(null);
          } else if (!event.repeat) {
            approveAndAdvance();
          }
        } else if ((event.key === "o" || event.key === "m") && !event.repeat) {
          event.preventDefault();
          toggleOverview();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      onCleanup(() => window.removeEventListener("keydown", onKeyDown));
    },
  );

  return (
    <div class="workspace offline-workspace">
      <StepRail
        replay={currentReplay()}
        activeStepId={activeStepId()}
        isOverview={isOverview()}
        selectedFile={selectedFile()}
        onSelectStep={selectReviewStep}
        onToggleOverview={toggleOverview}
        onUnapprove={(id) => setStatus(id, null)}
        onClearFilter={() => setSelectedFile(null)}
      />
      <main class="review-main">
        <header class="review-header">
          <div class="review-heading">
            <span>Diff Replay</span>
            <span class="header-divider">/</span>
            <strong>{props.replay.title}</strong>
            <span class="header-divider">/</span>
            <span style={{ color: "var(--lime)" }}>Offline export</span>
            <Show when={isOverview()}>
              <span class="header-divider">/</span>
              <span>Stack Overview</span>
            </Show>
          </div>
          <div class="header-actions">
            <Show when={!isOverview()}>
              <div class="segments">
                <button
                  class={viewMode() === "split" ? "active" : ""}
                  onClick={() => setViewMode("split")}
                >
                  Split
                </button>
                <button
                  class={viewMode() === "unified" ? "active" : ""}
                  onClick={() => setViewMode("unified")}
                >
                  Unified
                </button>
              </div>
              <button class="button primary" onClick={approveAndAdvance}>
                Approve &amp; next
              </button>
            </Show>
          </div>
        </header>
        <Show when={warning()}>
          {(message) => (
            <p class="offline-warning" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show
          when={isOverview()}
          fallback={
            <DiffViewer
              step={activeStep()}
              viewMode={viewMode()}
              stepIndex={activeIndex()}
              totalSteps={props.replay.steps.length}
            />
          }
        >
          <TreemapOverview
            replay={currentReplay()}
            zoomedPath={zoomedPath()}
            selectedFile={selectedFile()}
            onZoom={setZoomedPath}
            onSelectFile={setSelectedFile}
          />
        </Show>
      </main>
    </div>
  );
}

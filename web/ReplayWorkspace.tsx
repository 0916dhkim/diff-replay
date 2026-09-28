import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { Replay, StepStatus } from "./types.js";
import StepRail from "./components/StepRail.jsx";
import DiffViewer from "./components/DiffViewer.jsx";
import TreemapOverview from "./components/TreemapOverview.jsx";
import ReviewHeader from "./components/ReviewHeader.jsx";
import ReviewNotes from "./components/ReviewNotes.jsx";

export interface WorkspaceRoute {
  isOverview: boolean;
  folderPath: string | null;
  stepId: string | null;
}

interface NotesActions {
  add: (text: string, stepId?: string) => void;
  update: (id: string, text: string) => void;
  delete: (id: string) => void;
}

interface ReplayWorkspaceProps {
  replay: Replay;
  persistStatus: (stepId: string, status: StepStatus | null) => Promise<boolean> | boolean;
  notes?: NotesActions;
  onHome?: () => void;
  onExport?: () => void;
  route?: WorkspaceRoute;
  onSelectRoute?: (stepId: string) => void;
  onOverviewRoute?: (isOverview: boolean, stepId: string) => void;
  onZoomRoute?: (path: string | null) => void;
  offlineLabel?: boolean;
  warning?: string | null;
}

export default function ReplayWorkspace(props: ReplayWorkspaceProps) {
  const [activeStepId, setActiveStepId] = createSignal(
    props.route
      ? (props.route.stepId ?? props.replay.steps[0]?.stepId ?? "")
      : (props.replay.state.activeStepId ?? props.replay.steps[0]?.stepId ?? ""),
  );
  const [isOverview, setIsOverview] = createSignal(props.route?.isOverview ?? false);
  const [zoomedPath, setZoomedPath] = createSignal<string | null>(props.route?.folderPath ?? null);
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"split" | "unified">("split");
  const [sidebarsHidden, setSidebarsHidden] = createSignal(false);

  // Route changes are distinct from replay data changes: SSE refreshes must not reset selection.
  createEffect(
    () => props.route,
    (route) => {
      if (route) {
        setIsOverview(route.isOverview);
        setZoomedPath(route.folderPath);
        if (route.stepId) {
          setActiveStepId(route.stepId);
        }
      }
    },
  );

  const activeStep = () =>
    props.replay.steps.find((step) => step.stepId === activeStepId()) ?? props.replay.steps[0];
  const activeIndex = () => {
    const step = activeStep();
    return step ? props.replay.steps.indexOf(step) : 0;
  };

  const selectReviewStep = (stepId: string) => {
    setIsOverview(false);
    setZoomedPath(null);
    setActiveStepId(stepId);
    props.onSelectRoute?.(stepId);
  };

  const toggleOverview = () => {
    const next = !isOverview();
    setIsOverview(next);
    setZoomedPath(null);
    setSelectedFile(null);
    props.onOverviewRoute?.(next, activeStep()?.stepId ?? "");
  };

  const backToReview = () => {
    setIsOverview(false);
    setZoomedPath(null);
    setSelectedFile(null);
    props.onOverviewRoute?.(false, activeStep()?.stepId ?? "");
  };

  const zoom = (path: string | null) => {
    setZoomedPath(path);
    setIsOverview(true);
    props.onZoomRoute?.(path);
  };

  const approveAndAdvance = async (): Promise<void> => {
    const replayId = props.replay.id;
    const step = activeStep();
    if (!step) {
      return;
    }
    const index = props.replay.steps.indexOf(step);
    if (!(await props.persistStatus(step.stepId, "approved")) || props.replay.id !== replayId) {
      return;
    }
    const next = props.replay.steps[index + 1];
    if (next) {
      selectReviewStep(next.stepId);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (
      (target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))) ||
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
          zoom(slash === -1 ? null : path.slice(0, slash));
        } else {
          backToReview();
        }
      }
    } else if (event.code === "Space") {
      event.preventDefault();
      if (isOverview()) {
        backToReview();
      } else if (!event.repeat) {
        void approveAndAdvance();
      }
    } else if ((event.key === "o" || event.key === "m") && !event.repeat) {
      event.preventDefault();
      toggleOverview();
    } else if (event.key === "z" && props.notes && !event.repeat) {
      event.preventDefault();
      setSidebarsHidden((hidden) => !hidden);
    }
  };

  window.addEventListener("keydown", onKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  return (
    <div
      class={`workspace ${props.notes ? "" : "offline-workspace"} ${sidebarsHidden() ? "sidebars-hidden" : ""}`}
    >
      <StepRail
        replay={props.replay}
        activeStepId={activeStep()?.stepId ?? ""}
        isOverview={isOverview()}
        selectedFile={selectedFile()}
        onSelectStep={selectReviewStep}
        onToggleOverview={toggleOverview}
        onUnapprove={(id) => void props.persistStatus(id, null)}
        onClearFilter={() => setSelectedFile(null)}
      />
      <main class="review-main">
        <ReviewHeader
          title={props.replay.title}
          isOverview={isOverview()}
          viewMode={viewMode()}
          onChangeViewMode={setViewMode}
          onBackToHome={props.onHome}
          onApproveAndAdvance={() => void approveAndAdvance()}
          onExport={props.onExport}
          offlineLabel={props.offlineLabel}
        />
        <Show when={props.warning}>
          {(message) => (
            <p class="offline-warning" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show
          when={isOverview()}
          fallback={
            <Show when={activeStep()}>
              {(step) => (
                <DiffViewer
                  step={step()}
                  viewMode={viewMode()}
                  stepIndex={activeIndex()}
                  totalSteps={props.replay.steps.length}
                />
              )}
            </Show>
          }
        >
          <TreemapOverview
            replay={props.replay}
            zoomedPath={zoomedPath()}
            selectedFile={selectedFile()}
            onZoom={zoom}
            onSelectFile={setSelectedFile}
          />
        </Show>
      </main>
      <Show when={props.notes}>
        {(notes) => (
          <ReviewNotes
            notes={props.replay.state.notes}
            steps={props.replay.steps}
            activeStepId={activeStep()?.stepId ?? ""}
            isOverview={isOverview()}
            onAddNote={notes().add}
            onUpdateNote={notes().update}
            onDeleteNote={notes().delete}
            onSelectStep={selectReviewStep}
          />
        )}
      </Show>
    </div>
  );
}

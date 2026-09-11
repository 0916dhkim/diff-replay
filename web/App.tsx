import type { Replay, ReplaySummary, ReviewNote, StepStatus } from "./types.js";
import { api, showToast } from "./api.js";
import Home from "./components/Home.jsx";
import StepRail from "./components/StepRail.jsx";
import ReviewHeader from "./components/ReviewHeader.jsx";
import DiffViewer from "./components/DiffViewer.jsx";
import TreemapOverview from "./components/TreemapOverview.jsx";
import ReviewNotes from "./components/ReviewNotes.jsx";
import { createEffect, createSignal, Match, onCleanup, Show, Switch } from "solid-js";

type RouteState = {
  view: "home" | "replay" | "error";
  replayId?: string;
  error?: string;
};

interface ParsedReplayRoute {
  replayId: string;
  isOverview: boolean;
  folderPath: string | null;
  stepId: string | null;
}

function parseReplayPath(pathname: string): ParsedReplayRoute | null {
  const overviewMatch = pathname.match(/^\/replays\/([^/]+)\/overview(?:\/(.+))?$/);
  if (overviewMatch?.[1]) {
    return {
      replayId: overviewMatch[1],
      isOverview: true,
      folderPath: overviewMatch[2] ? decodeURIComponent(overviewMatch[2]) : null,
      stepId: null,
    };
  }

  const stepMatch = pathname.match(/^\/replays\/([^/]+)\/steps\/([^/]+)$/);
  if (stepMatch?.[1] && stepMatch[2]) {
    return {
      replayId: stepMatch[1],
      isOverview: false,
      folderPath: null,
      stepId: decodeURIComponent(stepMatch[2]),
    };
  }

  const replayMatch = pathname.match(/^\/replays\/([^/]+)$/);
  if (replayMatch?.[1]) {
    return {
      replayId: replayMatch[1],
      isOverview: false,
      folderPath: null,
      stepId: null,
    };
  }

  return null;
}

export function App() {
  const [routeState, setRouteState] = createSignal<RouteState>({ view: "home" });
  const [replays, setReplays] = createSignal<ReplaySummary[]>([]);
  const [currentReplay, setCurrentReplay] = createSignal<Replay | null>(null);
  const [activeStepId, setActiveStepId] = createSignal<string>("");
  const [isOverview, setIsOverview] = createSignal(false);
  const [zoomedPath, setZoomedPath] = createSignal<string | null>(null);
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"split" | "unified">("split");
  const [sidebarsHidden, setSidebarsHidden] = createSignal(false);

  let eventSource: EventSource | null = null;
  let routeGeneration = 0;
  let mutationQueue: Promise<unknown> = Promise.resolve();

  const activeStep = () => {
    const replay = currentReplay();
    if (!replay) return undefined;
    const currentId = activeStepId();
    return replay.steps.find((step) => step.stepId === currentId) ?? replay.steps[0];
  };

  const activeIndex = () => {
    const replay = currentReplay();
    const step = activeStep();
    return replay && step ? replay.steps.indexOf(step) : 0;
  };

  const refreshReplay = async (replayId: string, generation: number): Promise<void> => {
    const { replay } = await api<{ replay: Replay }>(`/api/replays/${replayId}`);
    if (generation === routeGeneration && currentReplay()?.id === replayId) {
      setCurrentReplay(replay);
    }
  };

  const route = async (): Promise<void> => {
    const generation = ++routeGeneration;
    const parsed = parseReplayPath(window.location.pathname);

    if (parsed) {
      const replayId = parsed.replayId;
      if (currentReplay()?.id === replayId) {
        setIsOverview(parsed.isOverview);
        setZoomedPath(parsed.folderPath);
        if (parsed.stepId) setActiveStepId(parsed.stepId);
        return;
      }

      eventSource?.close();
      eventSource = null;
      setCurrentReplay(null);
      setSelectedFile(null);

      try {
        const { replay } = await api<{ replay: Replay }>(`/api/replays/${replayId}`);
        if (generation !== routeGeneration) return;

        setCurrentReplay(replay);

        if (window.location.hash.startsWith("#overview")) {
          const hashFolder = window.location.hash.startsWith("#overview:")
            ? decodeURIComponent(window.location.hash.slice("#overview:".length))
            : null;
          const targetUrl = hashFolder
            ? `/replays/${replayId}/overview/${encodeURI(hashFolder)}`
            : `/replays/${replayId}/overview`;
          window.history.replaceState({}, "", targetUrl);
          setIsOverview(true);
          setZoomedPath(hashFolder);
          setActiveStepId(replay.steps[0]?.stepId ?? "");
        } else if (parsed.isOverview) {
          setIsOverview(true);
          setZoomedPath(parsed.folderPath);
          setActiveStepId(replay.steps[0]?.stepId ?? "");
        } else {
          setIsOverview(false);
          setZoomedPath(null);
          const resolvedStepId =
            parsed.stepId && replay.steps.some((s) => s.stepId === parsed.stepId)
              ? parsed.stepId
              : (replay.steps[0]?.stepId ?? "");

          setActiveStepId(resolvedStepId);
          if (!parsed.stepId && resolvedStepId) {
            window.history.replaceState(
              {},
              "",
              `/replays/${replayId}/steps/${encodeURIComponent(resolvedStepId)}`,
            );
          }
        }

        setRouteState({ view: "replay", replayId });
        eventSource = new EventSource(`/api/replays/${replayId}/events`);
        eventSource.addEventListener("message", (event) => {
          try {
            const message = JSON.parse(event.data) as { type?: string };
            if (message.type === "replay-updated") void refreshReplay(replayId, generation);
          } catch {
            // Ignore malformed server-sent events.
          }
        });
      } catch (error) {
        if (generation === routeGeneration) {
          setRouteState({
            view: "error",
            error: error instanceof Error ? error.message : "Could not load this replay",
          });
        }
      }
    } else {
      eventSource?.close();
      eventSource = null;
      setCurrentReplay(null);
      setIsOverview(false);
      setZoomedPath(null);
      setSelectedFile(null);
      try {
        const { replays: nextReplays } = await api<{ replays: ReplaySummary[] }>("/api/replays");
        if (generation !== routeGeneration) return;
        setReplays(nextReplays);
        setRouteState({ view: "home" });
      } catch (error) {
        if (generation === routeGeneration) {
          setRouteState({
            view: "error",
            error: error instanceof Error ? error.message : "Could not load replays",
          });
        }
      }
    }
  };

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    void route();
  };

  const handleZoom = (path: string | null) => {
    const replay = currentReplay();
    if (!replay) return;
    setZoomedPath(path);
    setIsOverview(true);
    const targetUrl = path
      ? `/replays/${replay.id}/overview/${path.split("/").map(encodeURIComponent).join("/")}`
      : `/replays/${replay.id}/overview`;
    window.history.pushState({}, "", targetUrl);
  };

  const handleToggleOverview = () => {
    const replay = currentReplay();
    if (!replay) return;
    const next = !isOverview();
    setIsOverview(next);
    setZoomedPath(null);
    setSelectedFile(null);
    if (next) {
      window.history.pushState({}, "", `/replays/${replay.id}/overview`);
    } else {
      const stepId = activeStepId() || replay.steps[0]?.stepId || "";
      window.history.pushState({}, "", `/replays/${replay.id}/steps/${encodeURIComponent(stepId)}`);
    }
  };

  const handleBackToReview = () => {
    const replay = currentReplay();
    if (!replay) return;
    setIsOverview(false);
    setZoomedPath(null);
    setSelectedFile(null);
    const stepId = activeStepId() || replay.steps[0]?.stepId || "";
    window.history.pushState({}, "", `/replays/${replay.id}/steps/${encodeURIComponent(stepId)}`);
  };

  const mutateReplay = async (
    replayId: string,
    url: string,
    init: RequestInit,
  ): Promise<Replay | null> => {
    const operation = async (): Promise<Replay | null> => {
      try {
        const { replay } = await api<{ replay: Replay }>(url, init);
        if (currentReplay()?.id === replayId) setCurrentReplay(replay);
        return replay;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The review change could not be saved");
        return null;
      }
    };

    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const setStatus = async (stepId: string, status: StepStatus | null): Promise<boolean> => {
    const replay = currentReplay();
    if (!replay) return false;
    return Boolean(
      await mutateReplay(
        replay.id,
        `/api/replays/${replay.id}/steps/${encodeURIComponent(stepId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      ),
    );
  };

  const selectReviewStep = (stepId: string) => {
    setIsOverview(false);
    setZoomedPath(null);
    const replay = currentReplay();
    if (!replay) return;
    setActiveStepId(stepId);
    window.history.pushState({}, "", `/replays/${replay.id}/steps/${encodeURIComponent(stepId)}`);
  };

  const approveAndAdvance = async (): Promise<void> => {
    const replay = currentReplay();
    if (!replay) return;
    const currentId = activeStepId();
    const index = replay.steps.findIndex((step) => step.stepId === currentId);
    const step = replay.steps[index];
    if (!step || !(await setStatus(step.stepId, "approved"))) return;
    if (currentReplay()?.id !== replay.id) return;
    const next = replay.steps[Math.min(index + 1, replay.steps.length - 1)];
    if (next && next.stepId !== step.stepId) {
      selectReviewStep(next.stepId);
    }
  };

  const addNote = async (text: string, stepId?: string): Promise<void> => {
    const replayId = currentReplay()?.id;
    if (!replayId) return;
    await mutateReplay(replayId, `/api/replays/${replayId}/notes`, {
      method: "POST",
      body: JSON.stringify({ text, stepId }),
    });
  };

  const deleteNote = async (noteId: string): Promise<void> => {
    const replayId = currentReplay()?.id;
    if (!replayId) return;
    await mutateReplay(replayId, `/api/replays/${replayId}/notes/${encodeURIComponent(noteId)}`, {
      method: "DELETE",
    });
  };

  createEffect(
    () => currentReplay()?.title,
    (title) => {
      document.title = title ? `${title} | Diff Replay` : "Diff Replay";
    },
  );

  createEffect(
    () => undefined,
    () => {
      const onPopState = () => {
        const replay = currentReplay();
        const parsed = parseReplayPath(window.location.pathname);
        if (replay && parsed && parsed.replayId === replay.id) {
          setIsOverview(parsed.isOverview);
          setZoomedPath(parsed.folderPath);
          if (parsed.stepId && parsed.stepId !== activeStepId()) {
            setActiveStepId(parsed.stepId);
          }
        } else {
          void route();
        }
      };

      const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, textarea") || !currentReplay()) return;

        if (event.key === "Escape") {
          if (selectedFile() !== null) {
            event.preventDefault();
            setSelectedFile(null);
            return;
          }
          if (isOverview()) {
            event.preventDefault();
            if (zoomedPath() !== null) {
              const current = zoomedPath()!;
              const lastSlash = current.lastIndexOf("/");
              const parentPath = lastSlash !== -1 ? current.slice(0, lastSlash) : null;
              handleZoom(parentPath);
            } else {
              handleBackToReview();
            }
            return;
          }
        }
        if (event.code === "Space") {
          event.preventDefault();
          if (isOverview()) handleBackToReview();
          else void approveAndAdvance();
          return;
        }
        if (
          (event.key === "m" || event.key === "o") &&
          !event.repeat &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          handleToggleOverview();
          return;
        }
        if (
          event.key === "z" &&
          !event.repeat &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          setSidebarsHidden((hidden) => !hidden);
        }
      };

      window.addEventListener("popstate", onPopState);
      window.addEventListener("keydown", onKeyDown);
      void route();

      onCleanup(() => {
        eventSource?.close();
        window.removeEventListener("popstate", onPopState);
        window.removeEventListener("keydown", onKeyDown);
      });
    },
  );

  return (
    <Switch>
      <Match when={routeState().view === "home"}>
        <Home replays={replays()} onSelect={(id) => navigate(`/replays/${id}`)} />
      </Match>
      <Match when={routeState().view === "error"}>
        <main class="error-page">
          <h1>Unable to load Diff Replay</h1>
          <p>{routeState().error}</p>
          <button class="button primary" onClick={() => navigate("/")}>
            Back to home
          </button>
        </main>
      </Match>
      <Match when={routeState().view === "replay" && currentReplay() && activeStep()}>
        <div class={`workspace ${sidebarsHidden() ? "sidebars-hidden" : ""}`}>
          <StepRail
            replay={currentReplay()!}
            activeStepId={activeStepId()}
            isOverview={isOverview()}
            selectedFile={selectedFile()}
            onSelectStep={selectReviewStep}
            onToggleOverview={handleToggleOverview}
            onUnapprove={(id) => void setStatus(id, null)}
            onClearFilter={() => setSelectedFile(null)}
          />
          <main class="review-main">
            <ReviewHeader
              title={currentReplay()!.title}
              isOverview={isOverview()}
              viewMode={viewMode()}
              onChangeViewMode={setViewMode}
              onBackToHome={() => navigate("/")}
              onApproveAndAdvance={() => void approveAndAdvance()}
            />
            <Show
              when={isOverview()}
              fallback={
                <DiffViewer
                  step={activeStep()!}
                  viewMode={viewMode()}
                  stepIndex={activeIndex()}
                  totalSteps={currentReplay()!.steps.length}
                />
              }
            >
              <TreemapOverview
                replay={currentReplay()!}
                zoomedPath={zoomedPath()}
                selectedFile={selectedFile()}
                onZoom={handleZoom}
                onSelectFile={setSelectedFile}
              />
            </Show>
          </main>
          <ReviewNotes
            notes={currentReplay()!.state.notes}
            activeStepId={activeStepId()}
            isOverview={isOverview()}
            onAddNote={(text, stepId) => void addNote(text, stepId)}
            onDeleteNote={(id) => void deleteNote(id)}
            onSelectStep={selectReviewStep}
          />
        </div>
      </Match>
    </Switch>
  );
}

import { createEffect, createSignal, Match, onCleanup, Switch } from "solid-js";
import type { Replay, ReplaySummary, StepStatus } from "./types.js";
import { api, showToast } from "./api.js";
import Home from "./components/Home.jsx";
import ReplayWorkspace, { type WorkspaceRoute } from "./ReplayWorkspace.jsx";

type RouteState = {
  view: "home" | "replay" | "error";
  error?: string;
};

interface ParsedReplayRoute extends WorkspaceRoute {
  replayId: string;
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

function resolveWorkspaceRoute(parsed: ParsedReplayRoute, replay: Replay): WorkspaceRoute {
  const replayId = parsed.replayId;
  if (window.location.hash.startsWith("#overview")) {
    const hashFolder = window.location.hash.startsWith("#overview:")
      ? decodeURIComponent(window.location.hash.slice("#overview:".length))
      : null;
    window.history.replaceState(
      {},
      "",
      hashFolder
        ? `/replays/${replayId}/overview/${hashFolder.split("/").map(encodeURIComponent).join("/")}`
        : `/replays/${replayId}/overview`,
    );
    return { isOverview: true, folderPath: hashFolder, stepId: null };
  }
  if (parsed.isOverview) {
    return { isOverview: true, folderPath: parsed.folderPath, stepId: null };
  }
  const stepId = replay.steps.some((step) => step.stepId === parsed.stepId)
    ? parsed.stepId
    : (replay.steps[0]?.stepId ?? null);
  if (stepId && stepId !== parsed.stepId) {
    window.history.replaceState({}, "", `/replays/${replayId}/steps/${encodeURIComponent(stepId)}`);
  }
  return { isOverview: false, folderPath: null, stepId };
}

export function App() {
  const [routeState, setRouteState] = createSignal<RouteState>({ view: "home" });
  const [workspaceRoute, setWorkspaceRoute] = createSignal<WorkspaceRoute>();
  const [replays, setReplays] = createSignal<ReplaySummary[]>([]);
  const [currentReplay, setCurrentReplay] = createSignal<Replay | null>(null);

  let eventSource: EventSource | null = null;
  let routeGeneration = 0;
  let refreshSequence = 0;
  let mutationVersion = 0;
  let pendingMutations = 0;
  let mutationQueue: Promise<unknown> = Promise.resolve();

  const refreshReplay = async (replayId: string, generation: number): Promise<void> => {
    const sequence = ++refreshSequence;
    const version = mutationVersion;
    const { replay } = await api<{ replay: Replay }>(`/api/replays/${replayId}`);
    if (
      generation === routeGeneration &&
      sequence === refreshSequence &&
      version === mutationVersion &&
      pendingMutations === 0 &&
      currentReplay()?.id === replayId
    ) {
      setCurrentReplay(replay);
    }
  };

  const route = async (): Promise<void> => {
    const parsed = parseReplayPath(window.location.pathname);
    const replay = currentReplay();
    if (parsed && replay?.id === parsed.replayId) {
      setWorkspaceRoute(resolveWorkspaceRoute(parsed, replay));
      setRouteState({ view: "replay" });
      return;
    }

    const generation = ++routeGeneration;
    eventSource?.close();
    eventSource = null;
    setCurrentReplay(null);
    setWorkspaceRoute(undefined);

    if (parsed) {
      try {
        const { replay: loaded } = await api<{ replay: Replay }>(`/api/replays/${parsed.replayId}`);
        if (generation !== routeGeneration) {
          return;
        }
        setWorkspaceRoute(resolveWorkspaceRoute(parsed, loaded));
        setCurrentReplay(loaded);
        setRouteState({ view: "replay" });
        eventSource = new EventSource(`/api/replays/${parsed.replayId}/events`);
        eventSource.addEventListener("message", (event) => {
          try {
            const message = JSON.parse(event.data) as { type?: string };
            if (message.type === "replay-updated") {
              void refreshReplay(parsed.replayId, generation).catch(() => undefined);
            }
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
      try {
        const { replays: nextReplays } = await api<{ replays: ReplaySummary[] }>("/api/replays");
        if (generation !== routeGeneration) {
          return;
        }
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

  const mutateReplay = async (
    replayId: string,
    url: string,
    init: RequestInit,
  ): Promise<Replay | null> => {
    const generation = routeGeneration;
    pendingMutations += 1;
    const operation = async (): Promise<Replay | null> => {
      try {
        const { replay } = await api<{ replay: Replay }>(url, init);
        mutationVersion += 1;
        if (generation === routeGeneration && currentReplay()?.id === replayId) {
          setCurrentReplay(replay);
        }
        return replay;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The review change could not be saved");
        return null;
      } finally {
        pendingMutations -= 1;
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
    if (!replay) {
      return false;
    }
    const generation = routeGeneration;
    const saved = await mutateReplay(
      replay.id,
      `/api/replays/${replay.id}/steps/${encodeURIComponent(stepId)}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    // An in-flight approval must not navigate an old workspace after Home or a
    // different replay is selected, even if the server accepted that approval.
    return Boolean(saved && generation === routeGeneration && currentReplay()?.id === replay.id);
  };

  const addNote = async (text: string, stepId?: string): Promise<void> => {
    const replayId = currentReplay()?.id;
    if (replayId) {
      await mutateReplay(replayId, `/api/replays/${replayId}/notes`, {
        method: "POST",
        body: JSON.stringify({ text, stepId }),
      });
    }
  };

  const deleteNote = async (noteId: string): Promise<void> => {
    const replayId = currentReplay()?.id;
    if (replayId) {
      await mutateReplay(replayId, `/api/replays/${replayId}/notes/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
      });
    }
  };

  const updateNote = async (noteId: string, text: string): Promise<void> => {
    const replayId = currentReplay()?.id;
    if (replayId) {
      await mutateReplay(replayId, `/api/replays/${replayId}/notes/${encodeURIComponent(noteId)}`, {
        method: "PATCH",
        body: JSON.stringify({ text }),
      });
    }
  };

  createEffect(
    () => currentReplay()?.title,
    (title) => {
      document.title = title ? `${title} | Diff Replay` : "Diff Replay";
    },
  );

  window.addEventListener("popstate", route);
  void route();
  onCleanup(() => {
    ++routeGeneration;
    eventSource?.close();
    window.removeEventListener("popstate", route);
  });

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
      <Match when={routeState().view === "replay" && currentReplay()}>
        {(replay) => (
          <ReplayWorkspace
            replay={replay()}
            route={workspaceRoute()}
            persistStatus={setStatus}
            notes={{
              add: (text, stepId) => void addNote(text, stepId),
              update: (id, text) => void updateNote(id, text),
              delete: (id) => void deleteNote(id),
            }}
            onHome={() => navigate("/")}
            onExport={() => {
              const link = document.createElement("a");
              link.href = `/api/replays/${replay().id}/export.html`;
              link.click();
            }}
            onSelectRoute={(stepId) =>
              window.history.pushState(
                {},
                "",
                `/replays/${replay().id}/steps/${encodeURIComponent(stepId)}`,
              )
            }
            onOverviewRoute={(overview, stepId) =>
              window.history.pushState(
                {},
                "",
                overview
                  ? `/replays/${replay().id}/overview`
                  : `/replays/${replay().id}/steps/${encodeURIComponent(stepId)}`,
              )
            }
            onZoomRoute={(path) =>
              window.history.pushState(
                {},
                "",
                path
                  ? `/replays/${replay().id}/overview/${path.split("/").map(encodeURIComponent).join("/")}`
                  : `/replays/${replay().id}/overview`,
              )
            }
          />
        )}
      </Match>
    </Switch>
  );
}

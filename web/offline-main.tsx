import "./style.css";
import { render } from "@solidjs/web";
import { createMemo, createSignal } from "solid-js";
import { replaySchema } from "../src/contracts.js";
import type { Replay, StepStatus } from "./types.js";
import ReplayWorkspace from "./ReplayWorkspace.jsx";
import { loadOfflineStatuses, saveOfflineStatuses, STORAGE_WARNING } from "./offline-storage.js";

function OfflineReplay(props: { replay: Replay }) {
  const loaded = loadOfflineStatuses(props.replay);
  const [statuses, setStatuses] = createSignal(loaded.statuses);
  const [warning, setWarning] = createSignal(loaded.warning);
  const currentReplay = createMemo<Replay>(() => ({
    ...props.replay,
    state: { ...props.replay.state, stepStatus: statuses() },
  }));

  const persistStatus = (stepId: string, status: StepStatus | null): boolean => {
    if (!loaded.canWrite) {
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

  document.title = `${props.replay.title} | Diff Replay · Offline export`;
  return (
    <ReplayWorkspace
      replay={currentReplay()}
      persistStatus={persistStatus}
      warning={warning()}
      offlineLabel
    />
  );
}

const app = document.getElementById("app");
if (app) {
  const embedded = document.getElementById("replay-data")?.textContent;
  try {
    if (!embedded) {
      throw new Error("Missing embedded replay data");
    }
    const replay = replaySchema.parse(JSON.parse(embedded));
    render(() => <OfflineReplay replay={replay} />, app);
  } catch {
    render(
      () => (
        <main class="error-page" role="alert">
          <h1>Unable to load Diff Replay</h1>
          <p>The embedded replay data is missing or invalid.</p>
        </main>
      ),
      app,
    );
  }
}

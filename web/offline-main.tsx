import "./style.css";
import { render } from "@solidjs/web";
import { replaySchema } from "../src/contracts.js";
import OfflineApp from "./OfflineApp.jsx";

const app = document.getElementById("app");
if (app) {
  const embedded = document.getElementById("replay-data")?.textContent;
  try {
    if (!embedded) {
      throw new Error("Missing embedded replay data");
    }
    const replay = replaySchema.parse(JSON.parse(embedded));
    render(() => <OfflineApp replay={replay} />, app);
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

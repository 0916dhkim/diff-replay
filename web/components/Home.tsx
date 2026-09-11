import { For, Show } from "solid-js";
import type { ReplaySummary } from "../types.js";
import { relativeTime } from "../utils.js";

interface HomeProps {
  replays: ReplaySummary[];
  onSelect: (id: string) => void;
}

export default function Home(props: HomeProps) {
  return (
    <main class="home">
      <header class="home-header">
        <div class="brand-mark">DR</div>
        <div>
          <p class="eyebrow">LOCAL REVIEW WORKSPACE</p>
          <h1>Diff Replay</h1>
          <p class="home-subtitle">Walk through complex changes one deliberate step at a time.</p>
        </div>
      </header>
      <Show when={props.replays.length > 0} fallback={<EmptyState />}>
        <section class="replay-grid">
          <For each={props.replays}>
            {(replay) => <ReplayCard replay={replay} onSelect={props.onSelect} />}
          </For>
        </section>
      </Show>
    </main>
  );
}

function ReplayCard(props: { replay: ReplaySummary; onSelect: (id: string) => void }) {
  const progress = () => (props.replay.approvedSteps / Math.max(1, props.replay.totalSteps)) * 100;

  return (
    <article
      class="replay-card"
      tabindex={0}
      onClick={() => props.onSelect(props.replay.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onSelect(props.replay.id);
      }}
    >
      <div class="card-topline">
        <span class="repository">{props.replay.repository ?? "Local diff"}</span>
        <time title={props.replay.updatedAt}>{relativeTime(props.replay.updatedAt)}</time>
      </div>
      <h2>{props.replay.title}</h2>
      <p class="card-description">{props.replay.description ?? props.replay.sourceKey}</p>
      <div class="progress-track">
        <span style={{ width: `${progress()}%` }} />
      </div>
      <div class="card-footer">
        <span>
          {props.replay.approvedSteps}/{props.replay.totalSteps} reviewed
        </span>
        <span class={props.replay.flaggedSteps ? "flag-count" : undefined}>
          {props.replay.flaggedSteps ? `${props.replay.flaggedSteps} flagged` : "No flags"}
        </span>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <section class="empty-state">
      <div class="empty-glyph">±</div>
      <h2>No replays yet</h2>
      <p>Publish a manifest and it will appear here.</p>
      <code>diff-replay publish ./manifest.json</code>
    </section>
  );
}

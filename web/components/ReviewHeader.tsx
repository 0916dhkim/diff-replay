import { Show } from "solid-js";

interface ReviewHeaderProps {
  title: string;
  isOverview: boolean;
  viewMode: "split" | "unified";
  onChangeViewMode: (mode: "split" | "unified") => void;
  onBackToHome?: () => void;
  onApproveAndAdvance: () => void;
  onExport?: () => void;
  offlineLabel?: boolean;
}

export default function ReviewHeader(props: ReviewHeaderProps) {
  return (
    <header class="review-header">
      <div class="review-heading">
        <Show when={props.onBackToHome} fallback={<span>Diff Replay</span>}>
          {(onHome) => (
            <button class="back-button" onClick={onHome()}>
              Diff Replay
            </button>
          )}
        </Show>
        <span class="header-divider">/</span>
        <strong>{props.title}</strong>
        <Show when={props.offlineLabel}>
          <span class="header-divider">/</span>
          <span style={{ color: "var(--lime)" }}>Offline export</span>
        </Show>
        <Show when={props.isOverview}>
          <span class="header-divider">/</span>
          <span style={{ color: "var(--lime)", "font-weight": "600" }}>Stack Overview</span>
        </Show>
      </div>
      <div class="header-actions">
        <Show when={props.onExport}>
          {(onExport) => (
            <button
              class="button secondary"
              onClick={onExport()}
              title="Download this replay as an offline HTML file"
            >
              Export HTML
            </button>
          )}
        </Show>
        <Show when={!props.isOverview}>
          <div class="segments">
            <button
              class={props.viewMode === "split" ? "active" : ""}
              onClick={() => props.onChangeViewMode("split")}
            >
              Split
            </button>
            <button
              class={props.viewMode === "unified" ? "active" : ""}
              onClick={() => props.onChangeViewMode("unified")}
            >
              Unified
            </button>
          </div>
          <button class="button primary" onClick={props.onApproveAndAdvance}>
            Approve & next
          </button>
        </Show>
      </div>
    </header>
  );
}

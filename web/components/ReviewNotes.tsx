import type { AtomicStep, ReviewNote } from "../types.js";
import { relativeTime } from "../utils.js";
import { For, Show, createSignal } from "solid-js";

interface ReviewNotesProps {
  notes: ReviewNote[];
  activeStepId?: string;
  isOverview: boolean;
  onAddNote: (text: string, stepId?: string) => void;
  onDeleteNote: (id: string) => void;
  onSelectStep: (stepId: string) => void;
}

export function ReviewNotes(props: ReviewNotesProps) {
  const [noteText, setNoteText] = createSignal("");

  const submitNote = () => {
    const val = noteText().trim();
    if (val) {
      props.onAddNote(val, props.isOverview ? undefined : props.activeStepId);
      setNoteText("");
    }
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    submitNote();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitNote();
    }
  };

  return (
    <aside class="notes-panel">
      <header>
        <div>
          <p class="eyebrow">ACCUMULATED</p>
          <h2>Review notes</h2>
        </div>
        <span class="notes-count">{props.notes.length}</span>
      </header>
      <Show
        when={props.notes.length > 0}
        fallback={<div class="notes-empty">Notes from every pass collect here.</div>}
      >
        <div class="notes-list">
          <For each={props.notes}>
            {(note) => {
              const hasStep = Boolean(note.stepId);
              const isActive = Boolean(note.stepId && note.stepId === props.activeStepId);
              return (
                <article
                  class={`note ${hasStep ? "is-clickable" : ""} ${isActive ? "active" : ""}`}
                  role={hasStep ? "button" : undefined}
                  tabindex={hasStep ? 0 : undefined}
                  onClick={() => {
                    if (hasStep && note.stepId) props.onSelectStep(note.stepId);
                  }}
                  onKeyDown={(e) => {
                    if (hasStep && note.stepId && e.key === "Enter") {
                      e.preventDefault();
                      props.onSelectStep(note.stepId);
                    }
                  }}
                >
                  <div class="note-topline">
                    <span>{note.stepId ? `Step ${note.stepId}` : "General"}</span>
                    <button
                      type="button"
                      class="note-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onDeleteNote(note.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <p>{note.text}</p>
                  <time title={note.createdAt}>{relativeTime(note.createdAt)}</time>
                </article>
              );
            }}
          </For>
        </div>
      </Show>
      <form class="note-form" onSubmit={handleSubmit}>
        <textarea
          name="note"
          placeholder={
            props.isOverview
              ? "Leave a general note on this replay..."
              : `Leave a note on step ${props.activeStepId ?? ""}...`
          }
          rows={3}
          value={noteText()}
          onInput={(e) => setNoteText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" class="button secondary">
          Add note
        </button>
      </form>
    </aside>
  );
}

export default ReviewNotes;

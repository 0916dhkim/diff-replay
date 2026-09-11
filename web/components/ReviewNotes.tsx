import type { AtomicStep, ReviewNote } from "../types.js";
import { relativeTime } from "../utils.js";
import { For, Show, createSignal } from "solid-js";

interface ReviewNotesProps {
  notes: ReviewNote[];
  steps?: AtomicStep[];
  activeStepId?: string;
  isOverview: boolean;
  onAddNote: (text: string, stepId?: string) => void;
  onUpdateNote: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
  onSelectStep: (stepId: string) => void;
}

export function ReviewNotes(props: ReviewNotesProps) {
  let textareaRef: HTMLTextAreaElement | undefined;
  let editInputRef: HTMLTextAreaElement | undefined;
  const [noteText, setNoteText] = createSignal("");
  const [editingNoteId, setEditingNoteId] = createSignal<string | null>(null);
  const [editingText, setEditingText] = createSignal("");

  const submitNote = () => {
    const val = (textareaRef ? textareaRef.value : noteText()).trim();
    if (val) {
      props.onAddNote(val, props.isOverview ? undefined : props.activeStepId);
      if (textareaRef) textareaRef.value = "";
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

  const handleStartEdit = (note: ReviewNote) => {
    setEditingNoteId(note.id);
    setEditingText(note.text);
    setTimeout(() => {
      if (editInputRef) {
        editInputRef.focus();
        editInputRef.setSelectionRange(editInputRef.value.length, editInputRef.value.length);
      }
    }, 20);
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditingText("");
  };

  const handleSaveEdit = (noteId: string) => {
    const val = (editInputRef ? editInputRef.value : editingText()).trim();
    if (val) {
      props.onUpdateNote(noteId, val);
      setEditingNoteId(null);
      setEditingText("");
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
              const stepIndex = () =>
                note.stepId && props.steps
                  ? props.steps.findIndex((s) => s.stepId === note.stepId)
                  : -1;
              const stepObj = () =>
                stepIndex() !== -1 && props.steps ? props.steps[stepIndex()] : null;
              const hasStep = Boolean(note.stepId);
              const isActive = () => Boolean(note.stepId && note.stepId === props.activeStepId);
              const isEditing = () => editingNoteId() === note.id;

              return (
                <article
                  class={`note shelf-card ${hasStep ? "is-clickable" : ""} ${isActive() ? "active" : ""} ${isEditing() ? "editing" : ""}`}
                >
                  <Show
                    when={isEditing()}
                    fallback={
                      <>
                        <div
                          class={`step-pill ${hasStep ? "" : "general"}`}
                          title={
                            hasStep
                              ? `Step ${stepIndex() + 1} · ${stepObj()?.action ?? note.stepId} (click to jump)`
                              : "General Review Note"
                          }
                          onClick={() => {
                            if (hasStep && note.stepId) props.onSelectStep(note.stepId);
                          }}
                        >
                          <Show when={hasStep} fallback={<span>General Note</span>}>
                            <span class="step-pill-tag">Step {stepIndex() + 1}</span>
                            <span>·</span>
                            <span class="step-pill-id">{stepObj()?.action || note.stepId}</span>
                          </Show>
                        </div>
                        <p class="note-body">{note.text}</p>
                        <div class="shelf-footer">
                          <span class="time-stamp" title={note.createdAt}>
                            {relativeTime(note.createdAt)}
                          </span>
                          <div class="shelf-actions">
                            <button
                              type="button"
                              class="action-btn"
                              title="Edit note"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEdit(note);
                              }}
                            >
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM9.75 4.81l-6.28 6.28a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l6.28-6.28-1.44-1.44Z" />
                              </svg>
                              Edit
                            </button>
                            <span class="action-sep">·</span>
                            <button
                              type="button"
                              class="action-btn danger"
                              title="Delete note"
                              onClick={(e) => {
                                e.stopPropagation();
                                props.onDeleteNote(note.id);
                              }}
                            >
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.15l-.66 6.6A1.75 1.75 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15Z" />
                              </svg>
                              Delete
                            </button>
                          </div>
                        </div>
                      </>
                    }
                  >
                    <div
                      class="step-pill"
                      style={{
                        "border-color": "#58a6ff",
                        background: "rgba(56, 139, 253, 0.2)",
                      }}
                    >
                      <span class="step-pill-tag" style={{ color: "#ffffff" }}>
                        {hasStep ? `Editing · Step ${stepIndex() + 1}` : "Editing · General Note"}
                      </span>
                      <Show when={hasStep}>
                        <span>·</span>
                        <span class="step-pill-id">{stepObj()?.action || note.stepId}</span>
                      </Show>
                    </div>
                    <textarea
                      ref={editInputRef}
                      class="inline-editor"
                      rows={3}
                      value={editingText()}
                      onInput={(e) => setEditingText(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                          e.preventDefault();
                          handleSaveEdit(note.id);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          handleCancelEdit();
                        }
                      }}
                    />
                    <div class="inline-actions">
                      <span
                        style={{
                          "font-family": "'DM Mono', monospace",
                          "font-size": "9.5px",
                          color: "var(--faint)",
                        }}
                      >
                        Esc to cancel
                      </span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button type="button" class="btn-cancel" onClick={handleCancelEdit}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          class="btn-save"
                          onClick={() => handleSaveEdit(note.id)}
                        >
                          Save (Enter)
                        </button>
                      </div>
                    </div>
                  </Show>
                </article>
              );
            }}
          </For>
        </div>
      </Show>
      <form class="note-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
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

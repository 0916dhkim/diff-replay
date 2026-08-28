import type {
  AtomicStep,
  Replay,
  ReplaySummary,
  ReviewNote,
  StepStatus,
} from "../src/contracts.js";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
let currentReplay: Replay | null = null;
let eventSource: EventSource | null = null;
let viewMode: "split" | "unified" = "split";
let sidebarsHidden = false;
let routeGeneration = 0;
let mutationQueue: Promise<unknown> = Promise.resolve();

void route();

window.addEventListener("popstate", () => void route());
window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea")) return;
  if (event.code === "Space" && currentReplay) {
    event.preventDefault();
    void approveAndAdvance();
  }
  if (
    event.key === "z" &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    currentReplay
  ) {
    event.preventDefault();
    sidebarsHidden = !sidebarsHidden;
    document.querySelector(".workspace")?.classList.toggle("sidebars-hidden", sidebarsHidden);
  }
});

async function route(): Promise<void> {
  const generation = ++routeGeneration;
  eventSource?.close();
  eventSource = null;
  currentReplay = null;
  const match = window.location.pathname.match(/^\/replays\/([^/]+)$/);
  try {
    if (match?.[1]) await loadReplay(match[1], generation);
    else await renderHome(generation);
  } catch (error) {
    if (generation === routeGeneration) renderError(error);
  }
}

async function renderHome(generation: number): Promise<void> {
  const { replays } = await api<{ replays: ReplaySummary[] }>("/api/replays");
  if (generation !== routeGeneration) return;
  app.replaceChildren(
    element("main", { className: "home" }, [
      element("header", { className: "home-header" }, [
        element("div", { className: "brand-mark", text: "DR" }),
        element("div", {}, [
          element("p", { className: "eyebrow", text: "LOCAL REVIEW WORKSPACE" }),
          element("h1", { text: "Diff Replay" }),
          element("p", {
            className: "home-subtitle",
            text: "Walk through complex changes one deliberate step at a time.",
          }),
        ]),
      ]),
      replays.length
        ? element("section", { className: "replay-grid" }, replays.map(renderReplayCard))
        : renderEmptyState(),
    ]),
  );
}

function renderReplayCard(replay: ReplaySummary): HTMLElement {
  const progress = replay.totalSteps ? replay.approvedSteps / replay.totalSteps : 0;
  const card = element("article", { className: "replay-card" }, [
    element("div", { className: "card-topline" }, [
      element("span", { className: "repository", text: replay.repository ?? "Local diff" }),
      element("time", { text: relativeTime(replay.updatedAt), title: replay.updatedAt }),
    ]),
    element("h2", { text: replay.title }),
    element("p", {
      className: "card-description",
      text: replay.description ?? replay.sourceKey,
    }),
    element("div", { className: "progress-track" }, [
      element("span", { style: `width: ${progress * 100}%` }),
    ]),
    element("div", { className: "card-footer" }, [
      element("span", { text: `${replay.approvedSteps}/${replay.totalSteps} reviewed` }),
      replay.flaggedSteps
        ? element("span", { className: "flag-count", text: `${replay.flaggedSteps} flagged` })
        : element("span", { text: "No flags" }),
    ]),
  ]);
  card.tabIndex = 0;
  card.addEventListener("click", () => navigate(`/replays/${replay.id}`));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") navigate(`/replays/${replay.id}`);
  });
  return card;
}

function renderEmptyState(): HTMLElement {
  return element("section", { className: "empty-state" }, [
    element("div", { className: "empty-glyph", text: "±" }),
    element("h2", { text: "No replays yet" }),
    element("p", { text: "Publish a manifest and it will appear here." }),
    element("code", { text: "diff-replay publish ./manifest.json" }),
  ]);
}

async function loadReplay(replayId: string, generation: number): Promise<void> {
  const { replay } = await api<{ replay: Replay }>(`/api/replays/${replayId}`);
  if (generation !== routeGeneration) return;
  currentReplay = replay;
  renderReplay(replay);
  eventSource = new EventSource(`/api/replays/${replayId}/events`);
  eventSource.addEventListener("message", (event) => {
    const message = JSON.parse(event.data) as { type: string };
    if (message.type === "replay-updated") void refreshReplay(replayId, generation);
  });
}

async function refreshReplay(replayId: string, generation: number): Promise<void> {
  const { replay } = await api<{ replay: Replay }>(`/api/replays/${replayId}`);
  if (generation !== routeGeneration || currentReplay?.id !== replayId) return;
  currentReplay = replay;
  renderReplay(replay);
}

function renderReplay(replay: Replay): void {
  const activeStep =
    replay.steps.find((step) => step.stepId === replay.state.activeStepId) ?? replay.steps[0]!;
  const activeIndex = replay.steps.indexOf(activeStep);
  const approved = Object.values(replay.state.stepStatus).filter(
    (status) => status === "approved",
  ).length;

  app.replaceChildren(
    element("div", { className: `workspace${sidebarsHidden ? " sidebars-hidden" : ""}` }, [
      renderStepRail(replay, activeStep, approved),
      element("main", { className: "review-main" }, [
        element("header", { className: "review-header" }, [
          element("div", { className: "review-heading" }, [
            element("button", { className: "back-button", text: "Diff Replay" }, [], () =>
              navigate("/"),
            ),
            element("span", { className: "header-divider", text: "/" }),
            element("strong", { text: replay.title }),
          ]),
          element("div", { className: "header-actions" }, [
            segmentedControl(),
            button("Approve & next", "button primary", () => void approveAndAdvance()),
          ]),
        ]),
        element("div", { className: "review-scroll" }, [
          element("section", { className: "step-intro" }, [
            element("div", { className: "step-kicker" }, [
              element("span", { text: `STEP ${activeStep.stepId}` }),
              typeBadge(activeStep),
              element("span", {
                className: `risk risk-${riskClass(activeStep.risk)}`,
                text: `${activeStep.risk} risk`,
              }),
            ]),
            element("h1", { text: activeStep.action }),
            element("p", { text: activeStep.takeaway }),
            element("div", { className: "step-meta" }, [
              element("code", { text: activeStep.filePath }),
              element("span", { text: `${activeIndex + 1} of ${replay.steps.length}` }),
            ]),
          ]),
          renderDiff(activeStep),
        ]),
      ]),
      renderNotes(replay, activeStep),
    ]),
  );
}

function renderStepRail(replay: Replay, activeStep: AtomicStep, approved: number): HTMLElement {
  return element("aside", { className: "step-rail" }, [
    element("div", { className: "rail-header" }, [
      element("p", { className: "eyebrow", text: replay.repository ?? "REPLAY" }),
      element("h2", { text: replay.title }),
      element("div", { className: "rail-progress" }, [
        element("span", { text: `${approved} of ${replay.steps.length}` }),
        element("div", { className: "progress-track" }, [
          element("span", { style: `width: ${(approved / replay.steps.length) * 100}%` }),
        ]),
      ]),
    ]),
    element(
      "nav",
      { className: "step-list", ariaLabel: "Replay steps" },
      replay.steps.map((step, index) => {
        const status = replay.state.stepStatus[step.stepId];
        const badge = element("span", {
          className: "step-index",
          text: status === "approved" ? "✓" : status === "flagged" ? "!" : String(index + 1),
        });
        if (status === "approved") {
          badge.title = "Unapprove";
          badge.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void setStatus(step.stepId, null);
          });
        }
        return element(
          "button",
          {
            className: `step-row ${step.stepId === activeStep.stepId ? "active" : ""} ${status ?? ""}`,
          },
          [
            badge,
            element("span", { className: "step-copy" }, [
              element("strong", { text: step.action }),
              element("small", { text: step.fileName }),
            ]),
          ],
          () => void selectStep(step.stepId),
        );
      }),
    ),
  ]);
}

function renderNotes(replay: Replay, activeStep: AtomicStep): HTMLElement {
  const form = element("form", { className: "note-form" }, [
    element("textarea", {
      name: "note",
      placeholder: `Leave a note on step ${activeStep.stepId}...`,
      rows: "3",
    }),
    button("Add note", "button secondary", undefined, "submit"),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const textarea = form.querySelector<HTMLTextAreaElement>("textarea")!;
    const text = textarea.value.trim();
    if (text) void addNote(text, activeStep.stepId);
  });
  return element("aside", { className: "notes-panel" }, [
    element("header", {}, [
      element("div", {}, [
        element("p", { className: "eyebrow", text: "ACCUMULATED" }),
        element("h2", { text: "Review notes" }),
      ]),
      element("span", { className: "notes-count", text: String(replay.state.notes.length) }),
    ]),
    replay.state.notes.length
      ? element("div", { className: "notes-list" }, replay.state.notes.map(renderNote))
      : element("div", { className: "notes-empty", text: "Notes from every pass collect here." }),
    form,
  ]);
}

function renderNote(note: ReviewNote): HTMLElement {
  return element("article", { className: "note" }, [
    element("div", { className: "note-topline" }, [
      element("span", { text: note.stepId ? `Step ${note.stepId}` : "General" }),
      element(
        "button",
        { className: "note-delete", text: "Delete" },
        [],
        () => void deleteNote(note.id),
      ),
    ]),
    element("p", { text: note.text }),
    element("time", { text: relativeTime(note.createdAt), title: note.createdAt }),
  ]);
}

function segmentedControl(): HTMLElement {
  return element("div", { className: "segments" }, [
    element(
      "button",
      { className: viewMode === "split" ? "active" : "", text: "Split" },
      [],
      () => {
        viewMode = "split";
        if (currentReplay) renderReplay(currentReplay);
      },
    ),
    element(
      "button",
      { className: viewMode === "unified" ? "active" : "", text: "Unified" },
      [],
      () => {
        viewMode = "unified";
        if (currentReplay) renderReplay(currentReplay);
      },
    ),
  ]);
}

function typeBadge(step: AtomicStep): HTMLElement {
  if (step.isCodegen) return element("span", { className: "type-badge codegen", text: "CODEGEN" });
  if (step.isTest) return element("span", { className: "type-badge test", text: "TEST" });
  return element("span", { className: "type-badge", text: "PRODUCT" });
}

async function selectStep(stepId: string): Promise<boolean> {
  const replay = currentReplay;
  if (!replay) return false;
  const updated = await mutateReplay(replay.id, `/api/replays/${replay.id}/state`, {
    method: "PATCH",
    body: JSON.stringify({ activeStepId: stepId }),
  });
  return Boolean(updated);
}

async function setStatus(stepId: string, status: StepStatus | null): Promise<boolean> {
  const replay = currentReplay;
  if (!replay) return false;
  const updated = await mutateReplay(
    replay.id,
    `/api/replays/${replay.id}/steps/${encodeURIComponent(stepId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
  return Boolean(updated);
}

async function approveAndAdvance(): Promise<void> {
  const replay = currentReplay;
  if (!replay) return;
  const index = replay.steps.findIndex((step) => step.stepId === replay.state.activeStepId);
  const step = replay.steps[index];
  if (!step) return;
  if (!(await setStatus(step.stepId, "approved"))) return;
  if (currentReplay?.id !== replay.id) return;
  const next = replay.steps[Math.min(index + 1, replay.steps.length - 1)];
  if (next && next.stepId !== step.stepId) await selectStep(next.stepId);
}

async function addNote(text: string, stepId: string): Promise<void> {
  const replayId = currentReplay?.id;
  if (!replayId) return;
  await mutateReplay(replayId, `/api/replays/${replayId}/notes`, {
    method: "POST",
    body: JSON.stringify({ text, stepId }),
  });
}

async function deleteNote(noteId: string): Promise<void> {
  const replayId = currentReplay?.id;
  if (!replayId) return;
  await mutateReplay(replayId, `/api/replays/${replayId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

async function mutateReplay(
  replayId: string,
  url: string,
  init: RequestInit,
): Promise<Replay | null> {
  const operation = async (): Promise<Replay | null> => {
    try {
      const { replay } = await api<{ replay: Replay }>(url, init);
      if (currentReplay?.id === replayId) {
        currentReplay = replay;
        renderReplay(replay);
      }
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
}

function showToast(message: string): void {
  const toast = element("div", { className: "toast", role: "alert", text: message });
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 5_000);
}

interface ParsedFile {
  path: string;
  hunks: ParsedHunk[];
}

interface ParsedHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: ParsedLine[];
}

interface ParsedLine {
  type: "add" | "delete" | "context";
  content: string;
}

function renderDiff(step: AtomicStep): HTMLElement {
  const files = parseDiff(step.diff);
  if (!files.length) return element("pre", { className: "raw-diff", text: step.diff });
  return element(
    "section",
    { className: `diff-stack ${viewMode}` },
    files.map((file) => {
      const body = element("div", { className: "diff-body" });
      if (viewMode === "split") {
        body.append(renderSplitFile(file));
      } else {
        for (const hunk of file.hunks) {
          body.append(element("div", { className: "hunk-header", text: hunk.header }));
          body.append(renderUnifiedHunk(hunk));
        }
      }
      return element("article", { className: "diff-file" }, [
        element("header", {}, [element("code", { text: file.path })]),
        body,
      ]);
    }),
  );
}

function renderUnifiedHunk(hunk: ParsedHunk): HTMLElement {
  const rows: HTMLElement[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const line of hunk.lines) {
    const oldNumber = line.type === "add" ? "" : String(oldLine++);
    const newNumber = line.type === "delete" ? "" : String(newLine++);
    rows.push(
      element("div", { className: `diff-row ${line.type}` }, [
        element("span", { className: "line-number", text: oldNumber }),
        element("span", { className: "line-number", text: newNumber }),
        element("span", {
          className: "line-prefix",
          text: line.type === "add" ? "+" : line.type === "delete" ? "-" : " ",
        }),
        element("code", { text: line.content }),
      ]),
    );
  }
  return element("div", { className: "unified-lines" }, rows);
}

function renderSplitFile(file: ParsedFile): HTMLElement {
  const left: HTMLElement[] = [];
  const right: HTMLElement[] = [];
  for (const hunk of file.hunks) {
    left.push(element("div", { className: "hunk-header", text: hunk.header }));
    right.push(element("div", { className: "hunk-header", text: hunk.header }));
    appendSplitHunk(hunk, left, right);
  }
  return element("div", { className: "split-lines" }, [
    element("div", { className: "split-pane" }, [
      element("div", { className: "split-pane-inner" }, left),
    ]),
    element("div", { className: "split-pane" }, [
      element("div", { className: "split-pane-inner" }, right),
    ]),
  ]);
}

function appendSplitHunk(hunk: ParsedHunk, left: HTMLElement[], right: HTMLElement[]): void {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index]!;
    if (line.type === "context") {
      left.push(diffHalf(String(oldLine++), line));
      right.push(diffHalf(String(newLine++), line));
      index += 1;
      continue;
    }
    const deletions: ParsedLine[] = [];
    const additions: ParsedLine[] = [];
    while (index < hunk.lines.length && hunk.lines[index]!.type !== "context") {
      const changed = hunk.lines[index++]!;
      if (changed.type === "delete") deletions.push(changed);
      else additions.push(changed);
    }
    const rowCount = Math.max(deletions.length, additions.length);
    for (let row = 0; row < rowCount; row += 1) {
      const deletion = deletions[row];
      const addition = additions[row];
      left.push(diffHalf(deletion ? String(oldLine++) : "", deletion));
      right.push(diffHalf(addition ? String(newLine++) : "", addition));
    }
  }
}

function diffHalf(number: string, line: ParsedLine | undefined): HTMLElement {
  return element("div", { className: `diff-half ${line?.type ?? "empty"}` }, [
    element("span", { className: "line-number", text: number }),
    element("span", {
      className: "line-prefix",
      text: line?.type === "add" ? "+" : line?.type === "delete" ? "-" : " ",
    }),
    element("code", { text: line?.content ?? "" }),
  ]);
}

function parseDiff(diff: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let file: ParsedFile | null = null;
  let hunk: ParsedHunk | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      file = { path: match?.[2] ?? "unknown", hunks: [] };
      files.push(file);
      hunk = null;
    } else if (line.startsWith("@@ ") && file) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match?.[1] && match[2]) {
        hunk = {
          header: line,
          oldStart: Number(match[1]),
          newStart: Number(match[2]),
          lines: [],
        };
        file.hunks.push(hunk);
      }
    } else if (hunk && !line.startsWith("\\ No newline")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        hunk.lines.push({ type: "add", content: line.slice(1) });
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        hunk.lines.push({ type: "delete", content: line.slice(1) });
      } else if (line.startsWith(" ")) {
        hunk.lines.push({ type: "context", content: line.slice(1) });
      }
    }
  }
  return files.filter((candidate) => candidate.hunks.length);
}

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok)
    throw new Error((await response.text()) || `Request failed: ${response.status}`);
  return (await response.json()) as T;
}

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  void route();
}

function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : "An unexpected error occurred";
  app.replaceChildren(
    element("main", { className: "error-page" }, [
      element("p", { className: "eyebrow", text: "DIFF REPLAY" }),
      element("h1", { text: "Could not load this replay" }),
      element("pre", { text: message }),
      button("Back to replays", "button primary", () => navigate("/")),
    ]),
  );
}

function button(
  text: string,
  className: string,
  onClick?: () => void,
  type: "button" | "submit" = "button",
): HTMLButtonElement {
  const result = element("button", { className, text, type }) as HTMLButtonElement;
  if (onClick) result.addEventListener("click", onClick);
  return result;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: (HTMLElement | string)[] = [],
  onClick?: () => void,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "text") node.textContent = value;
    else if (key === "className") node.className = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key === "ariaLabel") node.setAttribute("aria-label", value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function riskClass(risk: string): string {
  const normalized = risk.toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium")) return "medium";
  return "low";
}

function relativeTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, "second");
}

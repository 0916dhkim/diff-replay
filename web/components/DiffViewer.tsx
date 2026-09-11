import type { AtomicStep, ParsedFile, ParsedHunk, ParsedLine } from "../types.js";
import { copyToClipboard, parseDiff, riskClass } from "../utils.js";
import { showToast } from "../api.js";
import { type Element, For, Show, createMemo, createSignal } from "solid-js";

const COPY_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';

const CHECK_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

function CopyPathButton(props: { path: string }) {
  const [copied, setCopied] = createSignal(false);
  let resetTimer: number | undefined;

  const handleClick = async (event: MouseEvent) => {
    event.stopPropagation();
    if (!(await copyToClipboard(props.path))) {
      showToast("Failed to copy file path");
      return;
    }
    setCopied(true);
    if (resetTimer != null) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      setCopied(false);
      resetTimer = undefined;
    }, 1_500);
  };

  return (
    <button
      class={`copy-path-button ${copied() ? "copied" : ""}`}
      type="button"
      aria-label="Copy file path"
      title={copied() ? "Copied!" : "Copy file path"}
      onClick={handleClick}
      innerHTML={copied() ? CHECK_ICON_SVG : COPY_ICON_SVG}
    />
  );
}

function UnifiedHunk(props: { hunk: ParsedHunk }) {
  let oldLine = props.hunk.oldStart;
  let newLine = props.hunk.newStart;

  return (
    <div class="unified-lines">
      <For each={props.hunk.lines}>
        {(line) => {
          const oldNumber = line.type === "add" ? "" : String(oldLine++);
          const newNumber = line.type === "delete" ? "" : String(newLine++);
          return (
            <div class={`diff-row ${line.type}`}>
              <span class="line-number">{oldNumber}</span>
              <span class="line-number">{newNumber}</span>
              <span class="line-prefix">
                {line.type === "add" ? "+" : line.type === "delete" ? "-" : " "}
              </span>
              <code>{line.content}</code>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function SplitFile(props: { file: ParsedFile }) {
  const left: Element[] = [];
  const right: Element[] = [];

  for (const hunk of props.file.hunks) {
    left.push(<div class="hunk-header">{hunk.header}</div>);
    right.push(<div class="hunk-header">{hunk.header}</div>);
    appendSplitHunk(hunk, left, right);
  }

  return (
    <div class="split-lines">
      <div class="split-pane">
        <div class="split-pane-inner">{left}</div>
      </div>
      <div class="split-pane">
        <div class="split-pane-inner">{right}</div>
      </div>
    </div>
  );
}

function appendSplitHunk(hunk: ParsedHunk, left: Element[], right: Element[]): void {
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

function diffHalf(number: string, line: ParsedLine | undefined) {
  return (
    <div class={`diff-half ${line?.type ?? "empty"}`}>
      <span class="line-number">{number}</span>
      <span class="line-prefix">
        {line?.type === "add" ? "+" : line?.type === "delete" ? "-" : " "}
      </span>
      <code>{line?.content ?? ""}</code>
    </div>
  );
}

interface DiffViewerProps {
  step: AtomicStep;
  viewMode: "split" | "unified";
  stepIndex: number;
  totalSteps: number;
}

export function DiffViewer(props: DiffViewerProps) {
  const parsedFiles = createMemo(() => parseDiff(props.step.diff));

  return (
    <div class="review-scroll">
      <section class="step-intro">
        <div class="step-kicker">
          <span>STEP {props.step.stepId}</span>
          <Show when={props.step.isCodegen}>
            <span class="type-badge codegen">CODEGEN</span>
          </Show>
          <Show when={props.step.isTest}>
            <span class="type-badge test">TEST</span>
          </Show>
          <Show when={!props.step.isCodegen && !props.step.isTest}>
            <span class="type-badge">PRODUCT</span>
          </Show>
          <span class={`risk risk-${riskClass(props.step.risk)}`}>{props.step.risk} risk</span>
        </div>
        <h1>{props.step.action}</h1>
        <p>{props.step.takeaway}</p>
        <div class="step-meta">
          <code>{props.step.filePath}</code>
          <span>
            {props.stepIndex + 1} of {props.totalSteps}
          </span>
        </div>
      </section>
      <Show
        when={parsedFiles().length > 0}
        fallback={<pre class="raw-diff">{props.step.diff}</pre>}
      >
        <section class={`diff-stack ${props.viewMode}`}>
          <For each={parsedFiles()}>
            {(file) => (
              <article class="diff-file">
                <header>
                  <code title={file.path}>{file.path}</code>
                  <CopyPathButton path={file.path} />
                </header>
                <div class="diff-body">
                  <Show
                    when={props.viewMode === "split"}
                    fallback={
                      <For each={file.hunks}>
                        {(hunk) => (
                          <>
                            <div class="hunk-header">{hunk.header}</div>
                            <UnifiedHunk hunk={hunk} />
                          </>
                        )}
                      </For>
                    }
                  >
                    <SplitFile file={file} />
                  </Show>
                </div>
              </article>
            )}
          </For>
        </section>
      </Show>
    </div>
  );
}

export default DiffViewer;

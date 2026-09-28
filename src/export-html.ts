import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Replay } from "./contracts.js";

// The generated bundle is the same Solid viewer used on the service, but with an
// offline entry point. Resolve only Vite's build assets, never a path from replay data.
async function inlineAsset(publicDirectory: string, assetPath: string): Promise<string> {
  if (!/^\/assets\/[a-zA-Z0-9._-]+\.(?:js|css)$/.test(assetPath)) {
    throw new Error(`Unexpected offline asset: ${assetPath}`);
  }
  return readFile(path.join(publicDirectory, assetPath.slice(1)), "utf8");
}

export async function renderOfflineHtml(publicDirectory: string, replay: Replay): Promise<string> {
  let html = await readFile(path.join(publicDirectory, "offline.html"), "utf8");
  const script = /<script\s+type="module"\s+crossorigin\s+src="(\/assets\/[^"]+)"\s*><\/script>/;
  const stylesheet = /<link\s+rel="stylesheet"\s+crossorigin\s+href="(\/assets\/[^"]+)"\s*\/?\s*>/;
  const scriptPath = html.match(script)?.[1];
  const cssPath = html.match(stylesheet)?.[1];
  if (!scriptPath || !cssPath) throw new Error("Offline viewer build assets are missing");

  const [js, css] = await Promise.all([
    inlineAsset(publicDirectory, scriptPath),
    inlineAsset(publicDirectory, cssPath),
  ]);
  // The online CSS imports Google Fonts. Offline exports must make no requests.
  const offlineCss = css.replace(
    /@import\s+(?:url\(\s*)?(["'])https:\/\/fonts\.googleapis\.com\/.*?\1\s*\)?\s*;/g,
    "",
  );
  const snapshot: Replay = { ...replay, state: { ...replay.state, notes: [] } };
  // Never allow untrusted diff/title text to terminate the JSON script element.
  const json = JSON.stringify(snapshot).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

  // Use replacement functions: minified bundles contain `$&`, `$'`, etc., which
  // String.replace would interpret as substitutions in a replacement string.
  html = html.replace(
    stylesheet,
    () => `<style>${offlineCss.replace(/<\/style/gi, "<\\/style")}</style>`,
  );
  html = html.replace(
    script,
    () =>
      `<script id="replay-data" type="application/json">${json}</script>\n` +
      `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  );
  return html;
}

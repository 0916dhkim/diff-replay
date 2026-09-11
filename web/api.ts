import type {} from "./types.js";

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok)
    throw new Error((await response.text()) || `Request failed: ${response.status}`);
  return (await response.json()) as T;
}

export function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 5_000);
}

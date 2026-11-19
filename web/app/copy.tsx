"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button type="button" className="btn" onClick={copy}>
      <span aria-live="polite">{state === "done" ? "Copied" : state === "failed" ? "Select and copy it" : "Copy URL"}</span>
    </button>
  );
}

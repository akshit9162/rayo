"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ";
const STEP_MS = 45;
const STEPS = 6;
const STAGGER = 2;

/**
 * Text that turns over like a split-flap board when it changes. Each cell runs a few
 * random glyphs, left to right, then lands. The server renders the final text, so it
 * reads the same without scripting or with reduced motion.
 */
export function Flip({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      return;
    }
    let tick = 0;
    const last = STEPS + STAGGER * text.length;
    const id = setInterval(() => {
      tick += 1;
      setShown(
        [...text]
          .map((ch, i) => (ch === " " || ch === "." || tick >= STEPS + STAGGER * i ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join(""),
      );
      if (tick >= last) clearInterval(id);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [text]);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

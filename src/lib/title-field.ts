// The note title is a textarea so a long title wraps inside the reading column
// instead of being clipped by a one-line input. It is still one line of text:
// line breaks become spaces, and Enter commits rather than breaking the line.

/** A title holds no line breaks; each break, with the space around it, becomes one space. */
export function singleLine(text: string): string {
  return text.replace(/[^\S\r\n]*(?:\r\n|\r|\n)+[^\S\r\n]*/g, " ");
}

/**
 * Svelte action: keep a textarea exactly as tall as its wrapped text. The
 * parameter is whatever changes the wrap (the value, the editor zoom); any
 * change re-measures. A change of width does too, since a narrower column
 * wraps into more lines.
 */
export function autosize(node: HTMLTextAreaElement, _deps?: unknown) {
  const fit = () => {
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  };
  let width = -1;
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          const next = entries[0]?.contentRect.width ?? -1;
          // Fitting changes only the height; reacting to that would loop.
          if (next === width) return;
          width = next;
          fit();
        });
  fit();
  observer?.observe(node);
  node.addEventListener("input", fit);
  return {
    update: fit,
    destroy() {
      observer?.disconnect();
      node.removeEventListener("input", fit);
    },
  };
}

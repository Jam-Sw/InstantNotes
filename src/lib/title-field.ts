export function singleLine(text: string): string {
  return text.replace(/[^\S\r\n]*(?:\r\n|\r|\n)+[^\S\r\n]*/g, " ");
}

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

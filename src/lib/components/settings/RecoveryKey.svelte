<script lang="ts">
  import qrcode from "qrcode-generator";
  import { toasts } from "$lib/stores/toasts.svelte";

  let { recoveryKey }: { recoveryKey: string } = $props();

  const QUIET = 4;

  const qr = $derived.by(() => {
    const code = qrcode(0, "M");
    code.addData(recoveryKey);
    code.make();
    const count = code.getModuleCount();
    let path = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (code.isDark(row, col)) path += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
      }
    }
    return { size: count + QUIET * 2, path };
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      toasts.show("Copied the recovery key.");
    } catch {
      toasts.show("Couldn't copy. Select the key and copy it instead.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`${recoveryKey}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "InstantNotes recovery key.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function print() {
    document.body.classList.add("printing-recovery-key");
    const done = () => document.body.classList.remove("printing-recovery-key");
    window.addEventListener("afterprint", done, { once: true });
    window.print();
  }
</script>

<div class="recovery">
  <p class="print-only print-title">InstantNotes recovery key</p>
  <div class="sheet">
    <svg
      class="qr"
      viewBox="0 0 {qr.size} {qr.size}"
      role="img"
      aria-label="Recovery key as a QR code"
      shape-rendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
    <code class="key" aria-label="Recovery key">{recoveryKey}</code>
  </div>
  <p class="print-only print-note">
    Keep this somewhere safe. With it, a new device can read your notes when no device you use is left.
  </p>
  <div class="actions">
    <button class="card-btn" onclick={copy}>Copy</button>
    <button class="card-btn" onclick={download}>Download</button>
    <button class="card-btn" onclick={print}>Print</button>
  </div>
</div>

<style>
  .sheet {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .qr {
    flex-shrink: 0;
    width: 112px;
    height: 112px;
    border-radius: 4px;
  }
  .key {
    min-width: 0;
    font-family: var(--font-meta);
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
    word-break: break-all;
    user-select: all;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .card-btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 13px;
  }
  .card-btn:hover {
    background: var(--bg-hover);
  }
  .print-only {
    display: none;
  }
  @media print {
    :global(body.printing-recovery-key *) {
      visibility: hidden;
    }
    :global(body.printing-recovery-key) .recovery,
    :global(body.printing-recovery-key) .recovery * {
      visibility: visible;
    }
    .recovery {
      position: fixed;
      inset: 0;
      padding: 48px;
      background: #fff;
      color: #000;
    }
    .print-only {
      display: block;
    }
    .print-title {
      margin: 0 0 16px;
      font-size: 18px;
      font-weight: 600;
    }
    .print-note {
      margin: 16px 0 0;
      font-size: 12px;
    }
    .sheet {
      border-color: #000;
    }
    .qr {
      width: 200px;
      height: 200px;
    }
    .key {
      color: #000;
      font-size: 15px;
    }
    .actions {
      display: none;
    }
  }
</style>

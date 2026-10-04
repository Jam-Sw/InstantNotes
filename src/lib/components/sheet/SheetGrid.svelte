<script lang="ts">
  // A sheet's grid: a real table of real cells, written in-house as Svelte
  // DOM and styled by the theme's tokens alone. Two modes, as in Sheets and
  // Excel: select (a cell is lit, no caret) and edit (a caret in one cell).
  // The pure parts live in $lib/sheet: the model and its edits, movement,
  // the key tables, and the clipboard format. This file owns focus, drawing,
  // and the dispatch from a key or a click to one of those.
  //
  // Focus. In select mode a hidden textarea (the "catcher") holds focus, so
  // the window's shortcut handler sees a typing target, IME composition has
  // somewhere to land, and copy, cut, and paste arrive as clipboard events
  // from the keys and the Edit menu alike. In edit mode a textarea sits over
  // the cell. The grid stops a key only when the key tables claim it; every
  // other key, every Cmd/Ctrl chord above all, goes on to the window.
  //
  // Saving. Every committed edit is handed to the owner at once as the
  // serialized grid; the save queue debounces. The one edit that can wait
  // is the cell being typed in, which `registerFlush` and unmount commit. A
  // `surfaceData` the grid did not emit itself (an agent's rows adopted by
  // the store) replaces what the grid shows, as an undoable step.
  import { onMount, tick, untrack } from "svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import {
    clearCells,
    columnName,
    deleteCols,
    deleteRows,
    display,
    insertCols,
    insertRows,
    MAX_CELL_CHARS,
    MAX_COLS,
    MAX_ROWS,
    parseSheet,
    pasteBlock,
    rangeBlock,
    resizeCol,
    serializeSheet,
    setCell,
    type Range,
    type Sheet,
  } from "$lib/sheet/model";
  import {
    clampSelection,
    coversFullCols,
    coversFullRows,
    inRange,
    isSingle,
    jumpEdge,
    moveBy,
    moveTo,
    rangeOf,
    selectAll,
    single,
    tabMove,
    type Selection,
  } from "$lib/sheet/selection";
  import { editIntent, selectIntent, type SelectIntent } from "$lib/sheet/keys";
  import { fromTsv, toTsv } from "$lib/sheet/tsv";

  interface Props {
    noteId: string;
    /** The grid as stored. Read at mount, and again whenever a value the
     *  grid did not emit arrives: that is another writer's grid to adopt. */
    surfaceData: string | null | undefined;
    readonly: boolean;
    onchange: (noteId: string, surfaceData: string) => void;
    registerFlush: (flush: () => void) => () => void;
  }

  let { noteId, surfaceData, readonly, onchange, registerFlush }: Props = $props();

  /** Fixed, so rows outside the viewport can be skipped by arithmetic. */
  const ROW_H = 26;
  const ROW_HEAD_W = 44;
  /** Past this many rows only the rows near the viewport are in the DOM. */
  const WINDOW_FROM = 200;
  const OVERSCAN = 12;
  const UNDO_LIMIT = 200;

  const id = untrack(() => noteId);

  interface Editing {
    r: number;
    c: number;
    value: string;
  }

  let sheet = $state.raw<Sheet>(parseSheet(untrack(() => surfaceData)));
  let sel = $state.raw<Selection>(single(0, 0));
  let editing = $state.raw<Editing | null>(null);
  let focused = $state(false);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let menu = $state<{ x: number; y: number; kind: "row" | "col"; index: number } | null>(null);

  // The serialized grid last handed out or taken in: an incoming value equal
  // to it is the grid's own, echoed back by the store.
  let lastSeen: string | null | undefined = untrack(() => surfaceData);
  let undoStack: { sheet: Sheet; sel: Selection }[] = [];
  let redoStack: { sheet: Sheet; sel: Selection }[] = [];
  // Where the current run of Tabs began: Enter returns to that column.
  let tabStartCol: number | null = null;
  let dragging = false;
  let resizing: { c: number; startX: number; before: Sheet } | null = null;

  let host = $state<HTMLDivElement>();
  let catcher = $state<HTMLTextAreaElement>();
  let editor = $state<HTMLTextAreaElement>();

  const rows = $derived(sheet.rows.length);
  const cols = $derived(sheet.cols.length);
  const range = $derived(rangeOf(sel));
  const tableWidth = $derived(ROW_HEAD_W + sheet.cols.reduce((sum, c) => sum + c.w, 0));

  // Only the rows near the viewport are in the DOM once a sheet is tall.
  const windowed = $derived(rows > WINDOW_FROM);
  const first = $derived(windowed ? Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN) : 0);
  const last = $derived(
    windowed
      ? Math.min(rows, Math.ceil((scrollTop + Math.max(viewportHeight, ROW_H)) / ROW_H) + OVERSCAN)
      : rows,
  );
  const visible = $derived(Array.from({ length: Math.max(0, last - first) }, (_, i) => first + i));

  // ---- the one way the grid changes ----

  /** Show `next`; when it differs, record the step for undo and hand it to
   *  the owner. `nextSel` follows, clamped to the new shape. */
  function apply(next: Sheet, nextSel: Selection = sel) {
    if (next !== sheet) {
      undoStack.push({ sheet, sel });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack = [];
      sheet = next;
      emit();
    }
    sel = clampSelection(nextSel, sheet.rows.length, sheet.cols.length);
  }

  function emit() {
    const raw = serializeSheet(sheet);
    lastSeen = raw;
    onchange(id, raw);
  }

  function undo() {
    const step = undoStack.pop();
    if (!step) return;
    redoStack.push({ sheet, sel });
    sheet = step.sheet;
    sel = clampSelection(step.sel, sheet.rows.length, sheet.cols.length);
    emit();
  }

  function redo() {
    const step = redoStack.pop();
    if (!step) return;
    undoStack.push({ sheet, sel });
    sheet = step.sheet;
    sel = clampSelection(step.sel, sheet.rows.length, sheet.cols.length);
    emit();
  }

  // Another writer's grid (an agent's rows, taken in by the store) replaces
  // what is shown. The step is undoable, as an agent's text edit is in the
  // editor, and a cell being typed in is kept: it commits onto the new grid.
  $effect(() => {
    const incoming = surfaceData;
    untrack(() => {
      if (incoming == null || incoming === lastSeen) return;
      lastSeen = incoming;
      undoStack.push({ sheet, sel });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack = [];
      sheet = parseSheet(incoming);
      sel = clampSelection(sel, sheet.rows.length, sheet.cols.length);
      if (editing && (editing.r >= sheet.rows.length || editing.c >= sheet.cols.length)) {
        editing = null;
      }
    });
  });

  // ---- editing ----

  async function startEdit(replaceWith?: string) {
    if (readonly) return;
    const { r, c } = sel.active;
    sel = single(r, c);
    editing = { r, c, value: replaceWith ?? sheet.rows[r][c] };
    await tick();
    if (!editor) return;
    editor.focus({ preventScroll: true });
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
    fitEditor();
  }

  function fitEditor() {
    if (!editor) return;
    editor.style.height = "0";
    editor.style.height = `${Math.max(ROW_H, editor.scrollHeight)}px`;
  }

  /** Put the typed value into the cell and move on. */
  function commitEdit(move: "down" | "up" | "right" | "left" | "stay") {
    if (!editing) return;
    const { r, c, value } = editing;
    editing = null;
    if (value.length > MAX_CELL_CHARS) {
      toasts.show(`A cell holds at most ${MAX_CELL_CHARS.toLocaleString()} characters; the rest was cut.`);
    }
    let next = setCell(sheet, r, c, value);
    let nextSel: Selection;
    switch (move) {
      case "down": {
        const col = tabStartCol ?? c;
        tabStartCol = null;
        // The last row grows the sheet, so a log never runs out of room.
        if (r === rows - 1) next = growRows(next, 1);
        nextSel = moveTo(sel, r + 1, col, next.rows.length, next.cols.length, false);
        break;
      }
      case "up":
        tabStartCol = null;
        nextSel = moveTo(sel, r - 1, c, rows, cols, false);
        break;
      case "right":
      case "left":
        tabStartCol ??= c;
        nextSel = tabMove(single(r, c), move === "left", rows, cols);
        break;
      default:
        nextSel = single(r, c);
    }
    apply(next, nextSel);
    focusCatcher();
  }

  function cancelEdit() {
    editing = null;
    focusCatcher();
  }

  function insertNewline() {
    if (!editor || !editing) return;
    const { selectionStart, selectionEnd } = editor;
    editor.setRangeText("\n", selectionStart, selectionEnd, "end");
    editing = { ...editing, value: editor.value };
    fitEditor();
  }

  /** Rows appended at the bottom, or a word about the cap when none fit. */
  function growRows(from: Sheet, n: number): Sheet {
    const grown = insertRows(from, from.rows.length, n);
    if (grown === from) toasts.show(`A sheet holds at most ${MAX_ROWS.toLocaleString()} rows.`);
    return grown;
  }

  function focusCatcher() {
    catcher?.focus({ preventScroll: true });
  }

  // ---- keys ----

  function onKeydown(e: KeyboardEvent) {
    if (editing) {
      const intent = editIntent(e);
      if (!intent) return;
      e.preventDefault();
      e.stopPropagation();
      if (intent.type === "commit") commitEdit(intent.move);
      else if (intent.type === "cancel") cancelEdit();
      else insertNewline();
      return;
    }
    const intent = selectIntent(e);
    if (!intent) return;
    e.preventDefault();
    e.stopPropagation();
    run(intent);
  }

  function run(intent: SelectIntent) {
    switch (intent.type) {
      case "move":
        tabStartCol = null;
        sel = moveBy(sel, intent.dr, intent.dc, rows, cols, intent.extend);
        break;
      case "jump":
        tabStartCol = null;
        sel = jumpEdge(sheet, sel, intent.dr, intent.dc, intent.extend);
        break;
      case "page": {
        tabStartCol = null;
        const page = Math.max(1, Math.floor(viewportHeight / ROW_H) - 1);
        sel = moveBy(sel, intent.dir * page, 0, rows, cols, intent.extend);
        break;
      }
      case "edge": {
        tabStartCol = null;
        const { r } = sel.active;
        const to = {
          rowStart: [r, 0],
          rowEnd: [r, cols - 1],
          first: [0, 0],
          last: [rows - 1, cols - 1],
        }[intent.where];
        sel = moveTo(sel, to[0], to[1], rows, cols, intent.extend);
        break;
      }
      case "tab":
        tabStartCol ??= sel.active.c;
        sel = tabMove(sel, intent.back, rows, cols);
        break;
      case "edit":
        void startEdit(intent.replaceWith);
        break;
      case "clear":
        if (!readonly) apply(clearCells(sheet, range));
        break;
      case "selectAll":
        sel = selectAll(rows, cols);
        break;
      case "undo":
        if (!readonly) undo();
        break;
      case "redo":
        if (!readonly) redo();
        break;
      case "leave":
        leave();
        break;
    }
  }

  /** Esc: out of the grid, back to the note list when there is one. */
  function leave() {
    catcher?.blur();
    document.querySelector<HTMLElement>(".note-row.selected")?.focus();
  }

  // IME composition lands in the catcher; what it produced starts an edit.
  function onCatcherInput(e: Event) {
    if (editing || (e as InputEvent).isComposing) return;
    takeCatcherText();
  }

  function takeCatcherText() {
    if (!catcher || editing) return;
    const text = catcher.value;
    catcher.value = "";
    if (text) void startEdit(text);
  }

  // ---- clipboard ----

  function onCopy(e: ClipboardEvent) {
    if (editing || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", toTsv(rangeBlock(sheet, range)));
  }

  function onCut(e: ClipboardEvent) {
    if (editing) return;
    onCopy(e);
    if (!readonly) apply(clearCells(sheet, range));
  }

  function onPaste(e: ClipboardEvent) {
    if (editing || readonly) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const block = fromTsv(text);
    const { r0, c0 } = range;
    // One value pasted over a range fills the range, as spreadsheets do.
    const fill =
      block.length === 1 && block[0].length === 1 && !isSingle(sel)
        ? Array.from({ length: range.r1 - r0 + 1 }, () =>
            Array.from({ length: range.c1 - c0 + 1 }, () => block[0][0]),
          )
        : block;
    const { sheet: next, clipped } = pasteBlock(sheet, r0, c0, fill);
    if (clipped) {
      toasts.show(
        `Some pasted cells didn't fit: a sheet holds at most ${MAX_COLS} columns and ${MAX_ROWS.toLocaleString()} rows.`,
      );
    }
    const r1 = Math.min(r0 + fill.length - 1, next.rows.length - 1);
    const c1 = Math.min(c0 + Math.max(...fill.map((row) => row.length)) - 1, next.cols.length - 1);
    apply(next, { anchor: { r: r0, c: c0 }, active: { r: r1, c: c1 } });
  }

  // ---- mouse ----

  function cellAt(target: EventTarget | null): { r: number; c: number } | null {
    const td = target instanceof Element ? target.closest<HTMLElement>("td[data-r]") : null;
    if (!td) return null;
    return { r: Number(td.dataset.r), c: Number(td.dataset.c) };
  }

  function onHostMousedown(e: MouseEvent) {
    if (e.button !== 0) return;
    if (editor && e.target instanceof Node && editor.contains(e.target)) return;
    // Keep focus in the grid: the cells themselves are not focusable.
    e.preventDefault();
    const cell = cellAt(e.target);
    if (cell) {
      if (editing && (editing.r !== cell.r || editing.c !== cell.c)) commitEdit("stay");
      else if (editing) return;
      tabStartCol = null;
      sel = e.shiftKey ? moveTo(sel, cell.r, cell.c, rows, cols, true) : single(cell.r, cell.c);
      dragging = true;
    }
    focusCatcher();
  }

  function onDrag(e: MouseEvent) {
    if (!dragging) return;
    const cell = cellAt(e.target);
    if (cell) sel = moveTo(sel, cell.r, cell.c, rows, cols, true);
  }

  function endDrag() {
    dragging = false;
  }

  function onCellDblclick(e: MouseEvent) {
    const cell = cellAt(e.target);
    if (!cell || editing) return;
    sel = single(cell.r, cell.c);
    void startEdit();
  }

  function onRowHeadMousedown(e: MouseEvent, r: number) {
    if (e.button !== 0) return;
    if (editing) commitEdit("stay");
    tabStartCol = null;
    const anchorRow = e.shiftKey ? sel.anchor.r : r;
    sel = { anchor: { r: anchorRow, c: 0 }, active: { r, c: cols - 1 } };
  }

  function onColHeadMousedown(e: MouseEvent, c: number) {
    if (e.button !== 0) return;
    if (editing) commitEdit("stay");
    tabStartCol = null;
    const anchorCol = e.shiftKey ? sel.anchor.c : c;
    sel = { anchor: { r: 0, c: anchorCol }, active: { r: rows - 1, c } };
  }

  function openMenu(e: MouseEvent, kind: "row" | "col", index: number) {
    e.preventDefault();
    if (readonly) return;
    menu = { x: e.clientX, y: e.clientY, kind, index };
  }

  /** The header menu's items: on the clicked row or column, or on the
   *  whole selected block of them when the click lands inside it. */
  function menuItems(kind: "row" | "col", index: number) {
    const whole =
      kind === "row"
        ? coversFullRows(range, cols) && index >= range.r0 && index <= range.r1
        : coversFullCols(range, rows) && index >= range.c0 && index <= range.c1;
    const from = whole ? (kind === "row" ? range.r0 : range.c0) : index;
    const count = whole ? (kind === "row" ? range.r1 - range.r0 : range.c1 - range.c0) + 1 : 1;
    const noun = kind === "row" ? "row" : "column";
    const what = count === 1 ? noun : `${count} ${noun}s`;
    const [before, after] = kind === "row" ? ["above", "below"] : ["left", "right"];
    const grow = (at: number) => {
      const next = kind === "row" ? insertRows(sheet, at, count) : insertCols(sheet, at, count);
      if (next === sheet) {
        toasts.show(
          kind === "row"
            ? `A sheet holds at most ${MAX_ROWS.toLocaleString()} rows.`
            : `A sheet holds at most ${MAX_COLS} columns.`,
        );
      }
      apply(next);
    };
    return [
      { label: `Insert ${what} ${before}`, run: () => grow(from) },
      { label: `Insert ${what} ${after}`, run: () => grow(from + count) },
      {
        label: `Delete ${what}`,
        danger: true,
        run: () => {
          const next = kind === "row" ? deleteRows(sheet, from, count) : deleteCols(sheet, from, count);
          const r = kind === "row" ? Math.min(from, next.rows.length - 1) : sel.active.r;
          const c = kind === "col" ? Math.min(from, next.cols.length - 1) : sel.active.c;
          apply(next, single(r, c));
        },
      },
    ];
  }

  // Column resize: live while dragging, one undo step and one save at the end.
  function startResize(e: PointerEvent, c: number) {
    if (readonly || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizing = { c, startX: e.clientX, before: sheet };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onResizeMove(e: PointerEvent) {
    if (!resizing) return;
    const start = resizing.before.cols[resizing.c].w;
    sheet = resizeCol(sheet, resizing.c, start + e.clientX - resizing.startX);
  }

  function endResize() {
    if (!resizing) return;
    const after = sheet;
    sheet = resizing.before;
    resizing = null;
    apply(after);
  }

  // ---- viewport ----

  function onScroll() {
    if (!host) return;
    scrollTop = host.scrollTop;
    viewportHeight = host.clientHeight;
  }

  /** Keep the active cell in view, by arithmetic, so it works for rows not
   *  in the DOM and never scrolls anything but the grid. */
  function reveal(active: { r: number; c: number }) {
    if (!host) return;
    const top = active.r * ROW_H;
    const viewTop = host.scrollTop;
    const viewH = Math.max(host.clientHeight - ROW_H, ROW_H);
    if (top < viewTop) host.scrollTop = top;
    else if (top + ROW_H > viewTop + viewH) host.scrollTop = top + ROW_H - viewH;
    let left = 0;
    for (let i = 0; i < active.c; i++) left += sheet.cols[i].w;
    const width = sheet.cols[active.c]?.w ?? 0;
    const viewLeft = host.scrollLeft;
    const viewW = Math.max(host.clientWidth - ROW_HEAD_W, width);
    if (left < viewLeft) host.scrollLeft = left;
    else if (left + width > viewLeft + viewW) host.scrollLeft = left + width - viewW;
    // The window follows at once, not on the scroll event that may follow.
    scrollTop = host.scrollTop;
  }

  $effect(() => {
    const active = sel.active;
    untrack(() => reveal(active));
  });

  function onFocusOut(e: FocusEvent) {
    if (host && e.relatedTarget instanceof Node && host.contains(e.relatedTarget)) return;
    focused = false;
    // A click elsewhere ends the edit the way Enter would, keeping the value.
    if (editing) {
      const { r, c, value } = editing;
      editing = null;
      apply(setCell(sheet, r, c, value), single(r, c));
    }
  }

  onMount(() => {
    const unregister = registerFlush(() => commitEdit("stay"));
    onScroll();
    const observer =
      typeof ResizeObserver === "function" && host
        ? new ResizeObserver(() => onScroll())
        : null;
    if (host) observer?.observe(host);
    window.addEventListener("mouseup", endDrag);
    return () => {
      unregister();
      observer?.disconnect();
      window.removeEventListener("mouseup", endDrag);
      // A cell still being typed in is not dropped on the way out.
      if (editing) {
        const { r, c, value } = editing;
        editing = null;
        const next = setCell(sheet, r, c, value);
        if (next !== sheet) {
          sheet = next;
          emit();
        }
      }
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="sheet"
  class:focused
  class:readonly
  data-sheet
  bind:this={host}
  onscroll={onScroll}
  onkeydown={onKeydown}
  oncopy={onCopy}
  oncut={onCut}
  onpaste={onPaste}
  onmousedown={onHostMousedown}
  onfocusin={() => (focused = true)}
  onfocusout={onFocusOut}
>
  <textarea
    class="catcher"
    bind:this={catcher}
    aria-label="Sheet cells"
    readonly={readonly}
    oninput={onCatcherInput}
    oncompositionend={takeCatcherText}
  ></textarea>
  <table
    role="grid"
    aria-rowcount={rows}
    aria-colcount={cols}
    style:width="{tableWidth}px"
    onpointermove={onResizeMove}
    onpointerup={endResize}
    onpointercancel={endResize}
  >
    <colgroup>
      <col style:width="{ROW_HEAD_W}px" />
      {#each sheet.cols as col, c (c)}
        <col style:width="{col.w}px" />
      {/each}
    </colgroup>
    <thead>
      <tr>
        <th class="corner" aria-label="Select all" onmousedown={() => (sel = selectAll(rows, cols))}></th>
        {#each sheet.cols as _, c (c)}
          <th
            class="colhead"
            class:lit={c >= range.c0 && c <= range.c1}
            scope="col"
            onmousedown={(e) => onColHeadMousedown(e, c)}
            oncontextmenu={(e) => openMenu(e, "col", c)}
          >
            {columnName(c)}
            {#if !readonly}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="resize" onpointerdown={(e) => startResize(e, c)}></span>
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody onmousemove={onDrag} ondblclick={onCellDblclick}>
      {#if first > 0}
        <tr class="pad" style:height="{first * ROW_H}px"><td colspan={cols + 1}></td></tr>
      {/if}
      {#each visible as r (r)}
        <tr>
          <th
            class="rowhead"
            class:lit={r >= range.r0 && r <= range.r1}
            scope="row"
            onmousedown={(e) => onRowHeadMousedown(e, r)}
            oncontextmenu={(e) => openMenu(e, "row", r)}
          >
            {r + 1}
          </th>
          {#each sheet.cols as _, c (c)}
            {@const active = sel.active.r === r && sel.active.c === c}
            {@const selected = inRange(range, r, c)}
            <td
              role="gridcell"
              data-r={r}
              data-c={c}
              class:active
              class:selected
              aria-selected={selected}
            >
              {#if editing && editing.r === r && editing.c === c}
                <textarea
                  class="cell-editor"
                  bind:this={editor}
                  rows="1"
                  spellcheck="false"
                  autocapitalize="off"
                  aria-label="Cell {columnName(c)}{r + 1}"
                  value={editing.value}
                  oninput={(e) => {
                    editing = editing && { ...editing, value: e.currentTarget.value };
                    fitEditor();
                  }}
                ></textarea>
              {:else}
                <span class="cell-text">{display(sheet, r, c)}</span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
      {#if last < rows}
        <tr class="pad" style:height="{(rows - last) * ROW_H}px"><td colspan={cols + 1}></td></tr>
      {/if}
    </tbody>
  </table>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.kind, menu.index)} onclose={() => (menu = null)} />
{/if}

<style>
  .sheet {
    position: relative;
    height: 100%;
    overflow: auto;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 13px;
    user-select: none;
    -webkit-user-select: none;
    cursor: cell;
  }
  .catcher {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    resize: none;
    overflow: hidden;
    pointer-events: none;
  }
  table {
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
  }
  th,
  td {
    box-sizing: border-box;
    height: 26px; /* ROW_H */
    padding: 0;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    white-space: pre;
    text-align: left;
    vertical-align: middle;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg-sidebar);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
    text-align: center;
  }
  .corner {
    position: sticky;
    left: 0;
    z-index: 3;
  }
  .colhead {
    position: relative;
  }
  .rowhead {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--bg-sidebar);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    text-align: center;
  }
  th.lit {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .colhead .resize {
    position: absolute;
    top: 0;
    right: -3px;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    z-index: 2;
  }
  td {
    position: relative;
    background: var(--bg);
  }
  td.selected {
    background: var(--accent-soft);
  }
  td.active {
    outline: 2px solid var(--border);
    outline-offset: -2px;
  }
  .focused td.active {
    outline-color: var(--accent);
  }
  .cell-text {
    display: block;
    padding: 0 6px;
    line-height: 25px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cell-editor {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 4;
    width: 100%;
    min-height: 100%;
    margin: 0;
    padding: 0 6px;
    box-sizing: border-box;
    border: 2px solid var(--accent);
    border-radius: 0;
    outline: none;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    line-height: 22px;
    white-space: pre-wrap;
    resize: none;
    overflow: hidden;
    cursor: text;
  }
  .pad td {
    border: none;
    background: transparent;
  }
  .readonly {
    cursor: default;
  }
</style>

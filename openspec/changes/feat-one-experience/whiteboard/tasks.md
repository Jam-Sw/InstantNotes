# Tasks: The whiteboard, finished

- [x] `WhiteboardCanvas.svelte`: `touch-action: none`, the pen tool first on
      touch; `document.ts` test (`openingAppState` in `document.test.ts`);
      palm rejection while the pen is down and pen mode on the first pen
      (`PenGuard`, `pen.test.ts`)
- [x] `src/lib/qr.ts` from `RecoveryKey.svelte`; test (`qr.test.ts`: module
      count, `noteLink`, `linkedNoteId`)
- [x] `OpenElsewhere.svelte` dialog; the header button; `note.openElsewhere`
- [x] `library.svelte.ts`: `#note=<id>` at start; test (`openLinked` in
      `library.svelte.test.ts`: selects, waits, gives up)
- [ ] CHANGELOG lines (the integrator)
- [ ] In the app: the dialog; the owner's iPhone and iPad (scan, draw with
      the Pencil, palm on the glass). Web build checked at 390x844 and
      820x1180 with synthetic pen and touch events in Chrome; real hardware
      is the owner's.

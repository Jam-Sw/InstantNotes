# Change: Tab and Shift+Tab nest list items in the editor

## Why
The editor had no Tab handling for lists, so there was no way to create a sublist or
un-nest one with the keyboard. Nesting is a basic outlining need: pressing Tab on a list
item should indent it into a sublist, and Shift+Tab should outdent it back.

## What Changes
- Add a pure `listIndentChanges` helper that computes the indent/outdent change set for
  every list line a selection touches.
- Bind Tab and Shift+Tab in the editor (before the default keymap) to apply it: Tab nests
  by two spaces, Shift+Tab un-nests by up to two. Bullet (-, *, +) and ordered (1.)
  markers are recognized.
- Leave non-list lines to the editor's existing default Tab behavior.

## Impact
One new pure module with unit tests and one keymap in the editor. Ordered lists are not
renumbered (markdown renderers handle nesting). Always on, no new setting. CodeMirror
remaps the selection through the line-anchored changes so the caret stays with its text.

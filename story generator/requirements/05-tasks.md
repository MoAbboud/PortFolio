# Breakdown Takes - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 5 - One implementation

- [ ] Decide: delete the React version, or move it somewhere clearly marked as an
      alternative
- [ ] List what the two versions do differently before removing either, so nothing worth
      keeping is lost
- [ ] Make sure the plain page has everything worth keeping from the component
- [ ] Say in the folder's README which file is the live one

## Stage 6 - Stop losing stories

- [ ] Keep the story description in browser storage as it is edited
- [ ] Restore it on open, and let the worked example be reloaded deliberately
- [ ] Decide whether the tracking file is the archive or a log, and either treat it as an
      archive or drop the full-description column
- [ ] Confirm validation catches a parent reference to a beat that does not exist
- [ ] Confirm validation catches a story with no root beat
- [ ] Confirm validation catches a cycle in the parent links, rather than looping

## Later

- [ ] Pace per beat rather than one pace for the whole story
- [ ] Confirm the controls auto-hide on every path into playback, not just the usual one
- [ ] A way to reload the worked example after the story has been replaced

## Done and verified

- [x] Automatic layout from parent links, with nothing positioned by hand
- [x] Depth in the parent chain drives vertical position, so the vertical axis is the
      passage of the story
- [x] Beats sharing a depth spread evenly across the width, or centred when alone
- [x] Positions as percentages, so the layout survives a resize at any board size
- [x] Six fixed roles, each with one colour driving both the node and the legend
- [x] Legend built from the roles present
- [x] Reveal one beat at a time on a timer, at a chosen pace
- [x] Play, pause, step forward and reset
- [x] Reveal everything at once, for checking the layout before recording
- [x] Reveal driven by a single visible count, so step and reset are one number
- [x] Malformed stories rejected with an explanation, before anything is drawn
- [x] Controls hide themselves during playback so they stay out of the recording
- [x] Editor and board as two explicit views, with the description preserved when going back
- [x] Worked example loaded on open
- [x] Tracking row appended to a chosen spreadsheet file, with a download fallback where
      appending is unavailable
- [x] Runs from a file with no server, no build step and no network call

## Explicitly not doing

- Generating or suggesting story content.
- Recording, audio, subtitles, or rendering a finished video.
- Fetching stories from anywhere.
- Dragging beats around by hand.

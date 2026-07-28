# Snowball Creator - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 5 - Describe it accurately

- [ ] Decide: correct the description, or actually generate the prompts
- [ ] If correcting: remove the claim that the prompts are generated, from the README and
      anywhere else it appears
- [ ] Say plainly in the interface that the prompts are general moves, so repetition on a
      long chain reads as intended rather than as a fault
- [ ] If generating instead: accept that it needs a key, costs money per use, and sends the
      writer's text off the page, and record that decision explicitly

## Stage 6 - Stop losing work

- [ ] Keep the chain in browser storage as it grows
- [ ] Restore it on load, and offer to discard it rather than restoring silently
- [ ] Warn before reset, and offer an export first
- [ ] Warn before leaving the page with an unexported chain
- [ ] Decide whether the export should be re-importable, and if so add a second format

## Stage 7 - Real branching

- [ ] Decide whether the tree should branch at all, or whether the metaphor should go
- [ ] If it branches: let the writer select an earlier link and take a different direction
      from it while keeping the first
- [ ] Work out what the prose view means when there is more than one path
- [ ] If it does not branch: change the visual so it stops implying a fork that is not there

## Smaller fixes

- [ ] The word count includes the connecting phrases the app inserted, so it reads higher
      than the writer's own count. Either count only the writer's words or say what is
      being counted
- [ ] Confirm every keyboard shortcut is discoverable from the page itself, not only from
      the README

## Done and verified

- [x] Seed entry, with an empty seed rejected and a toast rather than a silent failure
- [x] Three directions offered per step, cycling by position in the chain
- [x] Custom input as an always-available fourth option
- [x] Choice extends the chain and the loop repeats
- [x] Tree view rebuilt from the chain, one level per link, with connections drawn between
      levels
- [x] Staggered reveal per level and per node, so a rebuilt tree grows rather than blinks
- [x] Prose view stitched from the chain with varied connecting phrases
- [x] Running word count
- [x] Undo, removing the last link and rebuilding both views
- [x] Reset back to a blank seed
- [x] Export to a text file
- [x] Copy to the clipboard
- [x] Keyboard shortcuts for undo, reset, export, copy and option selection
- [x] Hold-to-select on pointer input, with early release cancelling and a guard against
      one intention extending the chain twice
- [x] Immediate selection on keyboard input, bypassing the hold
- [x] Toast notifications rather than blocking dialogs
- [x] Background animation defined entirely in the style file
- [x] Every timing, prompt set, connecting phrase and message in one configuration object
- [x] Element references cached once at startup
- [x] Responsive layout
- [x] Runs from a file with no server, no build step and no network call

## Explicitly not doing

- Writing any of the content for the writer.
- Sending anything typed into the page anywhere, unless stage 5 is resolved the other way
  and that trade is made deliberately.
- Accounts, sync, or sharing.

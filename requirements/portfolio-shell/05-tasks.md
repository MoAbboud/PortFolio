# Portfolio landing page - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 3 - Projects as a list

- [ ] Define a project in one place: identifier, label, icon, position, destination
- [ ] Generate the boxes from that list instead of writing them into the scene
- [ ] Move box positions out of the style file into the list
- [ ] Decide how the scene handles eight boxes rather than two, before adding them
- [ ] Confirm two boxes near each other cannot make acting ambiguous, or space them so it
      cannot happen

## Stage 4 - Wire up the portfolio

- [ ] Decide which projects belong on the front door
- [ ] Decide what to do with the two Python projects, which do not run as static pages
- [ ] Add a box for the resume
- [ ] Add a box for tektak
- [ ] Add a box for the story tool
- [ ] Add a box for whereyago
- [ ] Decide whether the professional client work listed in the repository README belongs
      on the page
- [ ] Confirm relative destinations work the way the repository is actually deployed, not
      just locally

## Stage 5 - Say what things are

- [ ] Show a line of description when a box becomes reachable, or on hover
- [ ] Check the page is usable from a keyboard, and that assistive technology can follow it
- [ ] Confirm the instructions still make sense with more boxes on screen

## Stage 6 - Keep the links alive

- [ ] Check every destination still resolves
- [ ] Decide how a dead destination is caught before a visitor finds it
- [ ] Confirm the external project is still hosted where the page points

## Done and verified

- [x] A character that moves on keyboard input
- [x] On-screen touch controls for devices with no keyboard
- [x] Boxes highlight and animate when the character is close enough
- [x] Acting while a box is reachable opens it
- [x] Clicking any box opens it directly, with no need to touch the game
- [x] Jump animation and particles on opening
- [x] Opened boxes marked as visited for the session
- [x] Instructions and controls visible on arrival
- [x] All animation defined in the style file
- [x] Nothing stored, sent or counted about the visitor
- [x] No dependency, no build step, no network call

## Explicitly not doing

- Any analytics or visit counting.
- Making the game mandatory to reach a project.
- Score, levels, progress, or an ending.
- Holding project descriptions beyond a name and, later, one line.

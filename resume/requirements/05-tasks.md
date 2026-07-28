# Interactive Resume - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 4 - Accessibility

The next work, and the one that matters most given what this page is claiming.

- [ ] Reach and operate the skill filter from a keyboard alone
- [ ] Reach and operate the role expanders from a keyboard alone
- [ ] Announce expanded and collapsed state to assistive technology
- [ ] Visible focus indicator, checked in both themes
- [ ] Respect a reduced-motion preference: stop the typing line, the pointer spotlight and
      the card tilt
- [ ] Make sure sections still appear when reveal animation is suppressed, rather than
      staying hidden
- [ ] Check contrast across both themes, including the muted text and the skill bars
- [ ] Give the skill bars a text equivalent, so the level is not conveyed by width alone
- [ ] Confirm the page is readable with styles disabled

## Stage 5 - Printing

- [ ] Expand every role when printing
- [ ] Drop the decoration: progress bar, spotlight, tilt, background effects
- [ ] Force the light theme
- [ ] Make sure filtered-out skills are not missing from the printed page
- [ ] Check it fits sensibly across pages

## Stage 6 - Keep it current

- [ ] Review the content against reality
- [ ] Check every technology tagged on a role appears in the skills list, or keep the two
      in one place so they cannot disagree
- [ ] Decide whether the projects should link to the other apps in this repository
- [ ] Confirm every outbound link still goes somewhere

## Done and verified

- [x] Single file: structure, styles and behaviour, with no dependency and no build step
- [x] Skills, work history and projects rendered from lists rather than written into markup
- [x] Skills grouped into a fixed set of kinds, with a working filter
- [x] Skill bars showing self-assessed relative depth
- [x] Work history as a timeline with expandable roles
- [x] Most senior role expanded by default
- [x] Technologies shown per role
- [x] Project cards
- [x] Education and contact sections
- [x] Header with a role line that types through several descriptions
- [x] Section reveal on scroll
- [x] A separate viewport observer for the skill bars, so the fill is seen rather than
      finished before the reader arrives
- [x] Counters animating on reveal
- [x] Pointer spotlight and card tilt
- [x] Scroll progress bar
- [x] Both themes complete
- [x] Theme choice remembered between visits, as the only thing stored
- [x] Responsive layout with a mobile menu

## Explicitly not doing

- Any analytics, tracking, or visit counting.
- A contact form. Nothing would receive it.
- A back end, an account, or a content management system.
- Tailored versions of the resume per application.

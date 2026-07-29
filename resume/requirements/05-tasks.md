# Interactive Resume - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Built in the rebuild

- [x] Fixed stage exactly one viewport high, with the document unable to scroll
- [x] Seven pages across six sections, with sections derived from the page list
- [x] Experience paged one role at a time, so no content is cut to make a screen fit
- [x] Lateral axis: every animated element travels on X
- [x] Vertical input mapped onto lateral movement, in the keyboard, the wheel and touch
- [x] Wheel reads whichever of the two axes is larger, so horizontal trackpad gestures work
- [x] Direction-aware transitions, forward and backward genuinely different
- [x] Light theme as the default and the designed-first theme
- [x] Six section hues, applied by one root attribute so everything accented cross-fades
- [x] Vivid and ink form for each hue, so small text keeps its contrast on a light ground
- [x] Per-card and per-column hues on Projects and Capabilities
- [x] Horizontal section rail replacing the vertical rail and the header navigation
- [x] Stagger driven by a CSS index rather than scheduled in JavaScript
- [x] Masked line reveals on the display type
- [x] Navigation locked during a transition, so input cannot outrun the animation
- [x] Keyboard: arrows, page keys, space, home, end, digits for sections
- [x] Wheel read as intent, accumulated and thresholded for trackpads
- [x] Touch swipe, horizontal and vertical
- [x] Section rail, header navigation, mobile menu, page counter, paging arrows
- [x] Address hash carrying the page number, readable and writable, so a page can be linked
- [x] Content rendered from lists, one renderer per page kind
- [x] Role tags drawn only from technologies the same role's bullets name
- [x] Capability groups as four columns, collapsing to one group at a time on a narrow screen
- [x] Project cards with a pointer-tracked glow
- [x] Counters animating on arrival
- [x] Pointer reticle and parallax halo, both skipped without a hover-capable pointer
- [x] Both themes complete, and the theme remembered as the only thing stored
- [x] Storage wrapped, so a browser refusing it falls back rather than throwing
- [x] Offscreen pages inert, so they are neither tabbable nor read by assistive technology
- [x] Position announced to assistive technology when it changes
- [x] Visible focus indicator using the accent colour
- [x] Reduced motion honoured: transitions removed rather than shortened, pointer effects and
      grain removed entirely
- [x] Print stylesheet collapsing the stage back into a stacked document
- [x] Self-assessed proficiency percentages removed, since nothing supported them
- [x] Verified no external resource loads of any kind

## Verification still to do

The page is built. These are the checks that have not been performed, and none of them
should be reported as done until they have been.

- [ ] Read the whole page from a keyboard alone, on a real browser, and confirm focus never
      lands on an offscreen page
- [ ] Confirm the reduced-motion path with the preference actually set, not just in the code
- [ ] Measure contrast in both themes, including the muted text, the faint monospace labels
      and **each of the six accent inks** on each background. Amber is the one most likely to
      fail, and the ink forms were chosen by eye rather than measured
- [ ] Confirm the six hues are distinguishable to a reader with colour vision deficiency, or
      confirm that nothing depends on colour alone. The rail carries names as well as
      colours, which should be enough, but it has not been checked
- [ ] Print to a file in both themes and confirm the result is a usable document
- [ ] Check every page at 1280x720 and 1366x768, the two sizes most likely to overfill
- [ ] Check the capabilities page on a narrow screen, since it is the densest
- [ ] Confirm the safety valve is not engaging at ordinary laptop sizes on any page
- [ ] Test on a touch device: swipe thresholds, the menu, and the missing reticle
- [ ] Confirm every outbound link goes somewhere

## Known gaps

- [ ] **The Claude Design project is stale.** It holds the abandoned dark, single-orange,
      vertically-moving scheme. Re-push it once the visual direction settles rather than
      after every iteration

- [ ] **No JavaScript means no content.** The stage is built by script, so a reader with
      script disabled gets an empty page. The previous version degraded to a readable
      document. Decide whether to accept this, or to author the pages in markup and have the
      script only take over navigation
- [ ] The `story generator` sibling app is not linked. It has no `index.html`, only
      `breakdown-takes.html`, and the projects grid is built for six cards
- [ ] `fallacysuspect` and `evaluaters` link to the GitHub profile rather than to
      themselves, because neither has a web entry point

## Keep it current

- [ ] Review the content against reality whenever anything changes
- [ ] Re-check that each role's tags are still named in that role's own bullets
- [ ] Confirm every outbound link still goes somewhere
- [ ] If a role is added, confirm the Experience section still fits its pages

## Explicitly not doing

- Scrolling or zooming as a navigation model. Both were offered and rejected.
- Any analytics, tracking, or visit counting.
- A contact form. Nothing would receive it.
- A back end, an account, or a content management system.
- Proficiency scores against capabilities.
- Tailored versions of the resume per application.

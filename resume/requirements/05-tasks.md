# Interactive Resume - Tasks

Checked means done and verified. "Verified" here means exercised in a real browser (headless
Chrome driven over the DevTools protocol, unless it says otherwise), not only written.

## Built and verified

- [x] Content in the markup; the page reads as a document without script
- [x] Stage: lateral, direction-aware motion; keys, wheel, swipe, rail, pager, number keys
- [x] Named addresses (`#projects`), with the old numeric ones and `#projects-more` still resolving
- [x] Focus follows the reader between pages; visible focus in both themes
- [x] Reduced motion stops motion, counting, the gallery and the clip
- [x] Contrast measured: small labels 5.4:1 light, 5.5:1 dark; large display words 3:1 or better
- [x] Link-preview tags and image; favicon and touch icon
- [x] Print gives a two-page resume; the PDF is generated from it with working links
- [x] Headline-first experience; one detail open at a time per role
- [x] One-page view, remembered; "Change to one page" note for first-time visitors
- [x] Project gallery: auto-advance, pause controls, endless in both directions, swipe, drag, keys, side-card click, the front card opening into its picture
- [x] Trail clip plays only when its card is in front and on screen
- [x] Capabilities: five groups, evidence panel, unproven skills marked
- [x] Self-hosted Geist and Geist Mono with their licence
- [x] No stage page needs its internal scroll at 1920x1080, 1440x900, 1366x768, 1280x720 or 820x1180
- [x] An idle page requests no animation frames
- [x] Checked on a real phone (the author)

## Open

- [ ] Safari, desktop and iPhone: the stage, the gallery clip (WebM), backdrop blur on the gallery panel
- [ ] Firefox: exclusive `<details>` (needs 130+), the gallery, the fonts
- [ ] A screen reader, end to end: the stage's slide announcements, the gallery's carousel semantics, the evidence panel
- [ ] Turn the layout and behaviour checks into tests that run in CI on every push
- [ ] Fallacy Detector and Pneumonia Detection link to live apps once hosted
- [ ] A real screenshot for Pneumonia Detection after its new interface
- [ ] Herder: drop "In progress" once testing is done and a demo exists
- [ ] Update the Claude Design project to the current page

## Optional

- [ ] Sections easing in as they scroll in the one-page view (CSS scroll-driven, fails soft)
- [ ] A short clip for Story Takes revealing its tree, like Trail's

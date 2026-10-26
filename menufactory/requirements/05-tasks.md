# Menu Factory - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked at phone width
(390px) in both motion levels.

Nothing is started. Stage 0 can begin once the author has answered P3 to P5 in 00-plan.md
(the language and the tools), or says to go ahead on the proposals.

## Stage 0 - Scaffold and motion spike

- [x] `menufactory/designs/` with `cocktail-bar/`, `bar/`, `restaurant/`, gitignored so the
      exports never reach GitHub (2026-10-25)
- [x] A `menufactory/node_modules/` rule in the root `.gitignore` (2026-10-25)
- [x] Plain-files layout as in 03-architecture: `brand.js`, `looks/`, `looks-src/`
      (ignored), `shared/`, `shared/lib/`, `venues/`, `schema/`, `tests/`, `tools/`,
      `package.json` for development tools only. `git check-ignore -v` on every new folder
- [x] GSAP 3.15.0 and Three.js 0.186.1 copied into `shared/lib/` by `npm run pin-libs`, with
      a test that they match package.json
- [x] `brand.js` with the working name, and the test that fails if the name appears in
      `looks/`, `shared/`, `library/`, `admin/` or `venues/`
- [x] The venue JSON schema covering every entity in 04-data-model, checked by a test
- [~] A made-up cocktail bar, `venues/quillfeather/`: late hours, holiday exceptions, happy
      hour, cocktails with ingredients and pours, a long name, a sold-out drink, a small food
      menu, weekly, monthly and one-off events, notices. Still missing: photos the author is
      free to use
- [x] Hours, happy hour and expiry logic with the case table (30 tests): past midnight,
      split days, exceptions with and without hours, a closure lasting days, both daylight
      saving changes, closing soon, happy hour past midnight and only while open, notices
      and events by date
- [x] The motion button: visible on every page, starts from the device setting, remembers
      the choice, every look reads one setting - checked in Chrome
- [x] `shared/render.js`: loads a venue into its look, `?look=` override, preview bar, the
      motion button added after every look
- [x] A scaffold look, `starter`, to prove the pipeline before the first real design; never
      in the library
- [x] `npm run check`: every venue in every look in headless Chrome, both motion levels,
      390px and 1280px, axe-core WCAG 2.1 AA, no sideways scroll, screenshots
- [x] `.github/workflows/test-menufactory.yml` and the badge in the root README
- [ ] `deploy/build-static.mjs` copies `menufactory/` into the published site, leaving out
      `requirements/`, `tests/`, `tools/`, `designs/`, `looks-src/` and development tools;
      `pages.yml` gains `menufactory/**`. Held back on purpose until the first real look
      exists, so the scaffold never goes live
- [x] The obfuscation script, `npm run publish-looks` (P36). Still to measure: its cost on a
      real look's animation, in the spike
- [x] `looks-src/` is a private GitHub repository, `menufactory-looks` (2026-10-25; moved up
      one level after GitHub Desktop created it inside `looks-src/`). Its first commit of the
      starter look is the author's
- [x] The obfuscation is seeded, so an unchanged look publishes byte for byte the same
- [ ] **Spike: one real Claude Design export** (the author makes it) taken through
      "From a design to a look" in 03-architecture: venue content in its slots, both motion
      levels, rendered at 390px and 1280px. Write what worked and what did not into
      03-architecture
- [ ] Weight budgets proposed from the spike's real numbers, agreed with the author
- [x] Browser checks set up (puppeteer-core and the installed Chrome): open a page, switch the motion
      button, take screenshots

Check:

    cd menufactory
    npm install
    npm test
    npm run check
    npm run serve

The last line serves the folder as plain files, the way Pages will, and prints the address
of every sample venue.

## Stage 1 - First cocktail bar look

- [ ] The author's design built into `looks/<name>/` with `look.json`
- [ ] Home: name, logo, open-now and happy-hour lines, phone, address readable at once
- [ ] Menu: sections, jump links, ingredients, prices and pours, happy hour prices marked,
      tags as icon plus text
- [ ] Events, past one-off events dropped
- [ ] Notices with start and end dates
- [ ] `tools/prerender.mjs` (P41): name, call button, address, weekly and holiday hours and
      the whole menu as plain HTML in each venue's `index.html`; `render.js` removes it once
      the look has drawn; a test that every page matches its `venue.json`
- [ ] Structured data (P42): `BarOrPub` / `Restaurant`, opening and special hours, the full
      menu with prices - validated
- [x] Call button first, "Call to order" when `phone_orders` is set; "Order online" and
      "Request a table" when `order_url` / `reserve_url` are set (P43) - schema, renderer and
      starter look, 2026-10-26
- [x] First-screen check at 390x844: name, open-now line, menu link, call button (P44)
- [x] Menu type-size check at 390px (P45); the `data-role` marks every look must carry
- [ ] Event inquiry for bars that opens the guest's email app (P47)
- [ ] Content check in the tests: zero prices, placeholder text, seasonal menus past their
      end date, copyright year never typed (P49)
- [ ] Manual accessibility pass on the first look: keyboard, NVDA, VoiceOver, written up (P52)
- [ ] Images: resized, location data stripped, `alt` required
- [ ] The full show and the designed calm version
- [ ] Content first: main content visible within the target before the art loads
- [ ] Checks pass in both motion levels: axe-core AA, weight budget, Lighthouse, 390px
- [ ] Readable with JavaScript off, apart from the live lines and motion

## Stage 2 - Second look, switching proven

- [ ] A second cocktail bar look (the author's, or one proposed here and approved)
- [ ] The sample bar in both looks with only `STYLE.look` changed
- [ ] A second made-up bar: very long menu, no interior photos, a single-colour logo
- [ ] A test that renders every sample in every look, in both motion levels
- [ ] Any field added to the schema has a fallback when empty, and stage 1 still passes

## Stage 3 - Library page

- [ ] Every look, each shown with a sample, filter by kind of place
- [ ] Built from each look's `look.json`; the product name from `brand.js`
- [ ] Passes the same checks as a venue site
- [ ] Where it is hosted (00-plan open question 9)

## Stage 4 - Owner admin

- [ ] **Spike: Sveltia CMS on Pages.** Admin page served from Pages, the sign-in helper on
      Cloudflare Workers, a save that commits and republishes. Watch a non-technical person
      create a GitHub account and sign in. Decide P27
- [ ] Owner access: each owner reaches their own venue's repository only
- [ ] The short first screen: Menu, Hours, Happy hour, Events, Notices, Photos, Look
- [ ] Every screen usable on a phone; no developer words anywhere
- [ ] Save, restore an earlier version; drafts and preview in the real look if the admin
      supports them
- [ ] Uploads: images only, size-limited, resized, location data stripped, "describe this
      photo" asked in plain words
- [ ] No field anywhere that changes layout, motion, fonts or art - a test checks the
      admin's editable fields against the "may change" list in 04-data-model
- [ ] Look screen: the owner's content in other looks, "ask for this look"
- [ ] Publishing: a save triggers the publish workflow, the checks run, and a failed check
      publishes nothing
- [ ] Watched by hand: someone non-technical changes a price, adds an event and undoes it
      from a phone, without help. Written down what confused them

## Stage 5 - Previews and intake

- [ ] Preview mode: bar on every page, `noindex` on every page, disallow-all `robots.txt`
- [ ] A test that fails if a preview build is missing any of the three
- [ ] Intake checklist (menus, hours, holidays, happy hour, events, photos, logo, socials,
      domain)
- [ ] Setting up a new venue in the admin from a public menu, timed: target under an hour

## Stage 6 - Launch kit

- [ ] Read GitHub's Pages terms closely and settle where paying venues are hosted
      (00-plan open question 3)
- [ ] A sample venue in its own repository with Pages (or Cloudflare Pages) on a test
      domain, every step written down
- [ ] Domain hook-up with the domain in someone else's account
- [ ] A look switch on the live test site, end to end
- [ ] Hours check: at launch, the site's hours and the Google Business Profile's agree; a
      monthly reminder to the owner to keep them so (wrong hours online: 44%)
- [ ] Link check (P51): every order, booking and social link answers
- [ ] Domain renewal date recorded and watched (P48) - one KC venue lost its domain to a
      spam site
- [ ] The domain lock (P37) allowing that domain, and refusing others

## Stage 7 - Business kit and fair prices

Not code. Lives in the private tracker, except where marked.

- [ ] Research what is fair: what Squarespace, Wix, Square Online, Toast's site, BentoBox and
      Popmenu charge and include; what Kansas City freelancers and agencies charge for a
      designed site; what template marketplaces charge for premium restaurant templates
- [ ] Plans: prices, switches per month, what happens on cancelling, minimum term
- [ ] Contract: scope, who owns the domain and the files, accessibility wording, ending it
- [ ] Invoicing, including a monthly charge
- [ ] Business registration and whether Kansas City needs a licence
- [ ] Outreach emails, CAN-SPAM compliant
- [ ] Private tracker

- [ ] The five-minute audit, `npm run audit <url>`, into a private `audits/` folder (P46)
- [ ] What the monthly plan includes (P48), and the accessibility promise for contracts:
      the target, the checks, a fix well inside SB 907's 90 days - not legal compliance
- [ ] Links for every source in the research, before any figure is used in public

## Stage 8 - First outreach

- [ ] A first list of Kansas City cocktail bars whose site does not match the place
- [ ] Previews for each; contacted; answers recorded; opt-outs honoured, previews deleted
- [ ] What worked, written up

## Stage 9 - Mexican looks

- [ ] A made-up Mexican restaurant sample, and looks for it through the stage 1 checks

## Stage 10 - American looks

- [ ] A made-up American restaurant sample, and looks for it through the stage 1 checks

## Tabled - reviews and perception

Not ordered against the stages above. Picked up when the author is ready.

- [ ] Choose the reviews route (03-architecture, "Tabled"); a Business Profile for Menu
      Factory if the Business Profile API is chosen; apply to Google
- [ ] Fetch reviews daily; keep the last good set when a fetch fails
- [ ] Mark each review good, mixed or bad: word-list baseline, then the author's own model,
      scored against a hand-labelled set
- [ ] Admin: the owner chooses which quotes appear; the site always shows overall rating,
      count and a link to all reviews
- [ ] Admin: how each menu item is perceived - mentions, the good/mixed/bad split, quotes

## Later

- [ ] Scheduled look switches by date, for monthly clients
- [ ] International: countries chosen, outreach rules written down first, translated look
      text, menus in more than one language, local formats

# Menu Factory - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked at phone width
(390px) in both motion levels.

Nothing is started. Stage 0 can begin once the author has answered P3 to P5 in 00-plan.md
(the language and the tools), or says to go ahead on the proposals.

## Stage 0 - Scaffold and motion spike

- [ ] Astro project in `site/` with TypeScript, as in 03-architecture
- [ ] A `resto-dir/node_modules/` rule in the root `.gitignore` - the existing rules only
      cover the repository root and codevscode. Then `git check-ignore -v` on every new
      folder, and confirm `dist/` and `node_modules/` are ignored and nothing else is
- [ ] `brand.ts` with the working name, and the test that fails if the name appears in
      `site/` or `admin/`
- [ ] The Zod content schema covering every entity in 04-data-model
- [ ] A made-up cocktail bar as YAML: late hours, happy hour, a cocktail menu with
      ingredients, a small food menu, weekly and one-off events, photos the author is free
      to use
- [ ] Hours and happy hour logic with the case table in Vitest: past midnight, split days,
      an exception, a closure with a reopening date, daylight saving, closes soon, happy
      hour only while open
- [ ] The less/more motion control: starts from the device setting, remembers the choice,
      every look reads one setting
- [ ] **Spike: one real Claude Design export** (the author makes it) taken through
      "From a design to a look" in 03-architecture: venue content in its slots, both motion
      levels, rendered at 390px and 1280px. Write what worked and what did not into
      03-architecture
- [ ] Weight budgets proposed from the spike's real numbers, agreed with the author
- [ ] Playwright set up: open a page, switch the motion control, take screenshots

Check:

    cd resto-dir\site
    npm install
    npm test
    npm run build
    npx playwright test
    npm run preview

## Stage 1 - First cocktail bar look

- [ ] The author's design built into `site/src/looks/<name>/` with `look.json`
- [ ] Home: name, logo, open-now and happy-hour lines, phone, address readable at once
- [ ] Menu: sections, jump links, ingredients, prices and pours, happy hour prices marked,
      tags as icon plus text
- [ ] Events, past one-off events dropped
- [ ] Notices with start and end dates
- [ ] schema.org `BarOrPub` block, validated
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
- [ ] Built from each look's `look.json`; the product name from `brand.ts`
- [ ] Passes the same checks as a venue site
- [ ] Where it is hosted (00-plan open question 9)

## Stage 4 - Owner admin

- [ ] **Spike: Payload on the server.** Install, measure memory beside mailman, decide P27
- [ ] Owner accounts, one venue each; the author's account sees all
- [ ] The short first screen: Menu, Hours, Happy hour, Events, Notices, Photos, Look
- [ ] Every screen usable on a phone; no developer words anywhere
- [ ] Drafts, preview in the real look, publish, undo to any earlier version
- [ ] Uploads: images only, size-limited, resized, location data stripped, "describe this
      photo" asked in plain words
- [ ] No field anywhere that changes layout, motion, fonts or art - a test checks the
      admin's editable fields against the "may change" list in 04-data-model
- [ ] Look screen: the owner's content in other looks, "ask for this look"
- [ ] Publish job: build the venue from the database, run the checks, upload, report when
      it is live; a failed check publishes nothing
- [ ] Watched by hand: someone non-technical changes a price, adds an event and undoes it
      from a phone, without help. Written down what confused them

## Stage 5 - Previews and intake

- [ ] Preview mode: bar on every page, `noindex` on every page, disallow-all `robots.txt`
- [ ] A test that fails if a preview build is missing any of the three
- [ ] Intake checklist (menus, hours, holidays, happy hour, events, photos, logo, socials,
      domain)
- [ ] Setting up a new venue in the admin from a public menu, timed: target under an hour

## Stage 6 - Launch kit

- [ ] Publish a sample to Cloudflare Pages on a test domain, every step written down
- [ ] Domain hook-up with the domain in someone else's account
- [ ] The daily build for expired notices and events
- [ ] A look switch on the live test site, end to end

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

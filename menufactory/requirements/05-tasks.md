# resto-dir - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked at phone width
(390px) in the browser's device view.

Nothing is started. Stage 0 waits on the author's answers to the proposals in 00-plan.md,
P1 to P5 in particular.

## Stage 0 - Scaffold

- [ ] `resto-dir/` layout as in 03-architecture: `resto/`, `templates/`, `samples/`,
      `schema/`, `tests/`, `requirements.txt`
- [ ] `git check-ignore -v` on every new folder; confirm `dist/` is ignored and nothing else
      is (the root `.gitignore` carries broad rules from other templates)
- [ ] The content file schema, covering every entity in 04-data-model
- [ ] One made-up restaurant in `samples/`, filled in completely, with photos the author is
      free to use
- [ ] The build command: `python -m resto build samples/<slug> --template counter` writes
      `dist/<slug>/`
- [ ] Validation errors name the field and the line
- [ ] Hours logic in Python with a table of cases: crossing midnight, split days, an
      exception, a closure with a reopening date, a daylight saving change, closes soon
- [ ] pytest runs from PowerShell

Check:

    cd resto-dir
    python -m venv .venv
    .\.venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    python -m pytest -q
    python -m resto build samples\<slug> --template counter
    npx serve dist\<slug>

## Stage 1 - First template: Counter

- [ ] Home page: name, open-now line, order and call buttons, address, above the fold at 390px
- [ ] Menu page: menus, sections, jump links, prices from `PRICE_OPTION`, dietary tags as
      icon plus text
- [ ] Open-now script in the browser, tested against the same case table as the Python
- [ ] Notices with start and end dates
- [ ] schema.org `Restaurant` block, validated
- [ ] Image pipeline: resized, location data stripped, `alt` required
- [ ] Self-hosted fonts; no third-party request on page load
- [ ] Checks pass: axe-core with no AA violations, Lighthouse performance 90 or more on mobile,
      no broken links, no sideways scroll at 390px
- [ ] Works with JavaScript turned off, apart from the open-now line

## Stage 2 - Table and Morning

- [ ] Table template, every page
- [ ] Morning template, every page
- [ ] Two more made-up restaurants that suit them
- [ ] A test that renders every sample in every template
- [ ] Any field added to the schema has a fallback when empty, and stage 1 still passes

## Stage 3 - Showcase

- [ ] One page listing the templates, each with a live sample
- [ ] A switch to see the same restaurant in each template
- [ ] Passes the same checks as a client site
- [ ] Decide where it is hosted (00-plan, open question 9)

## Stage 4 - Previews and intake

- [ ] Preview mode: bar on every page, `noindex` on every page, disallow-all `robots.txt`
- [ ] A test that fails if a preview build is missing any of the three
- [ ] Intake checklist for a new client (menus, hours, holidays, photos, logo, links, domain)
- [ ] `python -m resto check <folder>` reports what is still missing, without building
- [ ] Private client repository set up, using this tool
- [ ] Timed: from a public menu to a preview link, target under an hour

## Stage 5 - Launch kit

- [ ] Publish a sample to Cloudflare Pages on a test domain, end to end, and write down every
      step
- [ ] Domain hook-up with the domain in someone else's account, the way a client's will be
- [ ] Post-launch checklist: HTTPS, structured data, analytics, Google Business Profile hours
      and website link match the site
- [ ] Hand-over: the client can download every file of their site

## Stage 6 - Business kit

Not code. Lives in the private tracker, not this repository, except where marked.

- [ ] Find out what Squarespace, Wix, Square Online, Toast's site, BentoBox and Popmenu
      currently charge a restaurant and include
- [ ] Find out what Kansas City freelancers charge for a restaurant site
- [ ] Price list: build fee, care plan, what each includes
- [ ] Contract: scope, changes included, who owns the domain and the files, accessibility
      wording (P13), how either side ends it
- [ ] Invoice method
- [ ] Business registration and whether Kansas City needs a licence for it
- [ ] Outreach emails: first contact and one follow-up, CAN-SPAM compliant (honest sender
      and subject, physical address, a working opt-out)
- [ ] Private tracker: prospect, where found, current site's problems, preview link, date
      contacted, answer, follow-up date

## Stage 7 - First outreach

- [ ] A first list of Kansas City restaurants whose current site has a visible problem
- [ ] Previews for each
- [ ] Contacted; answers recorded; opt-outs honoured and previews deleted
- [ ] What worked, written up: email or walk-in, preview or showcase, which template

## Stage 8 - Owner edits (later)

- [ ] Only if clients ask. Options to weigh then: a form that writes to the client
      repository, a shared spreadsheet the build reads, a git-backed content editor

## Stage 9 - International (later)

- [ ] Countries chosen; their cold-contact rules written down before any email
- [ ] Translated interface strings for the templates; menus in more than one language
- [ ] Address, phone and price formats per country

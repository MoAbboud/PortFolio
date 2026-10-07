# roamer - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked at phone width
in the browser's device view.

## Stage 0 - Scaffold

The current work. Nothing blocks it.

- [ ] `roamer/` project layout: `app/`, `migrations/`, `tests/`, `Dockerfile`,
      `docker-compose.yml`, `pyproject.toml`, `.env.example`
- [ ] Compose services: `db` (Postgres 16), `mailpit`, `web`, `worker`
- [ ] Alembic set up, first migration creates `cube`, `earthdistance`, `citext`
- [ ] Find out whether the app login can create those extensions or whether they go in
      `deploy/initdb/` as the superuser. Write the answer into 03-architecture
- [ ] `/health` reports the database reachable
- [ ] pytest runs against the compose database; a `REQUIRE_DB=1` switch makes "no database"
      a failure in CI rather than a skip, as mailman and herder do
- [ ] `.github/workflows/test-roamer.yml`, and the badge in the root README

Check:

    docker compose up -d --build
    Invoke-RestMethod http://localhost:8000/health
    Start-Process http://localhost:8025    # Mailpit
    docker compose exec web pytest

## Stage 1 - Listings on a map

- [ ] Migration: `owners`, `listings`, `listing_events`
- [ ] Short listing codes: unambiguous characters only, unique, collision retried
- [ ] Listing form, server-rendered, with a Leaflet map to drop the pin
- [ ] `POST /listings` and the JSON equivalent, validated with Pydantic
- [ ] `GET /api/listings?bbox=` returns only what a pin needs
- [ ] The map page: pins, popups, species filter, how-recently filter, clustering
- [ ] The listing page at `/l/{code}`
- [ ] Map attribution for OpenStreetMap
- [ ] Seed script: a dozen listings, every one obviously fictional and labelled as a demo
- [ ] Tests: create, read, bbox filter, code uniqueness

Check:

    docker compose exec web python -m app.seed
    Invoke-RestMethod "http://localhost:8000/api/listings?bbox=-180,-90,180,90"
    Start-Process http://localhost:8000

## Stage 2 - Email verification

- [ ] Migration: `email_tokens`, `outbox`
- [ ] Token create, hash, look up, expire, single use
- [ ] New listings start `pending_verification` and are not returned by the map or search
- [ ] Verify page: GET shows a button, POST publishes
- [ ] Outbox written in the same transaction as the listing
- [ ] Worker sends from the outbox, retries with a limit, records errors
- [ ] Verified badge computed on read, and the line under it saying what it does not mean
- [ ] Unverified listings deleted after 7 days
- [ ] Tests: a GET on a verify link changes nothing; a used token is refused; an expired
      token offers a new one; the outbox row exists even when sending fails

Check:

    # post a listing in the browser, then
    Start-Process http://localhost:8025    # the email is there; click the link

## Stage 3 - Photos

- [ ] Migration: `photos`
- [ ] Upload on the form, several photos plus one flyer image
- [ ] Type and size limits
- [ ] Orientation applied, metadata removed, display size and thumbnail written
- [ ] Image store interface with a volume implementation and a test implementation
- [ ] Tests: a fixture JPEG with GPS EXIF comes out with no EXIF at all; a renamed text file
      is rejected

## Stage 4 - I found an animal

- [ ] GiST index on `ll_to_earth`, partial on active listings
- [ ] The distance query in one function: `earth_box` prefilter, exact `earth_distance`,
      nearest first, then most recent
- [ ] `GET /api/listings/near`
- [ ] Geocode proxy: Nominatim with the identifying user agent, a cache table or a cache in
      memory, one request a second at most, search on submit only
- [ ] The `/found` page: use my location, or type an address; results as cards and on a map
- [ ] Tests: the index is used (`EXPLAIN`); distances are right to within a few metres for
      known points; inactive listings never appear

Check:

    Invoke-RestMethod "http://localhost:8000/api/listings/near?lat=51.5&lng=-0.12&radius_km=5"

## Stage 5 - Check-ins and freshness

- [ ] Worker loop: find active listings past `CHECKIN_INTERVAL` with no check-in
      outstanding, write a token and an outbox row each
- [ ] Check-in page: GET shows the three choices, POST records the answer
- [ ] Badge lapse and stale computed from `last_confirmed_at` and configuration
- [ ] The map's default view leaves out stale listings; a filter puts them back
- [ ] The listing page says "confirmed still lost N days ago" or "not confirmed for N days"
- [ ] Tests that move the clock: verified, then lapsed, then stale, then answered and
      verified again

## Stage 6 - Manage, edit, close

- [ ] `GET /manage` and `POST /manage`: an email address in, a manage link out. The same
      response whether or not the address is known
- [ ] Manage link exchanged for a short signed session cookie
- [ ] Edit page; every save is an event row with the changed field names
- [ ] Still lost, home, withdraw; reopen after home
- [ ] Withdraw deletes the listing, its photos and its events
- [ ] Reunited listings deleted after the retention period
- [ ] CSRF protection on every form that changes something
- [ ] Tests: another owner's session cannot edit; withdraw leaves no files on the volume

## Stage 7 - Printable flyer

- [ ] `/l/{code}/flyer` with a print stylesheet: photo, name, last seen, number, approach
      advice, QR code
- [ ] QR code generated on the server by a library, no outside service
- [ ] Check: print to PDF from the browser, scan the code with a phone, it opens the listing

## Stage 8 - The admin section, abuse and moderation

The admin has full control of the map. J7 in 02-interaction is the screen-by-screen target.

Abuse:

- [ ] Migration: `reports`, `blocked_emails`, `settings`, `admin_actions`
- [ ] Report form on every listing
- [ ] Rate limits on posting, manage links and reports, per hashed IP and per email
- [ ] Honeypot field on the listing form
- [ ] Scam warning on every listing page

Admin login:

- [ ] `/admin/login` against `ROAMER_ADMIN_PASSWORD_HASH`; a script that prints a hash for a
      password typed at the prompt
- [ ] Signed session cookie, HttpOnly, SameSite=Strict, a few hours long; logout
- [ ] Failed logins slowed per IP and logged
- [ ] CSRF token on every admin form; `/admin` kept out of search engines

Admin screens:

- [ ] Dashboard: counts by state, each linking to its list; latest activity
- [ ] Admin map: every listing in every state, coloured by state, filters, an action panel
      per pin
- [ ] Listings table: search by name, code, area, email; filter by state, species, source;
      sort by date
- [ ] Approval: `awaiting_approval` status; queue page; approve; reject with a reason
      emailed to the owner
- [ ] Reports page: hide with a reason, or dismiss
- [ ] Per listing: edit any field, move the pin, remove a photo, hide, unhide, mark home,
      delete with a reason
- [ ] Owners: look up an address, block (hides its listings, refuses posts quietly),
      unblock (unhides only what the block hid)
- [ ] Settings: approval on or off; "use this view" for where the public map opens;
      configuration shown read-only
- [ ] Activity log page
- [ ] Every admin action writes `admin_actions`, and a `listing_events` row when it touches a
      listing

Tests:

- [ ] Every `/admin` route refuses without a session, except the login page
- [ ] Hide then unhide returns the listing exactly as it was
- [ ] An admin edit does not move `last_confirmed_at`
- [ ] Approval on: a verified listing waits; approval off: it goes live
- [ ] A blocked address gets the same response as anyone else and posts nothing
- [ ] A rejected or deleted listing leaves its `admin_actions` row behind

Check:

    docker compose exec web python -m app.admin_hash      # prints a hash; put it in .env
    Start-Process http://localhost:8000/admin

## Stage 9 - Demo mode, host it, write the README

It starts as a demo: made-up listings, every flow working, nothing
reaching a real person.

- [ ] `ROAMER_DEMO=1` switch, read in one place
- [ ] Banner on every page: a demo, made-up listings, do not enter real details
- [ ] "Reset demo now" and the all-addresses demo inbox on the admin pages
- [ ] Demo inbox page: lists outbox messages for an address the visitor typed, with the links
      clickable. The mailer sends nothing in demo mode
- [ ] Demo check-in clock in minutes, and a "send check-in now" button on the manage page
- [ ] Seed listings marked as seeded; a scheduled reset restores them and deletes everything
      visitors posted, with their photos
- [ ] Check: post, verify through the demo inbox, send a check-in, mark home, search, print
      a flyer - all from a fresh browser with no real email address
- [ ] `roamer` profile in `deploy/docker-compose.prod.yml` with memory limits
- [ ] Database and login in `deploy/initdb/01-databases.sh`; extensions if needed
- [ ] Caddy block for `roamer.<domain>`; DNS record at Cloudflare, grey cloud like the others
- [ ] `roamer/README.md`: what it is, a screenshot, how to run it, what verified means, what
      it does not do
- [ ] Root README: roamer in "Everything here"

## Later - Stage 10, post import

Not started before stage 9 is done.

- [ ] Re-check the sites' current terms and any API that exists by then
- [ ] Paste-a-post form: text, link, optional photo
- [ ] `imported_posts` table
- [ ] Heuristic extractor: phone numbers, species words, colour words, place names, dates
- [ ] A labelled set of pasted posts and a harness reporting field accuracy, mailman style
- [ ] A locally trained or locally run model as a second extractor, compared by the harness
- [ ] Unclaimed listings on the map, labelled as from a post and not verified
- [ ] Claim flow, once the open question on proof is decided

## Later - Stage 11, sightings and found reports

- [ ] Sightings on a listing, shown after the owner accepts them
- [ ] Found-animal listings, and the finder's search showing both kinds

## Done and verified

- [x] Brief taken down; requirements written: plan, overview, interaction, architecture,
      data model, tasks, and the private context log
- [x] `06-context.md` confirmed covered by the repo-wide ignore rule before the first commit
- [x] Decided: it starts as a demo with made-up listings and a functioning preview - every
      flow works for a visitor
- [x] Decided: the stack (FastAPI, Jinja, PostgreSQL with `earthdistance`, Leaflet and
      OpenStreetMap, Docker Compose)
- [x] Decided: an admin section with full control of the map; user journeys written

## Blocked

| Task | Waiting on |
| --- | --- |
| Going live for real, after the demo | Which mail relay; sender records; a privacy notice |
| Stage 10 claim flow | How an owner proves an imported post is theirs |

## Explicitly not doing

- Scraping any social media site.
- Any hosted language model or language model API key, for import or anything else.
- Accounts and passwords.
- A reward or payment field.
- Automatic photo matching between animals.
- A native mobile app.

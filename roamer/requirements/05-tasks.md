# roamer - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked at phone width
in the browser's device view.

## Stage 0 - Scaffold

The current work, once the open questions marked "now" in the context log are answered.

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

## Stage 8 - Abuse and moderation

- [ ] Migration: `reports`
- [ ] Report form on every listing
- [ ] Rate limits on posting, manage links and reports, per hashed IP and per email
- [ ] Honeypot field on the listing form
- [ ] `/admin` behind `ROAMER_ADMIN_TOKEN`: open reports, hide with a reason, unhide,
      dismiss
- [ ] Hiding never changes `status`; unhiding returns the listing exactly as it was
- [ ] Scam warning on every listing page

## Stage 9 - Host it, write the README

- [ ] Decide the open question: real service or demo
- [ ] Decide the mail relay
- [ ] `roamer` profile in `deploy/docker-compose.prod.yml` with memory limits
- [ ] Database and login in `deploy/initdb/01-databases.sh`; extensions if needed
- [ ] Caddy block for `roamer.<domain>`; DNS record at Cloudflare, grey cloud like the others
- [ ] Sender records for the mail domain; a test message to several providers lands in the
      inbox
- [ ] Image volume backed up with the database
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

## Blocked

| Task | Waiting on |
| --- | --- |
| Stage 9 hosting | Real service or demo; which mail relay |
| Stage 10 claim flow | How an owner proves an imported post is theirs |

## Explicitly not doing

- Scraping any social media site.
- Any hosted language model or language model API key, for import or anything else.
- Accounts and passwords.
- A reward or payment field.
- Automatic photo matching between animals.
- A native mobile app.

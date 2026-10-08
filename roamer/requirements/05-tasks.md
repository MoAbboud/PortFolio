# roamer - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked at phone width
in the browser's device view.

## Stage 0 - Scaffold

Done. 7 tests: health green, 503 on an unreachable database without leaking the
connection string, 503 naming a missing extension, and the three extensions doing what
the distance query will need. Checked in the container and from Windows, with the
database up, down, and down with `REQUIRE_DB=1`.

- [x] `roamer/` project layout: the `roamer` package, `migrations/`, `tests/`, `Dockerfile`,
      `docker-compose.yml`, `requirements.txt`, `.env.example` - `requirements.txt` rather
      than `pyproject.toml`, the same as mailman, since nothing here is installed as a package
- [x] Compose services: `db` (Postgres 16 on host port 5434) and `web` (host port 8010).
      Mailpit and the worker moved to stage 2, the first stage with mail to catch and a job to
      run. Ports chosen so roamer runs beside mailman and herder, which both take 5432 and 8000
- [x] Alembic set up, first migration creates `citext`, `cube`, `earthdistance`
- [x] Find out whether the app login can create those extensions. Answer: `citext` and
      `cube` yes, `earthdistance` no - it needs the superuser, so `deploy/initdb/` creates
      it. Written into 03-architecture, Deployment
- [x] A database that is not there fails in 5 seconds instead of hanging: psycopg on
      Windows never returns from a refused connection without `connect_timeout`
- [x] `/health` reports the database reachable and the three extensions installed; 503 names
      what is missing, and never echoes a connection string
- [x] pytest runs against the compose database; `REQUIRE_DB=1` makes "no database" a failure
      in CI rather than a skip, as mailman and herder do
- [x] `.github/workflows/test-roamer.yml`, and the badge in the root README

Check:

    cd roamer
    docker compose up -d --build
    Invoke-RestMethod http://localhost:8010/health
    docker compose exec web python -m pytest -q -rs

## Stage 1 - Listings on a map

Done. 58 tests. The form was also driven end to end in headless Chrome - click the map,
fill in, submit, land on the new listing - and every page was looked at at 1280px and at
390px.

- [x] Migration `0002_listings`: `owners`, `listings`, `listing_events`, hand-written, with
      the vocabularies as CHECK constraints frozen in the migration and a test that fails
      if the models drift from them
- [x] Short listing codes: six characters with no 0, o, 1, l or i; unique; a collision
      draws again, five tries, then a loud error
- [x] Listing form, server-rendered, with a Leaflet map to drop and drag the pin, "use my
      location", and the browser's local time sent as UTC
- [x] `POST /listings` and `POST /api/listings`, validated by the same Pydantic model; a bad
      form comes back with the problem beside the field and what was typed still in it
- [x] `GET /api/listings?bbox=` returns only what a pin needs - no email, no phone. Handles
      a view across the 180th meridian
- [x] The map page: pins coloured by species, popups, clustering, species filter, "missing
      since" filter, a count of what is in view
- [x] The listing page at `/l/{code}`: pin or circle, phone as a tap-to-call link unless
      hidden, "home" banner and no number once reunited, 404 for hidden or unknown codes
- [x] An approximate location is snapped to a 0.005 degree grid on the way in, so the exact
      point is never stored, and drawn as a 500 m circle
- [x] Map attribution for OpenStreetMap
- [x] Muted base map, at the author's request: OpenFreeMap's Positron through MapLibre GL,
      greyed OpenStreetMap tiles as the fallback, cluster bubbles in the site's ink
- [x] Leaflet and markercluster from cdnjs with integrity hashes computed from the served
      files
- [x] Seed script: twelve made-up animals at real Kansas City places, 555-01xx numbers,
      example.com addresses, "This is a demo listing" in every description; re-running
      replaces them and never touches a person's listing
- [x] Tests: create, owner reuse across letter case, approximate snapping, code collision
      and exhaustion, bbox and filters, hidden and reunited off the map, escaping, no email
      or phone in the JSON, form errors, API parity with the form, seeding

Check:

    docker compose up -d --build        # the new dependencies and migration 0002
    docker compose exec web python -m roamer.seed
    Invoke-RestMethod "http://localhost:8010/api/listings?bbox=-94.7,38.9,-94.4,39.2"
    Start-Process http://localhost:8010

## Stage 2 - Email verification

Done. 74 tests. Also run for real, end to end: the form in Chrome, the worker sending to
Mailpit, the link read out of Mailpit, opened, the button pressed, the badge on the page.

- [x] Compose: `mailpit` (web inbox on 8025, SMTP inside the network only) and the `worker`
- [x] Migration `0003_email`: `email_tokens` (hash only, CHECK that it is 32 bytes) and
      `outbox` (with `next_attempt_at` and a partial index on what is due)
- [x] Tokens: 32 random bytes, SHA-256 stored, purpose, expiry, single use; a new link
      retires the old ones
- [x] New listings start `pending_verification`: not on the map, not in the API, their page
      404s
- [x] "Check your email" page with the address masked (`s***@example.com`), and a pointer to
      Mailpit only when `MAIL_VIEWER_URL` is set
- [x] Verify page: GET shows a button and changes nothing, POST publishes; used links say
      "Already published"; expired ones offer a new link; unknown ones 404
- [x] Outbox written in the same transaction as the listing; rendered at send time
- [x] Worker sends from the outbox with row locks (SKIP LOCKED), commits per message,
      backs off 30 s / 1 / 2 / 4 min, marks `failed` after 5 tries, removes the token from
      the row once sent
- [x] Verified badge computed on read, on the listing page and in map popups, with "What
      verified means" under it
- [x] Unverified listings deleted after 7 days, with addresses that never confirmed
- [x] Seeds are published without an email (`pre_verified`) - example.com cannot answer
- [x] Tests: a GET on a verify link changes nothing; a used link cannot publish twice; an
      expired link offers a new one and the new one works; the listing survives a send
      failure; retries and the failed state; the token leaves the row once sent; the badge
      lapses; pending listings are public nowhere

Check:

    docker compose up -d --build        # adds mailpit and the worker, runs migration 0003
    Start-Process http://localhost:8010/listings/new    # post one
    Start-Process http://localhost:8025                 # the email is there; open the link

## Stage 3 - Photos

Done. 91 tests. Also run for real: a JPEG carrying a GPS position, a camera model and a
"turn sideways" flag, uploaded through the form in Chrome; the saved file was upright and had
no EXIF, no GPS and no camera model in its bytes.

- [x] Migration `0004_photos`: one row per image, kind CHECK, unique (listing, kind,
      position), at most one flyer per listing by a partial unique index, unique storage key
- [x] Upload on the form: up to 6 photos plus one flyer image, `multipart/form-data`; the
      first photo is the one on the map
- [x] Type and size limits: JPEG, PNG or WebP by what the bytes are, not what the file says;
      10 MB per file, read only to one byte past it; 40 megapixels; at most 8 file parts
      parsed per request
- [x] Orientation applied from EXIF, then the image rebuilt from raw pixels so no metadata
      survives; transparency flattened onto white; JPEG display (1600 px) and thumbnail
      (400 px); the original never written anywhere
- [x] Image store interface: `LocalImageStore` (files under `IMAGE_DIR`, refuses keys that
      escape its root) and `MemoryImageStore` (tests, autouse so no test touches disk)
- [x] Served at `/media/...`; the listing page shows the main photo, a strip of the others,
      and the flyer; map popups show the thumbnail
- [x] Files written before the commit and deleted again if it fails; every path that removes
      listings (`delete_unverified`, the seed reset, later withdraw and the demo reset) goes
      through `delete_listings`, which removes the files too
- [x] A failed form says which file was the problem and that files must be chosen again
- [x] Tests: a JPEG with GPS EXIF comes out with no metadata at all (and the fixture is
      checked to really carry GPS first); orientation applied; a renamed text file, a GIF,
      an oversized file and too many pixels refused; too many photos refused; an empty file
      input is no photo; a failed save leaves no files; deleting listings deletes files

Check:

    docker compose up -d --build        # Pillow, and migration 0004
    Start-Process http://localhost:8010/listings/new    # add a photo from your phone

## Stage 4 - I found an animal, and search circles

Done. 122 tests. Also run for real: one live address lookup through Nominatim, the finder's
page driven in Chrome with a faked GPS position and with a typed address, and the circles
screenshotted on a dog's and an indoor cat's listing, at desktop and phone width.

Search circles - a must:

- [x] The papers read for the figures. Cats: Huang et al. 2018 (median and 75th percentile
      per outdoor-access group). Dogs: **not** Lord et al. 2007 as planned - its abstract has
      no distances - but Kremer 2021, 10,000 Dallas strays returned to owners. Figures and
      sources in 03-architecture, "Search circles"
- [x] `outdoor_access` on the form and the listing (migration `0005_search`), shown on the
      listing as "Outdoors"; the made-up cats have answers
- [x] Two rings on every listing's map, sized by species and outdoor access, with a note
      saying what the rings are, the study and its sample, that it is not a prediction, and
      that the rings are drawn around the last-seen point
- [x] No circle for species the studies do not cover, and none once the animal is home
- [x] Tests: the published figures per species and access; dogs the same whatever the
      access; no circle for `other`; the page names the study

The finder's search:

- [x] GiST index `listings_active_earth` on `ll_to_earth`, partial on active listings
- [x] `listings.nearest()`: `earth_box` prefilter, exact `earth_distance`, nearest first then
      most recent, 50 km and 50 results at most
- [x] `GET /api/listings/near` with `distance_m`; nonsense coordinates and radii refused
- [x] `GET /api/geocode`: Nominatim with an identifying user agent, an in-memory LRU cache
      (failures not cached), one request a second across the process, results biased to the
      map's area, three characters minimum
- [x] The `/found` page: use my location, or type an address and pick from the matches;
      results as cards and on a map; species and distance filters; what to do when nothing
      matches; what to ask for before handing an animal over
- [x] "I found an animal" in the header on every page, shortened to "Found one" on phones
- [x] Tests: the index can be used (`EXPLAIN` with sequential scans off); distances within a
      metre of an independent calculation; the radius is a circle, not the box; inactive and
      pending listings never appear; the cache and the rate limiter

Check:

    Invoke-RestMethod "http://localhost:8010/api/listings/near?lat=39.0329&lng=-94.5936&radius_km=2"
    Invoke-RestMethod "http://localhost:8010/api/geocode?q=Loose%20Park"
    Start-Process http://localhost:8010/found

## Stage 5 - Check-ins and freshness

The current work.

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
- [ ] Marking home asks, optionally, where the animal was found (a pin), when, and how;
      stored in `found_lat`, `found_lng`, `found_at`, `found_how` (migration). The form
      says the answer helps learn where lost pets go, and that it is never shown
- [ ] Tests: the found point never appears on a public page or in the map JSON
- [ ] Reunited listings deleted after the retention period
- [ ] CSRF protection on every form that changes something
- [ ] Tests: another owner's session cannot edit; withdraw leaves no files on the volume

## Stage 7 - Printable flyer

- [ ] `/l/{code}/flyer` with a print stylesheet: photo, name, last seen, number, approach
      advice, QR code
- [ ] QR code generated on the server by a library, no outside service
- [ ] The search circle on the flyer's map: "most dogs are found inside this circle"
- [ ] Check: print to PDF from the browser, scan the code with a phone, it opens the listing

## Stage 8 - The admin section, abuse and moderation

The admin has full control of the map. J7 in 02-interaction is the screen-by-screen target.

Abuse:

- [ ] Migration: `messages`, `blocked_emails`, `settings`, `admin_actions`
- [ ] Report form on every listing
- [ ] Help page, linked from every footer: that an admin exists, what they do, common
      answers, and the contact form. No link into the admin section
- [ ] Rate limits on posting, manage links and messages, per hashed IP and per email
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
- [ ] Messages page: reports (hide with a reason, or dismiss) and help messages (mark
      handled, delete)
- [ ] Per listing: edit any field, move the pin, remove a photo, hide, unhide, mark home,
      delete with a reason
- [ ] Owners: look up an address, block (hides its listings, refuses posts quietly),
      unblock (unhides only what the block hid)
- [ ] Settings: approval on or off; "use this view" for where the public map opens;
      configuration shown read-only
- [ ] Activity log page
- [ ] Dataset export: reunion pairs as CSV - lost point, found point, times, species,
      size, age, outdoor access, how found - with no names, phones, emails or codes, and
      never seeded or demo-mode listings
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
    Start-Process http://localhost:8010/admin

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
- [ ] Database and login in `deploy/initdb/01-databases.sh`, plus `earthdistance` created
      there as the superuser (stage 0 found the app login cannot). On the live server,
      where initdb has already run, the same by hand per DEPLOYMENT-GUIDE.md
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

## Later - Stage 12, a model of where lost pets go

Only once real reunions exist. Until then the harness can be built against a synthetic
set, labelled as synthetic.

- [ ] Harness: on held-out reunions, how often is the found point inside the predicted
      area, and how large is the area - the search circles are the baseline
- [ ] A model: distance decay shaped by streets, parks and cover from OpenStreetMap,
      trained locally, no hosted model
- [ ] Shown to users only if it beats the circles, and labelled with how well it does

## Done and verified

- [x] Brief taken down; requirements written: plan, overview, interaction, architecture,
      data model, tasks, and the private context log
- [x] `06-context.md` confirmed covered by the repo-wide ignore rule before the first commit
- [x] Decided: it starts as a demo with made-up listings and a functioning preview - every
      flow works for a visitor
- [x] Decided: the stack (FastAPI, Jinja, PostgreSQL with `earthdistance`, Leaflet and
      OpenStreetMap, Docker Compose)
- [x] Decided: an admin section with full control of the map; user journeys written
- [x] Decided: no admin for visitors; a Help page tells them an admin exists and how to
      reach one
- [x] Decided: search circles are a must; roamer collects the data for a future model
- [x] Stage 0, the scaffold
- [x] Stage 1, listings on a map
- [x] Stage 2, email verification
- [x] Stage 3, photos
- [x] Stage 4, search circles and the finder's search

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

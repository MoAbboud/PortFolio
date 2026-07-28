# whereyago - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 4 - Sharing

The current gap. Nothing in stage 5 or 6 matters until a day can reach another account.

- [ ] Add a schema for updating an adventure, with every field optional
- [ ] Add an update endpoint on the adventure router
- [ ] Enforce ownership for the update in the service layer, not the router
- [ ] Return the same read shape from update as from create
- [ ] Add a share control to the day detail screen, visible only to the owner
- [ ] Call the update endpoint from the mobile API module
- [ ] Reflect the shared state in the profile list so it is clear what is public
- [ ] Test: a shared day appears in a second account's Discover feed
- [ ] Test: an unshared day does not
- [ ] Test: account B cannot update account A's adventure

## Stage 5 - Presentation

- [x] Map view with a pin per adventure, placed from the first stop's coordinates
- [x] Fall back to geocoding the city when no stop has coordinates
- [x] Day detail screen listing stops in order
- [x] Directions handoff per stop
- [x] Map, list and video switcher on Home
- [ ] Replace the placeholder theme with the real brand tokens
- [x] Empty states for a profile with no days and a Home feed with no results
- [ ] Loading and error states on every screen that makes a network call
- [ ] Show the weather on the day detail screen, and render correctly when there is none
- [ ] Decide the fate of the Videos tab: build it or remove it

## Stage 6 - Social

Every table needed here already exists. This is endpoints and screens only.

- [ ] Like and unlike endpoints, with the unique constraint doing the work
- [ ] Increment and decrement the cached like counter in the same transaction
- [ ] Comment create and list endpoints
- [ ] Rating create and replace endpoint, one per user per adventure
- [ ] Read the counters into the Discover feed shape
- [ ] Like, comment and rating controls on the day detail screen
- [ ] Define what the Friends tab does before building anything in it
- [ ] Replace newest-first Discover ordering with something defensible

## Stage 7 - Deploy

- [ ] Choose a host for the API and a managed database, and confirm the running cost
- [ ] Confirm every secret is supplied by environment variable in that environment
- [ ] Run migrations against the deployed database
- [ ] Point the mobile app at the deployed API through configuration
- [ ] Add retention or a size cap on the log table
- [ ] Confirm the API docs stay disabled in the deployed environment

## Done and verified

- [x] Browser prototype with map, weather and directions - opened and used directly from
      the file, no server
- [x] Backend layered as api, services, repositories, models and schemas - tests, linting
      and strict type checking all pass
- [x] Argon2 password hashing and bearer-token authentication - covered by tests
- [x] Correlation-id middleware and structured logging - verified by reading a request's
      lines back out of the log table
- [x] Warnings, errors and unhandled exceptions persisted to the database in their own
      transaction - verified by triggering a failure and finding the row after rollback
- [x] Migrations 0001 to 0003, including the rename to Adventure and the split of weather
      into its own table
- [x] Mobile shell with login, register, tab navigation, log form and profile - type check
      clean, toolchain check clean
- [x] Single network wrapper for all API calls, with the token read from secure storage
- [x] Theme tokens established as the one place styling is defined

## Blocked

| Task | Waiting on |
| --- | --- |
| Anything in stage 7 | A decision on where the API and database are hosted, and whether that stays free |
| Friends tab work | A definition of what the tab is for |

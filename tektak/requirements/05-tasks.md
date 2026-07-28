# tektak - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 3 - Survive a real week

- [ ] Curate daily for a week and record how long it actually takes
- [ ] Note every point where the forms slow the work down
- [ ] Decide whether the ten to fifteen minute budget holds

## The decision

- [ ] Decide: personal tool, or a site other people read

Everything in stage 4 waits on this. Half of 4a is wasted effort if the answer is 4b.

## Stage 4a - Harden the personal version

Only if the answer is "personal".

- [ ] Export everything to a file, in one click
- [ ] Import it back, in one click
- [ ] Warn before clearing everything, and offer an export first
- [ ] Add a published timestamp to stories, and show how old each one is
- [ ] Sort by that timestamp rather than relying on insertion order
- [ ] Pull the storage keys and the entry shapes into one shared file both pages use
- [ ] Mark sample entries visibly, so they cannot be mistaken for curated content
- [ ] Decide whether the sample fallback should be all-or-nothing rather than per section
- [ ] Basic validation on the forms, so an empty title cannot be published
- [ ] Edit an existing entry rather than deleting and retyping it

## Stage 4b - Make it publishable

Only if the answer is "other people read it".

- [ ] A backend and a database, replacing browser storage entirely
- [ ] Real authentication on curation
- [ ] Migrate whatever is currently in the browser before it is lost
- [ ] Decide where it is hosted and what that costs
- [ ] Revisit every decision in the plan that exists only because there was no server

## Done and verified

- [x] Reader page rendering stories, trending hashtags and featured accounts
- [x] Fixed category list applied consistently across stories and hashtags
- [x] Sample content embedded, so the site looks published on a first visit with nothing
      curated
- [x] Per-section fallback: a section with no curated entries shows samples
- [x] Curation page with forms for stories, hashtags and accounts
- [x] Hashtags typed as a comma-separated line and split on entry
- [x] Counts of what is currently published
- [x] Review lists with delete on individual entries
- [x] Clear everything
- [x] New entries added to the front
- [x] Both pages work opened directly from a file, with no server and no build step
- [x] Curation page kept off the reader page's navigation

## Blocked

| Task | Waiting on |
| --- | --- |
| All of stage 4 | The personal-or-public decision |

## Explicitly not doing

- Video, embeds, thumbnails or links to clips.
- Automated collection of any kind. Every word is typed by a person.
- Comments, reactions, or anything a reader can submit.
- Infinite scroll, recommendations, or notifications.
- Anything that tracks the reader.

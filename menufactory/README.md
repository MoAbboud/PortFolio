# Menu Factory (working name)

A library of restaurant and bar website looks - motion, digital art, atmosphere - that run as
plain files on GitHub Pages. A venue's menu, hours, happy hour and events live in one
`venue.json`; any look can show any venue, so switching a venue's look is one value.

The specification is in [requirements/](requirements/README.md). Start with
[00-plan.md](requirements/00-plan.md).

## Run it

From PowerShell, in this folder:

    npm install          # development tools only; nothing installed is published
    npm test             # hours logic, venue files, the brand-name rule, every look
    npm run check        # every venue in every look, in your installed Chrome
    npm run serve        # then open the address it prints

`npm run check` keeps screenshots in `tests/output/`.

## Layout

| Folder | What it holds | In git |
| --- | --- | --- |
| `brand.js` | The product's name and everything else that names it | Yes |
| `shared/` | What every look uses: the renderer, the hours logic, the motion button | Yes |
| `shared/lib/` | GSAP and Three.js at pinned versions (`npm run pin-libs`) | Yes |
| `looks/` | The published looks - obfuscated, what visitors load | Yes |
| `venues/` | Made-up sample venues, each an `index.html` and a `venue.json` | Yes |
| `schema/` | The rules every `venue.json` must follow | Yes |
| `tests/`, `tools/` | Checks and development scripts; never published | Yes |
| `looks-src/` | The readable source of every look, its own private repository | No |
| `designs/` | The raw Claude Design exports, by category | No |

## Adding or changing a look

1. A new design from Claude Design: save the HTML export in `designs/<category>/` and run
   `npm run unpack-design -- "designs/<category>/<file>.html"` to read it.
2. Work in `looks-src/<look>/`: `look.json`, `look.js` (exports `render(root, venue, ctx)`),
   `look.css`, and any art.
3. `npm run publish-looks` writes the obfuscated copy into `looks/<look>/`.
4. `npm test` and `npm run check`.
5. Commit `looks/` here, and `looks-src/` in its private repository.

`looks/lamplight/` is the first real look, from the author's Claude Design design.
`looks/starter/` is a scaffold that proves the pipeline. It is not a design and is never
shown in the library.

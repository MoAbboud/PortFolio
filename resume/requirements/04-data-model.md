# Interactive Resume - Data model

There is no database and nothing is sent anywhere. The "data" is the content in the markup,
the attributes the script reads from it, two preferences in the reader's browser, and the
files beside the page.

## Pages

Each `<section class="page">` is one stage page. The `id` is its address; `data-section`
groups pages into the six sections that the rail, the menu and the hue come from.

| id | data-section | Content |
| --- | --- | --- |
| `index` | Index | Name, title, availability, summary, four stats, quick links |
| `experience` | Experience | Independent Projects, Jan 2026 to now |
| `experience-tekkii` | Experience | Tekkii, Full Stack Web Developer, Jan 2023 to Jan 2026 |
| `experience-allied` | Experience | Allied Engineering Group, Software Engineer, Jun 2019 to Jun 2021 |
| `capabilities` | Capabilities | Five skill groups and the evidence panel |
| `projects` | Projects | The gallery of ten |
| `education` | Education | MS Computer Science, UMKC, and the course project |
| `contact` | Contact | Email, LinkedIn, GitHub, PDF, location |

## Attributes the script reads

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-section` | `.page` | Section name; consecutive pages with the same name form one section |
| `data-anim` | Any element in a page | Enters with the stage motion. `data-anim="fast"` staggers within its parent. The script numbers the order |
| `data-count` | Index stat numbers only | The final value the counter counts up to. Reserved: the counters rewrite the element's text |
| `data-used` | `.skill` | Space-separated ids from `.sources`: the places that show the skill. Absent means no public example |
| `data-src`, `data-kind`, `data-name`, `data-line`, `data-href` | `.sources li` | One place a skill can point to: its kind (Role, Project, Education), name, a line repeating what the page says, and its link |
| `data-clip` | `video` | A clip managed by the play-only-when-seen rules |
| `data-print="no"` | `.gal-slide` | Left out of print and the PDF |

Set by the script, not authored: `data-places` (a skill's count), `data-name` (a gallery
card's name tag), `data-group` (the evidence panel's hue), `data-theme` and `data-accent` on
`<html>`.

## Evidence rule for Capabilities

A skill's `data-used` may name a place only if that place's own words on this page, or its
repository, show the skill. The source lines only repeat what the page already says. Skills
currently without public evidence, and shown as such: Vue.js, React, Angular,
Authentication, Server Administration (SSH/FTP).

## Stored in the reader's browser

| Key | Values | Written when | Read when |
| --- | --- | --- | --- |
| `ma-theme` | `light`, `dark` | The theme button is used | In the head, before first paint |
| `ma-view` | `stage`, `page` | The view button or the hint is used | In the head, and to decide whether to show the hint |

Every read and write is wrapped, so a browser that refuses storage gets the defaults.

## Files beside the page

| File | Made by | From | Size |
| --- | --- | --- | --- |
| `fonts/geist.woff2`, `fonts/geist-mono.woff2` | Google Fonts Latin subset | Geist, SIL OFL 1.1 (`fonts/OFL-Geist.txt`) | 29 KB, 23 KB |
| `media/trail-loop.webm`, `media/trail-poster.webp` | Recorded from Trail's own canvas in headless Chrome | The example scene: ring, into the street, back to the ring | 568 KB, 6 KB |
| `media/fallacy-detector.webp` | Screenshot of the app running its own models locally | `fallacysuspect/argument.txt` | 35 KB |
| `media/story-takes.webp` | Screenshot of the app | A short demo story, labelled as a sample | 12 KB |
| `media/whereyago.webp`, `media/tektak.webp`, `media/snowball.webp` | Screenshots of the apps | Their own demo data; Snowball seeded with one thought | 17 to 33 KB |
| `og.png` | `tools/make-assets.mjs` | `tools/og.html` | 1200x630 |
| `icon.png` | `tools/make-assets.mjs` | `tools/icon.html` | 180x180 |
| `Mohamad-Abboud-Resume.pdf` | `tools/make-assets.mjs` | The page printed with scripts off, links made absolute | Two pages |

The Mailman, Herder, Pneumonia and Evaluaters pictures are inline SVG in the page. Mailman's
chart is drawn from the last run of each label in `mailman/evaluations/`; the others show the
idea and carry no numbers.

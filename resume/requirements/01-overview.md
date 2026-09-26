# Interactive Resume - Overview

## What it is

The front page of moabboud.dev: Mohamad Abboud's resume, written for three readers at once.
A recruiter should know who this is and how to reach Mohamad within ten seconds, often on a
phone. A hiring manager should find the numbers and the projects within a minute or two. An
engineer who opens the source should find something worth asking about.

It is one hand-written page. No framework, no build step for the page itself, no requests to
anyone else's servers, no tracking.

## How it reads

The resume is eight pages across six sections:

| Section | Pages | What it holds |
| --- | --- | --- |
| Index | 1 | Name, title, availability, summary, four headline numbers, contact links |
| Experience | 3 | Independent projects (2026 to now), Tekkii, Allied Engineering Group, one role per page |
| Capabilities | 1 | Skills in five groups, each showing where it was used |
| Projects | 1 | A gallery of ten projects with pictures of the real work |
| Education | 1 | The master's degree and its course project |
| Contact | 1 | Email, LinkedIn, GitHub, the PDF, location |

There are two ways to read it, and the reader chooses:

| View | How it behaves |
| --- | --- |
| Stage (the default) | One screen at a time, moving sideways. Arrow keys, page keys, the wheel, a swipe, the section rail or a number key move between pages |
| One page | The same content as a single scrolling document. A button in the header switches, and a small note under it points the way for a first-time visitor |

The choice is remembered in the reader's own browser and nowhere else.

## What each part does

- **Experience** leads with headlines. Each bullet is a short claim with its number; the full
  sentence from the resume opens beneath it on request.
- **Capabilities** lets the reader pick a skill and see the roles and projects that show it,
  each a link. A skill with no public example stays listed and says so.
- **Projects** is a gallery that moves on its own and loops endlessly. The project in front
  opens into a wide picture (a clip, a screenshot or a diagram drawn from the project's own
  measurements) with its description floating over it. It pauses for a pointer, for keyboard
  focus, for reduced motion, or on request.

## What it promises

| Promise | What that means |
| --- | --- |
| It works without JavaScript | Every word is in the page. Without script it reads as a plain document |
| It can be read from a keyboard | Every control is reachable, focus is visible, and it follows the reader between pages |
| It respects reduced motion | With the preference set, nothing slides, counts or plays |
| It prints as a resume | Printing, and the downloadable PDF, give a two-page resume, not a picture of the website |
| It previews properly | A link pasted into LinkedIn, Slack or email shows a card with name, title and numbers |
| It stays honest | Numbers are the resume's own. Pictures are of the real work. Skills link only to places that show them |
| It keeps nothing about the reader | The theme and the view choice stay in the reader's browser. No analytics, no counters |

# Requirements standard

Every app in this repository keeps a `requirements/` folder next to its code. That folder
is the source of truth for what the app is supposed to do. Code that disagrees with it is
either a bug or an out-of-date document, and one of the two gets fixed.

This folder holds the standard itself, a blank template to copy, and the documents for the
portfolio landing page (which has no folder of its own, since it is the repo root
`index.html`).

## The six documents

Each app's `requirements/` folder contains the same six files, in the same order. The
numbering is the reading order for someone new to the project, and roughly the order in
which the documents get written.

| File | Answers |
| --- | --- |
| `00-plan.md` | What gets built, in what order, and what "done" means for each stage |
| `01-overview.md` | What the app is, what it does for the person using it, and how they use it |
| `02-interaction.md` | Who talks to the system, where its boundary is, and what it deliberately ignores |
| `03-architecture.md` | The pieces inside the boundary, the classes, and how a request moves through them |
| `04-data-model.md` | What gets stored, in what tables, with what relationships |
| `05-tasks.md` | The current work list, checked off as it lands |

## Rules for writing them

**`01-overview.md` is the public document.** Write it as if a stranger will read it. It
describes behaviour, not mechanism. No file names, no class names, no library choices, no
credentials, no model weights, no internal thresholds. If a competitor reading it would
learn how to rebuild the clever part, cut that part.

**`03-architecture.md` and `04-data-model.md` are the internal documents.** They may name
classes, modules, tables and columns. They still must not contain a secret value: no API
keys, tokens, passwords, connection strings, or seeds. Refer to secrets by the environment
variable that supplies them.

**Diagrams are Mermaid, inline in the Markdown.** GitHub renders them, they diff as text,
and they never go stale in a binary file nobody can open. Use `flowchart` for process,
`classDiagram` for structure, `sequenceDiagram` for one path through the system over time,
and `erDiagram` for storage.

**Scope is stated as two lists.** Every `02-interaction.md` has an "in scope" and an
"explicitly not in scope" section. The second list is the more useful one; it is what stops
the app growing sideways.

**Status is honest.** If a table exists but nothing writes to it, say so. If a phase is
half done, say which half. A requirements folder that overstates progress is worse than no
folder.

**No decoration.** No emoji, no exclamation marks, no marketing adjectives. These are
working documents.

## Adding a new app

1. Copy `requirements/TEMPLATE/` into `<your-app>/requirements/`.
2. Fill in `01-overview.md` first. If you cannot write it in plain language, the idea is
   not ready.
3. Fill in `02-interaction.md`. Force yourself to write the "not in scope" list.
4. Then `04-data-model.md`, then `03-architecture.md`, then `00-plan.md`, then `05-tasks.md`.
   Data before structure before schedule.
5. Revisit `05-tasks.md` at the end of every working session.

## Where each app's folder lives

| App | Requirements folder |
| --- | --- |
| Portfolio landing page | `requirements/portfolio-shell/` |
| whereyago | `whereyago/requirements/` |
| fallacysuspect | `fallacysuspect/requirements/` |
| Eval harness | `evaluaters/eval-harness/requirements/` |
| Triage agent | `evaluaters/triage-agent/requirements/` |
| tektak | `tektak/requirements/` |
| Snowball Creator | `snowball/requirements/` |
| Breakdown Takes | `story generator/requirements/` |
| Interactive resume | `resume/requirements/` |

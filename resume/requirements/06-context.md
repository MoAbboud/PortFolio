# Interactive Resume - Context and handoff

Working memory for this build. If you are an instance picking this up cold, read this file
first and trust it over your assumptions about the folder.

This file exists because context runs out mid-build. It holds the things that are expensive
to rediscover: what was decided and why, what is still open, and what the resume actually
says. It is not a status report for the user. Keep it current as decisions land.

Last updated: 2026-07-29.

## Read this before touching anything

**The page is being rebuilt from scratch.** `resume/index.html` currently holds the previous
version. It is a complete, working, single-file interactive resume and it is **not the base
to build on**. The user chose a from-scratch rebuild over evolving it, explicitly, when
offered both. Do not patch the old page into shape.

**Documents 01 through 05 describe the old page, not the new one.** They were restored from
git after an accidental working-tree deletion and are pending a rewrite around the new
direction. Where they disagree with this file, this file is right. Where they describe the
old page's decisions, treat them as prior art worth stealing from rather than as
requirements.

## State

| Thing | State |
| --- | --- |
| Resume content | Received 2026-07-29. Recorded below. This is the source of truth |
| Interaction concept | Not settled. The user said more ideas are coming |
| Claude Design project | Not created yet, deliberately. Waiting on the concept |
| New page | Not started |
| Old page | Untouched at `resume/index.html` |
| Docs 01-05 | Restored, describe the old page, pending rewrite |

## Decisions made

| Decision | Reason |
| --- | --- |
| Rebuild from scratch rather than evolve the existing page | The user's explicit choice when offered evolve, rebuild, or build-a-rival. Nothing carries over that was not chosen |
| A new Claude Design project holds the design system | Rather than reusing the user's existing Loonly, Trailhaus or OnTrack projects. It becomes the shared visual language for the portfolio |
| The design system is built from the concept, not before it | An empty design system is worthless. Tokens, type scale and motion primitives should come out of a settled direction |
| Requirements docs get rewritten, not amended | The old docs describe a different page |
| Heavy motion and animation is a goal, not a risk to manage | The user asked for it directly. Note this reverses the old page's stated risk that "effects overwhelm the content" |

## Open questions

| Question | Blocks | Notes |
| --- | --- | --- |
| Single static file with no build step, or motion libraries (GSAP, Three.js, WebGL, Lenis)? | Everything downstream | Raised with the user, not yet answered. The repo convention is keyless single-file static HTML. Hand-written CSS/JS covers a great deal of motion; scroll-linked 3D, physics and morphing transitions are where it stops being worth hand-rolling |
| What is the interaction concept? | The design system, then the page | The user said ideas are coming. Do not guess a concept and build it |
| Does the page keep the old page's content-in-lists pattern? | Architecture | Strongly recommended regardless of concept. A resume that is annoying to update stops being updated |
| What happens to the old `index.html`? | Delivery | Replaced in place, or kept alongside. Not discussed |

## Constraints that carry over from the old page

These were good calls and the reasoning still holds. They are not binding on the rebuild,
but discard them deliberately rather than by accident.

- Content lives in lists in the page, not in the markup. Updating the resume means editing a
  line.
- Every effect decorates content that is already present. Nothing is gated behind an
  animation.
- Both themes are built completely, rather than one applied over the other.
- The theme is the only thing persisted. No analytics, no tracking, no visit counting.
- No contact form. Nothing would receive it.
- Skill levels, if used at all, are self-assessed and cannot honestly be presented as scores.

## Known gaps the old page never closed

Carry these into the rebuild as first-class work rather than rediscovering them at the end.
They matter more here than on most pages: a resume claiming front-end competence that cannot
be used from a keyboard is arguing against itself.

- Keyboard operation of every interactive control, with state announced.
- Visible focus indicators, checked in both themes.
- A reduced-motion preference that genuinely stops the motion. With heavy animation this
  becomes the single largest accessibility surface in the build.
- Content still appearing when reveal animations are suppressed, rather than staying
  invisible.
- Contrast checked across both themes.
- Printing. People do print resumes and attach them to things.

## Source content

The resume as supplied by the user on 2026-07-29. This is authoritative. Do not paraphrase
the achievement numbers, and do not invent metrics that are not here.

### Identity and contact

Carried over from the old page, not restated in the supplied resume. Verify before
publishing.

| Field | Value |
| --- | --- |
| Name | Mohamad Abboud |
| Title | Full-Stack Software Engineer |
| Email | mohammad.a.abboud@gmail.com |
| Phone | (406) 920-5162 |
| GitHub | github.com/MoAbboud |
| Location | Kansas City, Missouri |

### Professional summary

Full-stack software engineer with five years of end-to-end ownership of client-facing
applications, from requirements and architecture through deployment, infrastructure, and
ongoing support. Skilled across C#/.NET, Python, and PHP, with a track record spanning secure
financial transaction platforms processing thousands of daily transactions for 400+ banking
institutions and a portfolio of commercial web products, serving as the sole technical owner
and primary client contact driving projects to delivery.

### Technical skills

The resume groups these into four categories. The old page used six and self-assessed
levels; the supplied resume does neither. Treat these four groups as the real structure.

| Group | Entries |
| --- | --- |
| Languages | PHP, Python, JavaScript, C#, SQL |
| Web Development | Public-Facing Web Applications, REST APIs, HTML/CSS, Vue.js, React, Angular, Node.js, Responsive Design |
| Databases | PostgreSQL, SQL Server, MySQL, Query Optimization, Stored Procedures, Schema Design, Data Modeling, Large Dataset Processing |
| Architecture and Delivery | System Design, API Design, Legacy System Modernization, Web Application Security, Authentication, Git/GitHub, Docker, CI/CD Pipelines, Server Administration (SSH/FTP), Agile/Scrum, Requirements Gathering, Stakeholder Communication |

Note that "Architecture and Delivery" mixes technical and non-technical skills, and several
entries are practices rather than technologies. A design that assumes every skill is a
logo-able technology will not fit this list.

### Experience

**Full Stack Web Developer, Tekkii. January 2023 - January 2026. Kansas City, KS.**

- Owned a portfolio of six client web applications across logistics, e-commerce, public
  sector, and retail as the sole technical lead, driving each engagement from requirements
  and client communication through architecture, development, deployment, and ongoing
  support in an Agile/Scrum process.
- Architected and built an automated EDI capture and transmission system from the ground up
  for Kansas City Drayage, replacing an entirely manual data-entry workflow, cutting
  processing time by roughly 80% and contributing to a 50% increase in profit.
- Set the backend direction across the client portfolio, designing RESTful APIs, service
  layers, and optimized SQL databases (PostgreSQL, SQL Server, MySQL) in Python and PHP, and
  integrating third-party services including PayPal, SendGrid, and OneSignal.
- Inherited and stabilized applications built by previous developers, clearing long-standing
  defects and advising application owners on architecture, technical debt, and feature
  direction.
- Led the rebuild of an e-commerce platform's backend and database layer, driving growth in
  traffic and revenue that supported the product's successful acquisition.
- Delivered an interactive, hardware-integrated installation at the College Basketball
  Experience, personally integrating a custom application with cameras, displays, and a
  teleprompter.

**Software Engineer, Allied Engineering Group. June 2019 - June 2021. Beirut, Lebanon.**

- Built and maintained SWIFT financial transaction platforms in C#/ASP.NET on SQL Server,
  processing thousands of secure transactions daily for over 400 banking institutions
  worldwide, including QNB.
- Owned the data layer for mission-critical, high-throughput transaction systems, designing
  schemas and stored procedures and optimizing complex queries to improve application
  performance and reliability.
- Served as the direct technical liaison to banking clients, gathering requirements and
  delivering customized interfaces and features that measurably increased usability and
  client satisfaction.
- Diagnosed and resolved production issues by monitoring SQL and application logs,
  maintaining uninterrupted operations for banking clients and surfacing risks and blockers
  ahead of release.

### Education

University of Missouri-Kansas City. Master of Science in Computer Science. 2021 - 2023.

Course project: Pneumonia Detection App, a deep learning application for medical image
analysis in Python.

## What changed from the old page's content

Worth knowing, because the old page's numbers are now wrong in places and a careless copy
would carry them forward.

| Old page | Supplied resume |
| --- | --- |
| "five years shipping client-facing applications" | Five years of end-to-end ownership. Same span, stronger claim |
| No portfolio size given | Six client applications, named sectors |
| EDI system "sharply reducing manual processing time" | Roughly 80% processing time cut, 50% profit increase |
| "processing high volumes" for 400+ banks | Thousands of secure transactions daily, QNB named |
| Capstone project | Described as a course project |
| Six skill groups with self-assessed percentage levels | Four groups, no levels |
| Job title "Full Stack Developer" at Tekkii | "Full Stack Web Developer" |

The self-assessed skill percentages in the old page were invented for that page and are not
in the supplied resume. Do not carry them over without asking.

## Neighbouring work

The portfolio repository holds several sibling apps the projects section could link to:
`snowball`, `whereyago`, `story generator`, `tektak`, `evaluaters`, `fallacysuspect`, and the
root `index.html` game-style landing page. The old page linked to most of them plus a live
Pneumonia Detector deployment. Whether the rebuild does the same is open.

## Repository conventions that apply

- Every app in this repository carries a `requirements/` folder with numbered documents.
- Documents use no emoji, use Mermaid for diagrams, and use tables over prose lists.
- Portfolio apps are conventionally free, keyless, single-file static HTML. Whether this
  page stays inside that convention is the largest open question above.

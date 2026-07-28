# Interactive Resume - Overview

Public document. Behaviour only.

## What this is

A single-page resume that behaves like a small application rather than a document. It has
sections for background, skills, work history, projects, education and contact, and it
lets a reader filter and expand rather than scroll past everything.

It is also, quietly, part of the argument it is making. A resume claiming front-end ability
should be evidence of it, and this one is hand-written with no framework and no build step.

## The problem it addresses

A resume gets a short first look, and different readers want different things from it. A
recruiter wants the roles and dates. An engineer wants the technologies. A hiring manager
wants what was actually shipped. A flat document makes all three read the same page in the
same order.

Making the skills filterable and the roles collapsible lets each of them get to their part
quickly, without hiding anything from anyone.

## What it does

| Capability | Description |
| --- | --- |
| Introduce | A header with the name, the role, and a line that types itself through several descriptions |
| Filter skills | Skills grouped by kind - languages, front end, back end, data, operations - filterable to one group |
| Show relative depth | Each skill carries a self-assessed level, shown as a bar that fills when it comes into view |
| Expand a role | Work history as a timeline, each role expandable to its detail and the technologies used |
| Show projects | A set of project cards |
| Cover the rest | Education and contact |
| Remember the theme | Light or dark, chosen by the reader and remembered on their next visit |
| Show progress | A bar indicating how far through the page the reader is |

## How to use it

There is nothing to learn. Open it and read. Filter the skills if only one kind matters,
expand the roles that look relevant, switch the theme if the default is wrong for the room.

## What it does not do

- It does not collect anything. No form, no tracking, no analytics, no cookie beyond the
  theme preference.
- It does not have a back end, an account, or a login.
- It does not update itself. The content is written into the page and changes when the page
  is edited.
- It does not export to a document format. Printing is the browser's job and it has not
  been designed for.

## A note on the skill levels

The numbers behind the skill bars are self-assessed. They are useful for showing relative
depth across a list - which things are strongest, which are known but not deep - and they
are not a measurement of anything. Anyone reading them as a score is reading more into them
than they hold.

## Requirements to run it

A browser. No installation, no account, no server, no connection needed once loaded.

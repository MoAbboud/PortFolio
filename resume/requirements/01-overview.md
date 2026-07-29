# Interactive Resume - Overview

Public document. Behaviour only.

## What this is

A resume that occupies exactly one screen and never scrolls. The content is divided into
seven pages across six sections, and the reader moves between them the way they would move
through a presentation rather than the way they would move through a document.

It is also, quietly, part of the argument it makes. A resume claiming front-end ability
should be evidence of it, so this one is hand-written in a single file with no framework, no
build step and no dependency of any kind. It opens from a file on disk with no server.

## The problem it addresses

A resume gets a short first look, and a long scrolling page spends that look badly. The
reader arrives at the top, scrolls past whatever does not interest them, and forms an
impression from whatever happened to be in view.

Removing the scrollbar changes what the page can do. Every unit of content is composed to fit
the screen it is on, which means nothing is ever half-visible, nothing is competing for
attention with the thing below it, and the reader is always looking at one complete idea.

## What it does

| Capability | Description |
| --- | --- |
| Present one thing at a time | Seven pages, each composed to fit the screen exactly. Nothing scrolls |
| Move deliberately | Arrow keys, page keys, digits, the wheel, a swipe, the section rail, or the header. Movement is a choice the reader makes |
| Move differently in each direction | Going forward and going back are visibly different, so the reader knows which way they went |
| Separate the two roles | Work history is one role per page, at full detail, rather than two roles competing for one screen |
| Group capabilities | Four groups, shown as four columns on a wide screen and one group at a time on a narrow one |
| Show the work | Project cards linking out to what is running |
| Remember the theme | Light or dark, chosen by the reader and remembered on their next visit |
| Say where you are | A page counter, a section rail and an address that updates, so a page can be linked to directly |
| Collapse for print | Printing produces a normal document with every page expanded, in order, without the machinery |

## How to use it

There is nothing to learn, and the page says so at the bottom of the screen. Press an arrow
key. Everything else is an alternative to that.

| Input | Effect |
| --- | --- |
| Left and right, up and down, page up and page down | Previous and next page |
| Space, and shift with space | Next and previous page |
| Home and end | First and last page |
| Digits one to six | Jump directly to a section |
| Wheel or trackpad | Next and previous page, read as intent rather than as distance |
| Swipe | Next and previous page |
| The rail, the header, the menu, the arrows at the bottom | Direct navigation |

## What it does not do

- It does not scroll, and it does not zoom. Both were considered and rejected.
- It does not collect anything. No form, no tracking, no analytics, no third-party anything.
- It does not have a back end, an account or a login.
- It does not load a single byte from anywhere else. No fonts, no scripts, no images.
- It does not update itself. The content is written into the page and changes when the page
  is edited.

## Requirements to run it

A browser. No installation, no account, no server, no network.

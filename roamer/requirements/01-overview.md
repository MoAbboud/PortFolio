# roamer - Overview

Public document. Behaviour only.

## What this is

A map of lost animals. When a pet goes missing, its owner drops a pin where it was last
seen and adds what would be on the flyer: a photo, a description, when it went missing, and
a number to call. Anyone who finds or sees an animal can open the map, look at the area they
are standing in, and find out whether somebody nearby is looking for it.

Every listing says how much it can be trusted. An owner confirms by email that the listing
is theirs, and the site keeps asking them whether the animal is still missing. A listing
that has been confirmed recently carries a verified badge. One that has not says so.

It is a website, built for a desktop browser first and usable on a phone.

**It is a demo for now.** The listings on the hosted copy are made up. Everything works -
posting, verifying, the check-ins, searching, printing a flyer - but the emails it would
send appear in a demo inbox on the site instead of going anywhere, and anything a visitor
posts is wiped every day. Do not enter real details.

## The problem it exists for

When a dog goes missing, the owner prints flyers and puts them up where the dog might turn
up: the street it ran from, the park it likes, the shops on the way. A flyer works for
somebody standing in front of it. It does nothing for the person three streets away who has
just found a dog with no tag and wants to know whether anyone is missing it.

That person's options today are to call around, post in local groups, and scroll. Lost-pet
posts in social media groups scroll out of sight within a day, are spread across many
groups, and are almost never updated when the animal comes home. Someone searching a week
later finds a pile of posts and no way to tell which are still true.

roamer puts the flyers on one map, in the place they belong, and keeps each one current.

## What it does

| Capability | Description |
| --- | --- |
| Post a lost animal | An owner fills in what would go on a flyer, drops a pin where the animal was last seen, and adds photos and the flyer itself if one exists |
| Confirm the owner | The listing goes live only after the owner clicks a link sent to their email address. That address is never shown publicly |
| Browse the map | Every active listing as a pin. Filter by species and by how recently the animal went missing |
| "I found an animal" | Enter where you are, or where you found it, and see the lost animals reported nearest that point, closest and most recent first |
| Keep listings current | The site emails the owner at a regular interval to ask whether the animal is still missing. One click to say still lost, found, or take it down |
| Show how current it is | Each listing shows when the owner last confirmed it. A verified badge appears only when that confirmation is recent |
| Update or close | An owner can edit the listing, mark the animal as home, or withdraw it, from a link sent to their email. No account, no password |
| Search circles | Around the last-seen point, the distance within which most lost animals of that kind are found, according to published studies - so searchers and flyers go where the animal most likely is. Labelled with where the figure comes from, and never presented as a prediction |
| Print a flyer | Any listing can be printed as a flyer with a code that a phone camera opens straight to the listing page, so the paper on the pole points back to the current information |
| Report a problem | Anyone can flag a listing as wrong, abusive or a scam. An admin reviews it |
| Get help | A Help page, linked from every page, says the site has an admin, what the admin can do - take down a scam, fix wrong details, help an owner who has lost access to their listing - and has a form to send them a message |
| Admin control | One admin, behind a password - the admin section is never open to visitors - sees every listing in every state on a map and in a table, and can approve, hide, edit, delete, block an address, and choose whether new listings need approval before they appear |

Planned for later, and not part of the first version:

| Capability | Description |
| --- | --- |
| Bring in public posts | Lost-pet posts from social media added to the map as unclaimed listings, so a finder sees them in one place. The owner can then claim the listing and verify it. How posts get in is an open question - see the plan |
| Report a sighting | "I saw this dog here, at this time" added to an existing listing, so the owner can see where it has been |
| Report a found animal | A finder who has the animal now can put it on the map for owners to find |
| Learn where lost pets go | When an owner marks an animal home, they can say where it was found and how. Over time that builds the record no public dataset has - where lost animals actually end up - and a model trained on it would be compared against the search circles before anyone sees it |

## What "verified" means here

The verified badge is a narrow claim, stated plainly on the site:

> The person managing this listing controls the email address it was posted with, and
> confirmed within the last few days that the animal is still missing.

It does not mean the site has proved who owns the animal. Nothing a website can check
proves that. A microchip, a vet record or a photo of the owner with the animal is what a
finder should ask for before handing an animal over, and the site says so on every listing.

A listing loses its badge when the owner stops answering. It does not disappear straight
away - an owner on holiday is still missing their dog - but it says how long it has been
since anyone confirmed it, and after long enough it drops off the default map.

## How it is used

For an owner:

1. Open the site and choose "Report a lost animal".
2. Fill in the details, drop the pin where the animal was last seen, add photos.
3. Check email and click the link. The listing is now on the map, verified.
4. Every few days, an email asks whether the animal is still missing. One click answers it.
5. When the animal is home, mark it found. The listing comes off the map.

For a finder:

1. Open the site and choose "I found an animal", or just look at the map around where they
   are.
2. See the lost animals reported nearby, with photos, descriptions and how recently each
   owner confirmed.
3. Call the number on the listing.

## What it does not do

- It is not a mobile app. It is a website, and works in a phone's browser.
- It does not prove ownership. It tells a finder who to call and how current the listing
  is. The handover is between two people.
- It does not handle money. No rewards, no payments, no fees. The site will never ask
  anyone for money, and says so, because asking a desperate owner for money is the most
  common lost-pet scam.
- It does not show an owner's email address, or any location more exact than the owner
  chose to give.
- It does not read social media by itself in the first version. Whether it ever does, and
  how, is an open question with real constraints on it.
- It is not a shelter or rescue database, and it does not replace calling local shelters,
  vets and microchip registries. The site tells owners to do both.

## Privacy

- An owner's email address is used for confirmation and the regular check-in, and nothing
  else. It is never shown.
- The phone number is shown on the listing because that is what the listing is for - it is
  already on the paper flyer. The owner can choose to leave it off.
- Photos have their embedded location data removed when they are uploaded. A photo taken
  in the back garden otherwise carries the owner's home address inside it.
- The pin is where the animal was last seen, not the owner's address. The owner can choose
  to show an approximate area instead of an exact point.
- An owner can take a listing down at any time, and it is removed from the site, not just
  hidden.

## Requirements to run it

Docker, and one Docker Compose command, driven from a PowerShell terminal on Windows. The
map is built from OpenStreetMap data, served by OpenFreeMap in a quiet white-and-grey style,
and needs no account and no key. In development, email goes to a
local mail catcher that shows every message in a browser, so nothing needs to be signed up
for to run the whole thing. The hosted demo sends no email at all. Running it as a real
service would need mail server credentials supplied through the environment.

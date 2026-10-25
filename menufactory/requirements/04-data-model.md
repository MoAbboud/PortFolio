# Menu Factory - Data model

Nothing here exists yet. The shape matters more than the exact field names.

The **venue content** is the centre of everything: one JSON file per venue, `venue.json`,
checked against one schema by the tests and by the owner admin before it saves. The samples
and the real venues use the same file. Looks read it; the admin writes it; neither knows
about the other.

The rule the whole project rests on: **a look may only use what the venue content defines.**
If a look needs a field that is not here, the field is added here first, with a sensible
behaviour when it is empty, so every other look and every existing venue keeps working.
That rule is what makes "switch the look" a one-line change.

## Venue content

```mermaid
erDiagram
    VENUE ||--|| STYLE : "looks like"
    VENUE ||--|{ LOCATION : "has"
    LOCATION ||--|{ WEEKLY_HOURS : "open"
    LOCATION ||--o{ HOURS_EXCEPTION : "except"
    LOCATION ||--o{ HAPPY_HOUR : "runs"
    VENUE ||--|{ MENU : "serves"
    MENU ||--|{ MENU_SECTION : "contains"
    MENU_SECTION ||--|{ MENU_ITEM : "lists"
    MENU_ITEM ||--o{ PRICE_OPTION : "priced as"
    VENUE ||--o{ EVENT : "hosts"
    VENUE ||--o{ NOTICE : "announces"
    VENUE ||--o{ PHOTO : "shows"
    VENUE ||--o{ SOCIAL_LINK : "is on"

    VENUE {
        text slug
        text name
        text kind
        text tagline
        text about
        text cuisine
        int price_range
        text language
        text currency
        text mode
    }
    STYLE {
        text look
        text color_primary
        text color_accent
        text logo
        text logo_light
    }
    LOCATION {
        text street
        text city
        text region
        text postal_code
        text country
        float lat
        float lng
        text phone
        text time_zone
    }
    WEEKLY_HOURS {
        text day
        time opens
        time closes
    }
    HOURS_EXCEPTION {
        date from_date
        date to_date
        bool closed
        time opens
        time closes
        text note
    }
    HAPPY_HOUR {
        text day
        time starts
        time ends
        text note
    }
    MENU {
        text name
        text served
        text note
    }
    MENU_SECTION {
        text name
        text note
    }
    MENU_ITEM {
        text name
        text description
        text ingredients
        text tags
        decimal happy_hour_price
        text photo
        bool sold_out
    }
    PRICE_OPTION {
        text label
        decimal amount
    }
    EVENT {
        text title
        date date
        time starts
        text repeats
        text description
        text photo
    }
    NOTICE {
        text text
        date starts
        date ends
    }
    PHOTO {
        text file
        text alt
        text use
    }
    SOCIAL_LINK {
        text kind
        text url
    }
```

## Fields that need a rule

| Field | Rule |
| --- | --- |
| `slug` | Lowercase, hyphens, unique. Names the output folder and the preview address |
| `kind` | The category: `cocktail-bar`, `bar`, `restaurant` to start, the same names as the `designs/` folders; grows with the library. Filters the library; never stops a venue using a look made for another category |
| `cuisine` | Free text for restaurants - "Mexican", "American". The library's Mexican and American looks are restaurant looks filtered by this |
| `mode` | `preview` or `live`. Defaults to `preview` |
| `STYLE.look` | The name of a look. The one value a switch changes. Unknown names stop the build |
| `STYLE` colours | Optional. Each look's `look.json` says whether it accepts them |
| `logo`, `logo_light` | The venue's logo; a light version for dark looks |
| `language`, `currency` | Set from the start so an international venue is a value change |
| `price_range` | One to four, shown in the venue's currency symbol |
| `time_zone` | An IANA name such as `America/Chicago`. Required |
| `WEEKLY_HOURS` | Any number of ranges per day. A range that closes after midnight belongs to the day it opened. No ranges means closed |
| `HOURS_EXCEPTION` | Beats the weekly hours for every date it covers |
| `HAPPY_HOUR` | Its own weekly windows; live only while the venue is also open |
| `MENU_ITEM.ingredients` | A short list, shown under the name |
| `MENU_ITEM.tags` | Fixed list: `vegetarian`, `vegan`, `gluten-free`, `dairy-free`, `nut-free`, `spicy`, `zero-proof`, `new`, `house-favourite`, `seasonal`. Icon plus text label, never icon alone |
| `PRICE_OPTION` | One amount for most items; several for sizes or pours; none for "market price" |
| `EVENT.repeats` | Empty, `weekly` or `monthly`. A past one-off event drops off at the next daily build |
| `NOTICE` | Shown only between `starts` and `ends` |
| `PHOTO.alt` | Required. In the admin, the upload screen asks "describe this photo" in plain words |
| `PHOTO.use` | `hero`, `gallery`, `drink`, `dish`, `interior`, `bar`, `team`, `event` |
| `SOCIAL_LINK.kind` | `instagram`, `facebook`, `tiktok`, `google`, `yelp`, `other`. No order, delivery or reservation kind |

## What an owner may change, and what they may not

The author's line: owners control their site's content, not its art.

| The owner may change, in the admin | The owner may not change |
| --- | --- |
| Venue name, tagline, about text | Layout, sections, order of pages |
| Menus, sections, items, ingredients, prices, tags, sold out | Motion, timing, effects, 3D scenes |
| Hours, holiday exceptions, happy hour | Fonts and type sizes |
| Events and notices | The look's own art and imagery |
| Their photos, and which use each one is for | Colours, except where a look accepts the venue's own and the author has set them |
| Logo | The look itself - they can see others and ask to switch |
| Address, phone, social links | Mode (preview or live), slug, domain |

## Admin records (stage 4)

There is no database. What a database would hold, git already holds:

| Record | Where it lives |
| --- | --- |
| Owner account | The owner's GitHub account, given access to their venue's repository only |
| Venue version | Every save is a commit; any earlier version can be restored from the history |
| Draft | In the admin, if it supports drafts - checked in the stage 4 spike |
| Publish run | The publish workflow's run in GitHub Actions: when, whether the checks passed |
| Look request | A note the admin files for the author (an issue on the venue's repository is the simplest form); the author's answer is the switch, or a reply |

## Tabled: reviews (later)

Kept here so the schema leaves room:

| Record | Holds |
| --- | --- |
| Review | Reviewer name as Google gives it, stars, text, date, sentiment (good, mixed, bad), shown on site (the owner's choice) |
| Item mention | Which review mentions which menu item, the sentence, its sentiment |
| Rating summary | Overall rating, total count, link to all reviews, when fetched |

## Stored only in the guest's browser

- The less motion / more motion choice. Nothing else.

## What is deliberately not stored

- Anything about guests.
- Payment details.
- Venues' passwords for their domain, Google or social accounts.
- Credentials in any file. The few that exist (the admin's sign-in helper, later the reviews
  job) are GitHub Actions or Cloudflare secrets.
- **Business records: prospects, plans, prices, contracts, invoices, outreach.** These live
  outside this public repository, in a private tracker.

## The brand file

`brand.js`, one for the whole product: `name` ("Menu Factory" for now), the library's
address, the author's contact, the preview bar's wording, the optional footer credit. A test
fails if the name's value appears anywhere else in `looks/`, `shared/`, `library/` or `admin/`.

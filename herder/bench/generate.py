"""Generate the stage 9 benchmark conversations.

Eight synthetic conversations, two per archetype, 8,000 to 15,000 tokens each.

    python -m bench.generate

## Why not the stage 4 generator

`corpus/generate.py` wrote the conversations the heuristic extractor was then fixed against -
its rejection patterns were written by reading those exact phrasings. Benchmarking on them
would grade the heuristic on its own homework. This generator uses different subjects (none
of them herder itself), different user phrasings, and a different seed, so no rule in the
extractor was tuned on its output.

## What it deliberately does not write

**The fact lists.** They are written by a person reading the conversation, in the authoring
page at `/bench`, and that is what stops the benchmark being the system grading itself. So
this file emits the conversation and a small `meta.json`, and no record of what it planted:
a manifest here would be an answer key sitting one step away from being copied.

## What each conversation contains

Each is a scenario played out as a long chat, with the situations a memory has to get right:
decisions, hard constraints, preferences, plain facts, open threads, code state (coding
only), assistant proposals the user turns down, decisions reversed later on, constraints
restated in other words, and a great deal of assistant explanation that mentions options
nobody chose. That last part is what a hallucination measure needs: plausible material that
is present in the conversation and never agreed.

Every turn is unique, asserted before anything is written - the stage 2 lesson, where a
repeated turn was silently dropped at ingest and the benchmark measured a smaller
conversation than it believed.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path

from herder.core.tokens import count_tokens

HERE = Path(__file__).resolve().parent
DATASETS = HERE / "datasets"
SEED = 20260913
GENERATOR_VERSION = "1"
MIN_TOKENS, MAX_TOKENS = 8_000, 15_000


@dataclass
class Scenario:
    name: str
    archetype: str
    title: str
    opening: str
    decisions: list[str]
    constraints: list[tuple[str, str]]  # (first statement, later restatement in other words)
    preferences: list[str]
    facts: list[str]
    open_threads: list[str]
    rejected: list[tuple[str, str]]  # (assistant proposal, the user's refusal)
    reversals: list[tuple[str, str]]  # (original decision, later reversal)
    nouns: list[str]
    alternatives: list[str]  # options the assistant mentions that nobody chooses
    code: list[tuple[str, str]] = field(default_factory=list)  # (user sentence, code block)


# --------------------------------------------------------------------------- scenarios

SCENARIOS: list[Scenario] = [
    Scenario(
        name="coding-bakery-inventory",
        archetype="coding",
        title="An inventory service for a small bakery chain",
        opening=(
            "I'm building the inventory service for Crumb & Co, a bakery chain with four shops. "
            "It tracks flour, butter and packaging stock per shop and tells the head baker what to "
            "reorder. I'd like to work through the design with you over the next while."
        ),
        decisions=[
            "The service is written in Python with FastAPI.",
            "Stock levels are stored in SQLite, one file per deployment, because it runs on a single small server in the back office.",
            "Reorder suggestions are generated once a night at 2am, not on every stock change.",
            "Each shop is identified by a short code: CRM1, CRM2, CRM3 and CRM4.",
            "The head baker gets reorder suggestions by email, not by text message.",
            "Units are stored in grams for dry goods and in pieces for packaging.",
        ],
        constraints=[
            ("Stock quantities are never allowed to go negative - a sale that would do that is rejected.",
             "To say it again plainly: a negative stock figure must be impossible, and the write that would cause one gets refused."),
            ("Nothing leaves the back-office network - no cloud services for this system.",
             "Remember this runs entirely inside the back office; no part of it may call out to a cloud provider."),
            ("Every stock change must record who made it and when.",
             "Each adjustment has to carry the person and the timestamp, no exceptions."),
        ],
        preferences=[
            "I prefer plain functions over classes unless a class clearly earns its place.",
            "Please keep code examples short - under twenty lines if you can.",
            "I like type hints on every function signature.",
        ],
        facts=[
            "The chain has four shops and one central bakery that supplies them.",
            "The head baker is called Marisol.",
            "Flour is delivered on Tuesdays and Fridays.",
            "The back-office server is a second-hand mini PC with 8 GB of RAM.",
            "The busiest shop is CRM2, near the train station.",
        ],
        open_threads=[
            "We still haven't decided how to handle stock that expires, like butter past its date.",
            "I need to work out whether returns from shops go back into central stock.",
            "The reorder threshold per ingredient is still undecided.",
        ],
        rejected=[
            ("You could put Redis in front of SQLite as a cache so the nightly job reads faster.",
             "No Redis - it's one more thing to run on a tiny box, and the nightly job has all night anyway."),
            ("It might be worth moving to PostgreSQL now so you never have to migrate later.",
             "I don't want Postgres for this. SQLite is enough for four shops and I'd rather not run a database server."),
            ("A small React dashboard would let each shop manager see their own stock.",
             "Not now. Shop managers won't log in to anything; the email to Marisol is the whole interface for this version."),
        ],
        reversals=[
            ("Reorder suggestions go to Marisol only.",
             "Change of plan on who gets the reorder email: it goes to both Marisol and the shop manager of the shop concerned, not Marisol alone."),
            ("We'll round stock to the nearest 100 grams.",
             "Scrap the rounding I mentioned earlier - keep stock exact to the gram, bakers weigh precisely and rounding hid real shortages."),
        ],
        nouns=["the nightly job", "the stock table", "a stock adjustment", "the reorder email", "the shop codes",
               "the audit trail", "a delivery", "the SQLite file", "the back-office server", "expiry dates"],
        alternatives=["an event-sourced ledger", "a message queue", "a spreadsheet import", "barcode scanners",
                      "a mobile app", "hourly reorder runs", "a microservice per shop", "an ORM migration tool"],
        code=[
            ("This is where the stock adjustment lives right now, in stock.py:",
             "```python\ndef adjust(conn, shop: str, item: str, delta: int, who: str) -> None:\n"
             "    current = read_level(conn, shop, item)\n"
             "    if current + delta < 0:\n"
             "        raise ValueError(\"stock cannot go negative\")\n"
             "    write_level(conn, shop, item, current + delta, who)\n```"),
            ("And the nightly entry point is in jobs/reorder.py, run by cron:",
             "```python\ndef main() -> None:\n    for shop in SHOPS:\n        suggestions = compute(shop)\n"
             "        send_email(shop, suggestions)\n```"),
        ],
    ),
    Scenario(
        name="coding-photo-sync",
        archetype="coding",
        title="A command-line tool that syncs phone photos to a home NAS",
        opening=(
            "I'm writing a small command-line tool called snapshelf that copies photos from my family's "
            "phones onto our home NAS and sorts them into folders. I want to talk the design through "
            "properly before I write much more."
        ),
        decisions=[
            "snapshelf is written in Go so it ships as a single binary.",
            "Photos are sorted into folders by year and then month, like 2024/07.",
            "Duplicates are detected by a SHA-256 hash of the file contents, not by filename.",
            "The tool runs on the NAS itself on a schedule, every six hours.",
            "Configuration lives in a TOML file at /etc/snapshelf/config.toml.",
            "Videos are copied too, but into a separate top-level folder called video.",
        ],
        constraints=[
            ("snapshelf must never delete or modify an original file on a phone.",
             "Just so it's clear: the originals on the phones are read-only as far as this tool is concerned, it never deletes or edits them."),
            ("It has to keep working when the NAS disk is nearly full - it stops copying and says so, rather than failing halfway.",
             "If the disk is almost full the tool must stop cleanly and report it, not leave a half-copied file behind."),
            ("No photo ever leaves the house - no cloud backup in this tool.",
             "Everything stays on the home network; this tool must not upload anything anywhere."),
        ],
        preferences=[
            "I want log messages to be one line each, no multi-line stack dumps.",
            "Explain Go idioms when you use them, I'm still fairly new to Go.",
            "I'd rather have fewer dependencies even if it means a bit more code.",
        ],
        facts=[
            "The NAS is a Synology DS220+ with two 4 TB disks.",
            "There are three phones in the house: two Android and one iPhone.",
            "The photo library is currently about 180 GB.",
            "The phones sync to the NAS over a share called family-drop.",
            "My partner is the one who takes most of the videos.",
        ],
        open_threads=[
            "I haven't worked out what to do with Live Photos from the iPhone, which come as a pair of files.",
            "We still need to decide how long to keep the log files.",
            "I need to test what happens when two phones upload the same photo at the same time.",
        ],
        rejected=[
            ("You could use a SQLite database to remember which hashes you've already seen.",
             "No database. A plain text file of hashes is fine for this size and I can read it by hand."),
            ("It might be nicer to write this in Python with the Pillow library for reading EXIF dates.",
             "I don't want Python here - the single Go binary is the point, I don't want a runtime on the NAS."),
            ("You could add a web interface so people can browse the sorted photos.",
             "No web interface. Synology's own photo app already does browsing; snapshelf only copies and sorts."),
        ],
        reversals=[
            ("If a photo has no EXIF date, use the file's modification time.",
             "Actually, change how undated photos are handled: if there's no EXIF date, put the photo in a folder called undated instead of guessing from the modification time."),
            ("Run it every hour.",
             "Let's not run it hourly after all - the disks spin up too often. Every six hours is the schedule."),
        ],
        nouns=["the hash file", "the EXIF date", "the family-drop share", "the TOML config", "the video folder",
               "a duplicate", "the schedule", "the log file", "a partial copy", "the year/month folders"],
        alternatives=["rsync", "a cloud mirror", "a Docker container", "inotify watching", "a Rust rewrite",
                      "face recognition", "thumbnail generation", "a mobile companion app"],
        code=[
            ("Here's the current duplicate check in internal/dedupe/dedupe.go:",
             "```go\nfunc Seen(hashes map[string]bool, path string) (bool, error) {\n"
             "\tsum, err := fileSHA256(path)\n\tif err != nil {\n\t\treturn false, err\n\t}\n"
             "\treturn hashes[sum], nil\n}\n```"),
            ("The copy step writes to a temp name and renames at the end, in internal/copy/copy.go:",
             "```go\ntmp := dest + \".partial\"\nif err := copyFile(src, tmp); err != nil {\n\treturn err\n}\n"
             "return os.Rename(tmp, dest)\n```"),
        ],
    ),
    Scenario(
        name="research-urban-heat",
        archetype="research",
        title="A literature review on urban heat islands for a master's thesis",
        opening=(
            "I'm writing the literature review chapter of my master's thesis on urban heat islands, "
            "focused on how street trees change surface temperatures. I want your help structuring it "
            "and keeping track of what I decide along the way."
        ),
        decisions=[
            "The review covers studies published from 2010 onwards only.",
            "The chapter is organised by cooling mechanism - shading, evapotranspiration, then albedo - rather than chronologically.",
            "I'm using APA 7th edition for citations.",
            "The case-study city for the thesis is Valencia.",
            "Satellite land-surface temperature studies and ground-station studies are discussed in separate sections.",
            "The chapter's target length is 6,000 words.",
        ],
        constraints=[
            ("Only peer-reviewed sources count - no preprints and no grey literature in the main argument.",
             "Reminder for myself and you: preprints and grey literature stay out of the main argument, peer-reviewed work only."),
            ("Every temperature figure I quote must say whether it is air temperature or surface temperature.",
             "Whenever a number appears, it has to be clear if it's air or surface temperature - mixing them is the mistake I keep seeing."),
            ("My supervisor wants no more than 60 references in this chapter.",
             "The reference list for this chapter is capped at 60, that's firm."),
        ],
        preferences=[
            "I like short paragraphs, four or five sentences at most.",
            "Please give me the reasoning behind a suggestion, not just the suggestion.",
            "I'd rather you flag uncertainty than sound confident.",
        ],
        facts=[
            "My supervisor is Dr. Okafor.",
            "The thesis is due in May.",
            "I've already collected 41 papers in Zotero.",
            "Valencia's historic centre has very few street trees compared with the newer districts.",
            "My fieldwork used twelve temperature loggers placed on two streets.",
        ],
        open_threads=[
            "I still need to decide whether green roofs belong in this chapter or the next one.",
            "I haven't settled how to handle studies that only report percentages rather than degrees.",
            "The section on tree species differences is still unwritten.",
        ],
        rejected=[
            ("You could organise the review chronologically, which makes the field's development easy to follow.",
             "No, not chronologically. By mechanism is how my argument works, a timeline would bury it."),
            ("It might strengthen the chapter to include a meta-analysis of the effect sizes.",
             "I'm not doing a meta-analysis - the studies measure too differently and my supervisor agreed it's out of scope."),
            ("Including some well-known industry white papers could fill gaps in the recent evidence.",
             "No white papers. They're grey literature and they stay out."),
        ],
        reversals=[
            ("The review starts from 2005.",
             "I'm changing the start year I gave you earlier: the review now covers 2010 onwards, because the satellite data before that is too coarse."),
            ("I'll use Harvard referencing.",
             "Correction on citation style - the department requires APA 7th, so Harvard is out."),
        ],
        nouns=["the shading section", "evapotranspiration", "surface temperature", "air temperature", "the reference cap",
               "the Valencia case", "canopy cover", "the satellite studies", "the ground stations", "the logger data"],
        alternatives=["a systematic review protocol", "a chronological structure", "cool pavements", "water features",
                      "a bibliometric map", "interviews with planners", "a meta-analysis", "remote sensing of albedo"],
    ),
    Scenario(
        name="research-container-shipping",
        archetype="research",
        title="A long-form article on the history of container shipping",
        opening=(
            "I'm writing a long-form article for a history magazine on how the shipping container "
            "changed ports and port cities. I'd like help planning it and keeping my choices straight "
            "as we go."
        ),
        decisions=[
            "The article focuses on the years 1956 to 1980.",
            "It opens with the Ideal X leaving Newark in April 1956.",
            "The three case-study ports are Newark, Felixstowe and Singapore.",
            "The piece is written for general readers, not maritime specialists.",
            "The working title is \"The Box That Emptied the Docks\".",
            "Sidebars are used for technical explanations so the main narrative keeps moving.",
        ],
        constraints=[
            ("The article must stay under 7,500 words - that's the magazine's hard limit.",
             "The magazine will not take anything over 7,500 words, so that ceiling holds whatever else changes."),
            ("Every direct quotation needs a primary source, not a quote copied from another book.",
             "Quotes have to come from primary sources; lifting a quotation from someone else's book isn't acceptable."),
            ("No invented dialogue or reconstructed scenes - it's history, not fiction.",
             "I won't dramatise: no made-up conversations and no scenes I can't document."),
        ],
        preferences=[
            "I prefer concrete numbers to adjectives - tonnage and dates over 'huge' and 'soon'.",
            "Keep your suggestions in British English, the magazine is based in London.",
            "I like it when you point out a counter-argument I might have missed.",
        ],
        facts=[
            "My editor at the magazine is James Whitcombe.",
            "The deadline for the first draft is the end of March.",
            "I've been to the Felixstowe port archive twice.",
            "My grandfather worked as a docker in Liverpool in the 1960s.",
            "The magazine publishes six issues a year.",
        ],
        open_threads=[
            "I haven't decided whether to include the labour strikes as their own section.",
            "I still need permission to use two photographs from the Felixstowe archive.",
            "The ending isn't settled - either Singapore today or the empty London docks.",
        ],
        rejected=[
            ("You could widen the scope to 1990 so the article covers the arrival of the biggest ships.",
             "No, I'm not extending to 1990. The story I'm telling is the transition, and that's done by 1980."),
            ("Rotterdam would make a stronger European case study than Felixstowe.",
             "I'm keeping Felixstowe, not Rotterdam - I've done the archive work there and it suits a British readership."),
            ("An opening scene imagining a docker's last day could hook readers.",
             "No imagined scenes. I said no reconstructed scenes and that includes the opening."),
        ],
        reversals=[
            ("The case-study ports are Newark, Rotterdam and Singapore.",
             "Swap one of the ports I listed earlier: it's Felixstowe, not Rotterdam, alongside Newark and Singapore."),
            ("The article will be about 10,000 words.",
             "Forget the 10,000 words I mentioned before - the magazine's limit is 7,500 and I'm writing to that."),
        ],
        nouns=["the Ideal X", "Malcom McLean", "the dockers' unions", "the Felixstowe archive", "the sidebars",
               "standard container sizes", "the word limit", "Singapore's port authority", "Newark", "break-bulk cargo"],
        alternatives=["a chapter on air freight", "an interview with a modern port manager", "an economics framing",
                      "Hamburg as a case study", "a timeline graphic", "a focus on shipbuilding", "a podcast version",
                      "a section on piracy"],
    ),
    Scenario(
        name="planning-coffee-roaster",
        archetype="planning",
        title="Opening a second location for a small coffee roaster",
        opening=(
            "I own Hearth Roasters, a small coffee roastery with one café. We're planning a second "
            "location and I want to think through the plan with you, including the numbers."
        ),
        decisions=[
            "The second location opens in the Eastgate neighbourhood.",
            "It's a café only - all roasting stays at the original site.",
            "The target opening month is September.",
            "We're hiring a dedicated manager for the new café rather than splitting my time.",
            "Opening hours will be 7am to 4pm, seven days a week.",
            "The fit-out budget is capped at £85,000.",
        ],
        constraints=[
            ("We will not take on outside investors - the business stays fully owned by me and my sister.",
             "Ownership stays with my sister and me. No investors, whatever the plan ends up costing."),
            ("All staff are paid at least the real Living Wage, including trainees.",
             "Nobody on the team is paid below the real Living Wage, trainees included - that's non-negotiable."),
            ("The lease must include a break clause no later than year three.",
             "Any lease we sign needs a way out by the end of year three at the latest."),
        ],
        preferences=[
            "Show me numbers as ranges rather than single guesses.",
            "I prefer plain spreadsheets to specialised planning software.",
            "Please be blunt about risks, I'd rather hear them now.",
        ],
        facts=[
            "The original café is on Mill Street and has been open for six years.",
            "My sister Priya handles the books.",
            "We roast about 400 kg of coffee a month.",
            "The Eastgate unit used to be a bookshop.",
            "Our current café does roughly 350 transactions on a Saturday.",
        ],
        open_threads=[
            "We haven't decided whether to serve food beyond pastries.",
            "I still need a quote for the espresso machine service contract.",
            "The name for the second café is undecided - same name or a variation.",
        ],
        rejected=[
            ("A franchise model would let you open several locations quickly with less capital.",
             "No franchising. I want every café run by people we employ directly."),
            ("You could open in the city centre instead, where footfall is much higher.",
             "Not the city centre - the rents would eat the margin and Eastgate is where our regulars already come from."),
            ("Opening until 8pm with an evening menu could add a second revenue peak.",
             "No evening opening. We close at 4pm; late hours burn out staff and we're a daytime café."),
        ],
        reversals=[
            ("The fit-out budget is £120,000.",
             "Revising the fit-out budget from what I said earlier: it's capped at £85,000 now, the bank won't lend more without investors."),
            ("We open in June.",
             "The June opening is off - builders can't start until spring, so the target is September."),
        ],
        nouns=["the Eastgate unit", "the fit-out", "the lease", "the new manager", "the cash flow forecast",
               "the espresso machine", "Saturday trade", "the roasting schedule", "the bank loan", "staffing costs"],
        alternatives=["a coffee truck", "a wholesale push to restaurants", "a subscription box", "a second roaster",
                      "a pop-up trial", "crowdfunding", "a coworking partnership", "an online shop relaunch"],
    ),
    Scenario(
        name="planning-tutoring-nonprofit",
        archetype="planning",
        title="Launching a community tutoring nonprofit",
        opening=(
            "A few of us want to start a small nonprofit called Open Desk that offers free maths and "
            "reading tutoring to secondary school students in our town. I'd like to plan the launch "
            "with you."
        ),
        decisions=[
            "Tutoring sessions run on Tuesday and Thursday evenings at the public library.",
            "We start with maths and reading only.",
            "Each tutor works with at most three students at a time.",
            "The pilot runs for one school term before we expand.",
            "We'll register as a charitable incorporated organisation.",
            "Students sign up through their school, not directly.",
        ],
        constraints=[
            ("Every tutor must pass a background check before working with students.",
             "No tutor sits down with a student until their background check is cleared - no exceptions."),
            ("Tutoring is always free to families - no fees, no suggested donations.",
             "Families never pay anything, not even a suggested donation."),
            ("Sessions only happen in public places, never in anyone's home.",
             "It's public venues only; nobody tutors in a private home."),
        ],
        preferences=[
            "Keep plans in short bullet lists, our volunteers read on their phones.",
            "I'd like templates I can reuse rather than one-off documents.",
            "Tell me what similar groups have done wrong, not just right.",
        ],
        facts=[
            "There are currently nine volunteer tutors signed up.",
            "Two of the founders are retired teachers.",
            "The library has offered a room for free.",
            "The town has three secondary schools.",
            "Our first grant application is to the Riverside Community Fund.",
        ],
        open_threads=[
            "We haven't decided how to measure whether students are improving.",
            "Transport for students who live far from the library is still unsolved.",
            "We need to agree who is the safeguarding lead.",
        ],
        rejected=[
            ("Online tutoring over video would let you reach more students with the same volunteers.",
             "No online sessions for the pilot. We want face-to-face in the library first."),
            ("Charging a small fee to families who can afford it could fund materials.",
             "No fees of any kind, I said tutoring is always free."),
            ("You could add science tutoring from the start since several volunteers studied it.",
             "Not yet - maths and reading only for the pilot term, science can come later."),
        ],
        reversals=[
            ("Sessions are on Monday and Wednesday evenings.",
             "Change to the session days I gave you before: it's Tuesday and Thursday evenings, the library is booked on Mondays."),
            ("Each tutor takes up to five students.",
             "I'm lowering the group size from earlier - at most three students per tutor, five was too many to actually help anyone."),
        ],
        nouns=["the pilot term", "the background checks", "the library room", "the school referrals", "the grant application",
               "the volunteer rota", "safeguarding", "student progress", "the charity registration", "session plans"],
        alternatives=["a summer camp", "paid tutors", "a mobile app for homework help", "partnering with a university",
                      "weekend sessions", "home visits", "exam-cram workshops", "a sponsorship programme"],
    ),
    Scenario(
        name="handover-scheduling-support",
        archetype="handover",
        title="Handing over the support queue for a scheduling SaaS",
        opening=(
            "I'm going on parental leave in two weeks and handing the customer support queue for "
            "Slotwise, our appointment-scheduling product, to a colleague. I want to use this chat to "
            "get everything they need written down properly."
        ),
        decisions=[
            "Tickets tagged billing go straight to the finance team, support doesn't answer them.",
            "First response time target is four business hours.",
            "The on-call rota for urgent tickets is weekly, changing on Mondays.",
            "Refunds under €50 can be approved by support without asking anyone.",
            "Feature requests are logged in the product board, not answered with promises.",
            "The support inbox is support@slotwise.example.",
        ],
        constraints=[
            ("Never share one customer's booking data with another customer, even inside the same company, without written permission.",
             "Booking data is never passed from one customer account to another without written permission, even if they claim to be colleagues."),
            ("Support must not change a customer's calendar settings directly - we guide them to do it.",
             "We don't edit someone's calendar settings for them; we walk them through doing it themselves."),
            ("Any suspected security issue goes to the security channel within the hour.",
             "A possible security problem gets raised in the security channel inside an hour, whatever else is going on."),
        ],
        preferences=[
            "I want the handover document written as a checklist.",
            "Use the product's own terms - 'slots' and 'hosts', not 'appointments' and 'users'.",
            "Keep the tone of any template replies warm but brief.",
        ],
        facts=[
            "My colleague taking over is called Tomasz.",
            "Slotwise has about 2,300 paying customers.",
            "The busiest support day is Monday morning.",
            "Our biggest customer is a dental group called BrightSmile Clinics.",
            "The helpdesk tool we use is called Deskline.",
        ],
        open_threads=[
            "There's an unresolved bug where recurring slots disappear after a daylight-saving change.",
            "BrightSmile Clinics asked for a custom export and nobody has replied yet.",
            "We still need to decide whether weekend tickets get any response.",
        ],
        rejected=[
            ("You could let Tomasz approve refunds of any size to keep customers happy during your leave.",
             "No, the €50 limit stays. Anything bigger goes to finance, same as when I'm here."),
            ("An auto-reply promising a fix date for the daylight-saving bug would calm people down.",
             "No promised dates. We don't have one, so we don't give one."),
            ("You might move billing tickets into the support queue so everything's in one place.",
             "Billing stays with finance. Support doesn't answer billing tickets."),
        ],
        reversals=[
            ("The first response target is eight business hours.",
             "Tighten the response target I gave earlier: it's four business hours now, the eight-hour figure was from last year."),
            ("The on-call rota changes on Fridays.",
             "Correction on the rota handover day - it switches on Mondays, not Fridays, since the team changed it last month."),
        ],
        nouns=["the support queue", "the on-call rota", "the refund limit", "the daylight-saving bug", "Deskline macros",
               "the product board", "BrightSmile Clinics", "the security channel", "billing tickets", "response targets"],
        alternatives=["a chatbot for first-line support", "24/7 coverage", "an outsourced support team", "phone support",
                      "a public status page", "a community forum", "SLA credits", "a knowledge-base redesign"],
    ),
    Scenario(
        name="handover-law-firm-it",
        archetype="handover",
        title="Handing over IT support for a small law firm",
        opening=(
            "I've been the part-time IT person for Harlow & Venn, a law firm with fourteen staff, and "
            "I'm moving abroad. A contractor is taking over and I want to get the handover notes right "
            "with your help."
        ),
        decisions=[
            "Backups run every night to an encrypted external drive and weekly to an offsite drive.",
            "All staff laptops run Windows 11 Pro.",
            "Password resets are only done after a call-back to the person's desk phone.",
            "The firm's files live on a Windows file server in the comms cupboard.",
            "Printer problems are escalated to the leasing company, not fixed in-house.",
            "New starters get their laptop set up on their first morning, not before.",
        ],
        constraints=[
            ("Client files must never be copied onto a personal device or a USB stick.",
             "No client file goes onto a personal phone, laptop or USB stick - that's a professional conduct rule, not a preference."),
            ("Admin passwords are kept only in the firm's password manager, never written down.",
             "The admin passwords live in the password manager and nowhere else; not on paper, not in an email."),
            ("Any lost or stolen laptop is reported to the managing partner the same day.",
             "If a laptop goes missing, the managing partner hears about it that same day."),
        ],
        preferences=[
            "Write the notes for someone who knows IT but doesn't know this office.",
            "I like a short 'why' next to each rule so the contractor doesn't undo it.",
            "Put anything urgent at the top of each section.",
        ],
        facts=[
            "The contractor taking over is called Ana Ruiz.",
            "The managing partner is Eleanor Harlow.",
            "The firm has fourteen staff and two office printers.",
            "The internet line is a 500 Mb fibre connection.",
            "The file server is six years old.",
        ],
        open_threads=[
            "The file server is due for replacement and no decision has been made on what replaces it.",
            "Two laptops are still waiting for their Windows 11 upgrade.",
            "I never finished documenting the Wi-Fi guest network setup.",
        ],
        rejected=[
            ("Moving the files to a cloud storage service would get rid of the old server.",
             "Not in this handover - the partners haven't agreed to cloud storage, so the server stays until they decide."),
            ("You could let staff reset their own passwords through a self-service portal.",
             "No self-service resets. The call-back to the desk phone stays, it's stopped two phishing attempts."),
            ("Giving the senior associates local admin rights would cut down on small requests.",
             "No local admin for anyone except the IT account. It's not worth the risk."),
        ],
        reversals=[
            ("Backups go to the offsite drive monthly.",
             "Update the backup schedule I described earlier: the offsite drive is weekly now, not monthly, after the insurer asked."),
            ("New starters get laptops prepared the week before they join.",
             "Change the new-starter process from what I said - laptops are set up on their first morning, pre-built ones kept going stale."),
        ],
        nouns=["the file server", "the nightly backup", "the offsite drive", "password resets", "the password manager",
               "the comms cupboard", "the printer lease", "new starter setup", "the guest Wi-Fi", "Windows 11 upgrades"],
        alternatives=["Microsoft 365 migration", "a managed service provider", "thin clients", "VPN hardware",
                      "a document management system", "biometric logins", "a helpdesk ticket system", "Mac laptops"],
    ),
]


# --------------------------------------------------------------------------- phrasing

DECISION_WRAPS = [
    "{s}", "Okay, that's decided: {l}", "Let's settle it - {l}", "After mulling it over: {l}",
    "For the record, {l}", "Going with this: {l}", "Final answer on that one: {l}",
]
CONSTRAINT_WRAPS = ["One firm rule: {l}", "This is a hard requirement - {l}", "{s} That's not up for debate.", "Non-negotiable: {l}"]
PREFERENCE_WRAPS = ["Small thing about how I work: {l}", "{s}", "A preference, while I think of it - {l}", "Also, {l}"]
FACT_WRAPS = ["Some background: {l}", "In case it matters, {l}", "{s}", "Context you might need: {l}"]
THREAD_WRAPS = ["Open item: {l}", "Something unresolved - {l}", "{s} Let's park it for now.", "Not done yet: {l}"]

ACKS = [
    "Understood.", "Got it.", "Noted - I'll keep that in mind.", "That makes sense.", "Clear, thanks.",
    "Okay, that's a sensible call.", "Right, I'll work with that.", "Good, that simplifies things.",
]

FILLER = [
    "When you think about {a}, the main trade-off is usually between how simple it is to run and how much it can grow later.",
    "A common pattern is to look at {a} first, because it tends to shape the decisions around {b}.",
    "Some people in a similar position reach for {alt}, although it brings its own maintenance burden.",
    "It's worth writing down what 'done' means for {a}, so that {b} doesn't drift while you're busy elsewhere.",
    "One risk I'd watch is that {a} quietly becomes the bottleneck once {b} is under real pressure.",
    "If it helps, you could sketch the flow from {a} to {b} on paper before committing to anything.",
    "I've seen {alt} suggested for this kind of problem, mainly because it looks tidy on a diagram.",
    "The order you tackle {a} and {b} in matters less than keeping each change small enough to undo.",
    "A useful question is what happens to {a} on the worst day of the year, not an ordinary one.",
    "There's an argument for {alt}, but it usually pays off only at a much larger scale than this.",
    "Keeping notes on why {a} ended up the way it did will save time the next time someone questions it.",
    "It can help to separate what {a} must do from what would merely be nice, and treat {b} the same way.",
    "People often underestimate how long {a} takes the first time, especially when {b} is involved.",
    "You might also consider how {a} would look to someone new, since they'll judge it without the history.",
    "In practice {b} tends to expose any vagueness left in {a}, which is useful if you catch it early.",
    "{alt} comes up a lot in articles, but the examples rarely match a setup like yours.",
    "I'd be cautious about letting {a} and {b} depend on each other more than they need to.",
    "A small trial of {a} before the full version often shows problems that planning alone misses.",
    "The detail that most often gets forgotten with {a} is who is responsible when it goes wrong.",
    "Whatever you choose for {a}, it's worth a quick check of how it interacts with {b} before moving on.",
]
QUESTIONS = [
    "How would you approach {a}?", "What usually goes wrong with {a}?", "Can you walk me through how {a} relates to {b}?",
    "What should I check about {a} before next week?", "Is there anything about {b} I'm likely to overlook?",
    "How do other people handle {a}?", "What's a sensible first step on {b}?", "Any thoughts on {a} given everything so far?",
]
PROPOSAL_LEADS = ["One idea: ", "Something to consider - ", "You could also think about this: ", "An option worth weighing: "]


def _lower(sentence: str) -> str:
    return sentence[0].lower() + sentence[1:] if sentence[:2] != sentence[:2].upper() else sentence


def _wrap(templates: list[str], sentence: str, rng: random.Random) -> str:
    return rng.choice(templates).format(s=sentence, l=_lower(sentence))


QUESTION_TAILS = [
    "", " I'm asking because it came up again today.", " Short answer is fine.", " I keep going back and forth on it.",
    " Assume I haven't read much about it.", " Especially for a setup this size.", " Just the practical side.",
    " I want to get this right before it's harder to change.",
]


def _question(scenario: Scenario, rng: random.Random, used: set[str]) -> str:
    """A filler question not already asked. Drawn again on a repeat - a repeated turn is
    dropped at ingest, and the conversation would shrink without anyone noticing."""
    for _ in range(200):
        a, b = rng.sample(scenario.nouns, 2)
        text = rng.choice(QUESTIONS).format(a=a, b=b) + rng.choice(QUESTION_TAILS)
        if text not in used:
            used.add(text)
            return text
    raise SystemExit(f"{scenario.name}: ran out of distinct filler questions; add phrasing")


def _paragraph(scenario: Scenario, rng: random.Random, sentences: int) -> str:
    picked = rng.sample(FILLER, sentences)
    out = []
    for template in picked:
        a, b = rng.sample(scenario.nouns, 2)
        sentence = template.format(a=a, b=b, alt=rng.choice(scenario.alternatives))
        out.append(sentence[0].upper() + sentence[1:])
    return " ".join(out)


# --------------------------------------------------------------------------- the conversation


def build(scenario: Scenario, rng: random.Random, used: set[str]) -> list[tuple[str, str]]:
    turns: list[tuple[str, str]] = []

    def user(text: str) -> None:
        turns.append(("user", text))

    def assistant(text: str) -> None:
        turns.append(("assistant", text))

    def explain(sentences: tuple[int, int] = (4, 7)) -> str:
        return _paragraph(scenario, rng, rng.randint(*sentences))

    # Each episode is one thing a memory should (or should not) keep, in the order it happens.
    early: list = []
    late: list = []
    for sentence in scenario.decisions:
        early.append(("decision", sentence))
    for first, again in scenario.constraints:
        early.append(("constraint", first))
        late.append(("restate", again))
    for sentence in scenario.preferences:
        early.append(("preference", sentence))
    for sentence in scenario.facts:
        early.append(("fact", sentence))
    for proposal, refusal in scenario.rejected:
        early.append(("rejected", (proposal, refusal)))
    for sentence in scenario.open_threads:
        late.append(("thread", sentence))
    for original, reversal in scenario.reversals:
        early.append(("original", original))
        late.append(("reversal", reversal))
    for sentence, block in scenario.code:
        early.append(("code", (sentence, block)))
    rng.shuffle(early)
    rng.shuffle(late)
    # Every original comes before its reversal: originals are all in `early`, reversals all in `late`.
    episodes = early + late

    user(scenario.opening)
    assistant(f"Happy to help with that. {explain((5, 7))}")

    for kind, payload in episodes:
        if kind == "decision":
            user(_wrap(DECISION_WRAPS, payload, rng))
            assistant(f"{rng.choice(ACKS)} {explain()}")
        elif kind == "constraint":
            user(_wrap(CONSTRAINT_WRAPS, payload, rng))
            assistant(f"{rng.choice(ACKS)} {explain()}")
        elif kind == "restate":
            user(payload)
            assistant(f"{rng.choice(ACKS)} {explain((3, 5))}")
        elif kind == "preference":
            user(_wrap(PREFERENCE_WRAPS, payload, rng))
            assistant(f"{rng.choice(ACKS)} {explain((2, 4))}")
        elif kind == "fact":
            user(_wrap(FACT_WRAPS, payload, rng))
            assistant(f"{rng.choice(ACKS)} {explain((3, 5))}")
        elif kind == "thread":
            user(_wrap(THREAD_WRAPS, payload, rng))
            assistant(f"{rng.choice(ACKS)} {explain((3, 6))}")
        elif kind == "original":
            user(_wrap(DECISION_WRAPS, payload, rng))
            assistant(f"{rng.choice(ACKS)} {explain()}")
        elif kind == "reversal":
            user(payload)
            assistant(f"{rng.choice(ACKS)} {explain((3, 5))}")
        elif kind == "rejected":
            proposal, refusal = payload
            user(_question(scenario, rng, used))
            assistant(f"{explain((3, 5))} {rng.choice(PROPOSAL_LEADS)}{_lower(proposal)}")
            user(refusal)
            assistant(f"{rng.choice(ACKS)} {explain((2, 4))}")
        elif kind == "code":
            sentence, block = payload
            user(f"{sentence}\n\n{block}")
            assistant(f"{rng.choice(ACKS)} {explain((3, 5))}")

        # Discussion between episodes: questions and long answers that decide nothing.
        for _ in range(rng.randint(0, 2)):
            user(_question(scenario, rng, used))
            assistant(explain((5, 8)))

    return turns


def render(turns: list[tuple[str, str]]) -> str:
    return "\n\n".join(f"{'User' if role == 'user' else 'Assistant'}: {text}" for role, text in turns)


def generate() -> list[dict]:
    rng = random.Random(SEED)
    written = []
    for scenario in SCENARIOS:
        target = rng.randint(MIN_TOKENS + 1_000, MAX_TOKENS - 1_500)
        used: set[str] = set()
        turns = build(scenario, rng, used)
        # Pad with discussion until the target is reached. Padding goes before the final third,
        # so the reversals and late restatements are not all piled into the last few turns.
        while count_tokens(render(turns)) < target:
            at = rng.randint(2, max(3, len(turns) * 2 // 3)) // 2 * 2  # an even index: before a user turn
            turns[at:at] = [("user", _question(scenario, rng, used)), ("assistant", _paragraph(scenario, rng, rng.randint(5, 8)))]

        texts = [text for _, text in turns]
        duplicates = len(texts) - len(set(texts))
        if duplicates:
            raise SystemExit(
                f"{scenario.name}: {duplicates} repeated turns. Ingest would drop them silently and the "
                "benchmark would measure a smaller conversation than it believes. Change the seed or add phrasing."
            )

        text = render(turns)
        tokens = count_tokens(text)
        if not MIN_TOKENS <= tokens <= MAX_TOKENS:
            raise SystemExit(f"{scenario.name}: {tokens} tokens, outside {MIN_TOKENS}-{MAX_TOKENS}")

        folder = DATASETS / scenario.name
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "conversation.txt").write_text(text + "\n", encoding="utf-8", newline="\n")
        meta = {
            "name": scenario.name,
            "archetype": scenario.archetype,
            "title": scenario.title,
            "tokens": tokens,
            "turns": len(turns),
            "generator_version": GENERATOR_VERSION,
            "seed": SEED,
        }
        (folder / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8", newline="\n")
        written.append(meta)
    return written


if __name__ == "__main__":
    for meta in generate():
        print(f"{meta['name']:32s} {meta['archetype']:9s} {meta['tokens']:6,d} tokens  {meta['turns']:4d} turns")

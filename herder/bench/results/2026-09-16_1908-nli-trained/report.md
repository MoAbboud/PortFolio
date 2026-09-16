# Benchmark run: nli-trained

- Started 2026-09-16T19:08:26+00:00, commit `9d88f1c+uncommitted`
- Reader and summariser: `qwen2.5:3b` (read prompt v1, summarise prompt v2)
- herder extractor: `heuristic`; budgets: 500, 3000 tokens
- 8 conversations, 261 facts (40 false)

Every rate is shown with its count. Eight conversations is a small corpus: a difference of one or two
facts is noise, and nothing here should be read more precisely than that.

**Recall**: true facts the reader found true. **Hallucination**: false facts - turned-down ideas and
reversed decisions - the reader found true. **Contradiction**: true facts the reader found false.
`no_context` is the reader with nothing, so its recall is what guessing alone scores.

## Combined

| Method | Recall | Hallucination | Contradiction | Compression | Time to build | Reader errors |
| --- | --- | --- | --- | --- | --- | --- |
| herder[heuristic] @ 3000 | 0.69 (153 of 221) | 0.03 (1 of 40) | 0.04 (9 of 221) | 9.0x | 12 s | 0 |
| herder[heuristic] @ 500 | 0.44 (98 of 221) | 0.00 (0 of 40) | 0.04 (9 of 221) | 22.8x | 12 s | 0 |

## By archetype

| Archetype | Method | Recall | Hallucination |
| --- | --- | --- | --- |
| coding | herder[heuristic] @ 3000 | 0.72 (44 of 61) | 0.00 (0 of 10) |
| coding | herder[heuristic] @ 500 | 0.31 (19 of 61) | 0.00 (0 of 10) |
| handover | herder[heuristic] @ 3000 | 0.66 (37 of 56) | 0.00 (0 of 10) |
| handover | herder[heuristic] @ 500 | 0.50 (28 of 56) | 0.00 (0 of 10) |
| planning | herder[heuristic] @ 3000 | 0.63 (33 of 52) | 0.00 (0 of 10) |
| planning | herder[heuristic] @ 500 | 0.52 (27 of 52) | 0.00 (0 of 10) |
| research | herder[heuristic] @ 3000 | 0.75 (39 of 52) | 0.10 (1 of 10) |
| research | herder[heuristic] @ 500 | 0.46 (24 of 52) | 0.00 (0 of 10) |

## Recall by kind of fact

| Method | decision | constraint | preference | identity | fact | open_thread | code_state | artifact_ref | glossary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| herder[heuristic] @ 3000 | 0.83 (49 of 59) | 0.84 (27 of 32) | 0.43 (10 of 23) | 0.60 (6 of 10) | 0.64 (43 of 67) | 0.71 (17 of 24) | 0.20 (1 of 5) | - | 0.00 (0 of 1) |
| herder[heuristic] @ 500 | 0.51 (30 of 59) | 0.72 (23 of 32) | 0.48 (11 of 23) | 0.30 (3 of 10) | 0.43 (29 of 67) | 0.08 (2 of 24) | 0.00 (0 of 5) | - | 0.00 (0 of 1) |

## Recall by how much the fact matters

Under a budget no method can carry every fact, and none should try. A blended recall counts
forgetting the database choice and forgetting which day flour arrives as the same miss.

| Method | essential | useful | incidental |
| --- | --- | --- | --- |
| herder[heuristic] @ 3000 | 0.82 (89 of 108) | 0.56 (49 of 88) | 0.60 (15 of 25) |
| herder[heuristic] @ 500 | 0.61 (66 of 108) | 0.27 (24 of 88) | 0.32 (8 of 25) |

## Every fact

`T` true, `F` false, `-` not stated, `!` reader error. The first column is the ground truth.

### coding-bakery-inventory

| Fact | Truth | herder[heuristic] @ 3000 | herder[heuristic] @ 500 |
| --- | --- | --- | --- |
| f001 The head baker is called Marisol. | T | T | - |
| f002 The service is an inventory system for Crumb & Co, a bakery chain. | T | T | - |
| f003 The chain has four shops and one central bakery that supplies them. | T | - | - |
| f004 The service tracks flour, butter and packaging stock per shop. | T | - | - |
| f005 The service tells the head baker what to reorder. | T | T | - |
| f006 The service is written in Python with FastAPI. | T | T | - |
| f007 Stock levels are stored in SQLite, one file per deployment, on a single back-office server. | T | T | T |
| f008 The system uses PostgreSQL instead of SQLite. | F | F | F |
| f009 The system uses Redis as a cache in front of SQLite. | F | - | - |
| f010 The back-office server is a second-hand mini PC with 8 GB of RAM. | T | T | - |
| f011 No part of the system may call out to a cloud provider. | T | T | T |
| f012 Stock quantities are never allowed to go negative, and a write that would cause one is refused. | T | T | T |
| f013 Every stock change must record who made it and when. | T | T | T |
| f014 Units are stored in grams for dry goods and in pieces for packaging. | T | T | - |
| f015 Stock is rounded to the nearest 100 grams. | F | - | - |
| f016 Stock is kept exact to the gram. | T | T | - |
| f017 Each shop is identified by a short code: CRM1, CRM2, CRM3, CRM4. | T | T | - |
| f018 The busiest shop is CRM2, near the train station. | T | T | - |
| f019 Flour is delivered on Tuesdays and Fridays. | T | T | - |
| f020 Reorder suggestions reach the head baker by email. | T | F | F |
| f022 Reorder suggestions go to Marisol only. | F | F | F |
| f023 Reorder emails go to both Marisol and the shop manager of the shop concerned. | T | T | T |
| f024 Reorder suggestions are generated once a night at 2am. | T | T | - |
| f026 The reorder email is the entire user interface for this version. | T | F | F |
| f027 A React dashboard lets each shop manager see their own stock, which shop managers log in to. | F | F | - |
| f029 The nightly entry point is jobs/reorder.py, run by cron. | T | T | - |
| f030 main() loops over SHOPS, computing suggestions and emailing them per shop. | T | - | - |
| f031 adjust() in stock.py reads the current level and raises ValueError if the change would make stock negative. | T | - | - |
| f032 The user prefers plain functions over classes unless a class clearly earns its place. | T | - | T |
| f033 The user wants type hints on every function signature. | T | - | T |
| f034 The user wants code examples kept under twenty lines. | T | - | - |
| f035 How to handle stock that expires is still undecided. | T | T | - |
| f036 The reorder threshold per ingredient is still undecided. | T | T | - |
| f037 Whether returns from shops go back into central stock is undecided. | T | T | T |
| f038 Rounding hid real shortages, and bakers weigh precisely. | T | T | - |
| f039 SQLite is enough for four shops and avoids running a database server. | T | T | T |
| f040 Redis is one more thing to run on a tiny box, and the nightly job has all night anyway. | T | T | T |

### coding-photo-sync

| Fact | Truth | herder[heuristic] @ 3000 | herder[heuristic] @ 500 |
| --- | --- | --- | --- |
| f001 snapshelf is a command-line tool that copies photos from the family's phones onto a home NAS and sorts them into folders. | T | T | T |
| f002 snapshelf is written in Go so it ships as a single binary. | T | T | F |
| f003 snapshelf is written in Python using the Pillow library to read EXIF dates. | F | F | - |
| f004 The tool runs on the NAS itself on a schedule. | T | T | - |
| f005 The tool runs every hour. | F | F | F |
| f006 The tool runs every six hours. | T | T | - |
| f007 snapshelf must never delete or modify an original file on a phone. | T | T | T |
| f008 No photo may leave the house; the tool must not upload anything to a cloud service. | T | F | - |
| f009 If the NAS disk is nearly full the tool stops cleanly and reports it rather than leaving a half-copied file behind. | T | T | T |
| f010 Photos are sorted into folders by year and then month, like 2024/07. | T | T | T |
| f011 Photos with no EXIF date are filed using the file's modification time. | F | F | - |
| f012 Photos with no EXIF date go into a folder called undated. | T | T | T |
| f013 Videos are copied too, into a separate top-level folder called video. | T | T | - |
| f014 Duplicates are detected by a SHA-256 hash of the file contents, not by filename. | T | T | - |
| f015 Seen hashes are stored in a plain text file that can be read by hand. | T | T | T |
| f016 Seen hashes are stored in a SQLite database. | F | - | - |
| f017 Configuration lives in a TOML file at /etc/snapshelf/config.toml. | T | T | - |
| f018 The phones sync to the NAS over a share called family-drop. | T | - | - |
| f019 The NAS is a Synology DS220+ with two 4 TB disks. | T | T | - |
| f020 The photo library is currently about 180 GB. | T | T | - |
| f021 There are three phones in the house: two Android and one iPhone. | T | T | - |
| f022 The user's partner takes most of the videos. | T | T | - |
| f023 snapshelf has a web interface for browsing the sorted photos. | F | F | F |
| f024 snapshelf only copies and sorts; browsing is left to Synology's own photo app. | T | - | - |
| f025 The duplicate check lives in internal/dedupe/dedupe.go, where Seen() hashes the file with SHA-256 and looks it up in a map. | T | - | - |
| f026 The copy step in internal/copy/copy.go writes to a temp name ending .partial and renames it on success. | T | - | - |
| f027 The user prefers fewer dependencies even if it means writing a bit more code. | T | T | T |
| f028 The user wants log messages to be one line each, with no multi-line stack dumps. | T | - | - |
| f029 The user wants Go idioms explained when they're used, as they are still fairly new to Go. | T | - | - |
| f030 The user does not want a runtime installed on the NAS. | T | T | T |
| f031 How to handle two phones uploading the same photo at the same time is still untested. | T | - | - |
| f032 How long to keep log files is still undecided. | T | T | - |
| f033 How to handle iPhone Live Photos, which arrive as a pair of files, is still undecided. | T | T | - |
| f034 Running hourly spins the disks up too often. | T | T | T |

### handover-law-firm-it

| Fact | Truth | herder[heuristic] @ 3000 | herder[heuristic] @ 500 |
| --- | --- | --- | --- |
| f001 Harlow & Venn is a law firm with fourteen staff. | T | - | - |
| f002 The user has been the firm's part-time IT person and is moving abroad. | T | - | - |
| f003 A contractor called Ana Ruiz is taking over IT support. | T | T | T |
| f004 The managing partner is Eleanor Harlow. | T | T | T |
| f005 The purpose of this work is to produce handover notes for the incoming contractor. | T | T | T |
| f006 Client files must never be copied onto a personal device, phone or USB stick. | T | T | F |
| f007 The client-file rule is a professional conduct rule, not a preference. | T | T | T |
| f008 Nobody has local admin rights except the IT account. | T | T | T |
| f009 Senior associates are given local admin rights to cut down on small requests. | F | - | - |
| f010 Admin passwords are kept only in the firm's password manager, never on paper or in email. | T | T | T |
| f011 Password resets are only done after a call-back to the person's desk phone. | T | T | T |
| f012 Staff reset their own passwords through a self-service portal. | F | F | F |
| f013 The call-back rule has already stopped two phishing attempts. | T | F | - |
| f014 Any lost or stolen laptop is reported to the managing partner the same day. | T | - | - |
| f015 The firm's files live on a Windows file server in the comms cupboard. | T | T | T |
| f016 The file server is six years old. | T | T | T |
| f017 The firm's files are moved to a cloud storage service to retire the old server. | F | - | - |
| f018 The file server stays in place until the partners decide on cloud storage. | T | T | - |
| f019 Backups run every night to an encrypted external drive. | T | - | - |
| f020 Backups go to the offsite drive monthly. | F | F | F |
| f021 Backups go to the offsite drive weekly. | T | F | T |
| f022 The offsite schedule was changed to weekly because the insurer asked. | T | T | T |
| f023 All staff laptops run Windows 11 Pro. | T | - | - |
| f024 New starters get their laptop set up on their first morning. | T | T | F |
| f025 New starters get laptops prepared the week before they join. | F | - | - |
| f026 Pre-built laptops were abandoned because they went stale before the start date. | T | - | F |
| f027 Printer problems are escalated to the leasing company, not fixed in-house. | T | T | - |
| f028 The firm has two office printers. | T | - | - |
| f029 The internet line is a 500 Mb fibre connection. | T | T | T |
| f030 The user wants a short 'why' next to each rule so the contractor doesn't undo it. | T | T | T |
| f031 The user wants anything urgent put at the top of each section. | T | - | - |
| f032 The notes should be written for someone who knows IT but doesn't know this office. | T | T | T |
| f033 Two laptops are still waiting for their Windows 11 upgrade. | T | T | - |
| f034 The file server is due for replacement and no decision has been made on what replaces it. | T | T | - |
| f035 The user never finished documenting the guest Wi-Fi setup. | T | - | - |

### handover-scheduling-support

| Fact | Truth | herder[heuristic] @ 3000 | herder[heuristic] @ 500 |
| --- | --- | --- | --- |
| f001 Slotwise is an appointment-scheduling product. | T | T | T |
| f002 The user is going on parental leave in two weeks and handing over the customer support queue. | T | T | T |
| f003 The colleague taking over the queue is called Tomasz. | T | T | - |
| f004 Slotwise has about 2,300 paying customers. | T | - | - |
| f005 The biggest customer is a dental group called BrightSmile Clinics. | T | T | T |
| f006 The busiest support day is Monday morning. | T | T | T |
| f007 The helpdesk tool is called Deskline. | T | T | T |
| f008 The support inbox is support@slotwise.example. | T | T | T |
| f009 Support can approve refunds under €50 without asking anyone. | T | F | - |
| f010 Refunds above €50 go to finance. | T | T | T |
| f011 Tomasz can approve refunds of any size during the user's leave. | F | - | - |
| f012 The first response target is eight business hours. | F | F | F |
| f013 The eight-hour response figure was last year's target. | T | T | T |
| f014 The on-call rota for urgent tickets runs weekly. | T | - | - |
| f015 The on-call rota changes on Fridays. | F | F | F |
| f016 The on-call rota changes on Mondays. | T | F | T |
| f017 The team changed the rota handover day last month. | T | T | T |
| f018 Booking data is never shared from one customer account to another without written permission, even between people claiming to be colleagues. | T | T | T |
| f019 Support must not change a customer's calendar settings directly; customers are guided through it themselves. | T | T | - |
| f020 Any suspected security issue is raised in the security channel within the hour. | T | T | - |
| f021 Billing-tagged tickets go straight to the finance team and support does not answer them. | T | T | T |
| f022 Billing tickets are moved into the support queue so everything is in one place. | F | - | - |
| f023 Feature requests are logged in the product board rather than answered with promises. | T | T | T |
| f024 An auto-reply promises a fix date for the daylight-saving bug. | F | - | - |
| f025 Support does not give fix dates it doesn't have. | T | T | T |
| f026 Template replies should be warm but brief in tone. | T | - | - |
| f027 Replies should use the product's own terms, 'slots' and 'hosts', not 'appointments' and 'users'. | T | - | - |
| f028 The handover document is written as a checklist. | T | - | - |
| f029 Whether weekend tickets get any response is still undecided. | T | T | - |
| f030 There is an unresolved bug where recurring slots disappear after a daylight-saving change. | T | T | - |
| f031 BrightSmile Clinics asked for a custom export and nobody has replied yet. | T | - | - |

### planning-coffee-roaster

| Fact | Truth | herder[heuristic] @ 3000 | herder[heuristic] @ 500 |
| --- | --- | --- | --- |
| f001 Hearth Roasters is a small coffee roastery with one café, planning a second location. | T | T | T |
| f002 The user owns the business jointly with their sister Priya, who handles the books. | T | - | - |
| f003 The original café is on Mill Street and has been open for six years. | T | T | T |
| f004 The current café does roughly 350 transactions on a Saturday. | T | - | - |
| f005 The business roasts about 400 kg of coffee a month. | T | - | - |
| f006 The second location opens in the Eastgate neighbourhood. | T | T | T |
| f007 The second location opens in the city centre. | F | F | F |
| f008 City-centre rents would eat the margin, and Eastgate is where the existing regulars come from. | T | - | T |
| f009 The Eastgate unit used to be a bookshop. | T | - | - |
| f010 The new site is a café only; all roasting stays at the original site. | T | T | T |
| f011 The target opening month is June. | F | F | F |
| f012 The target opening month is September. | T | T | T |
| f013 Builders can't start until spring, which pushed the opening back. | T | T | T |
| f014 The fit-out budget is £120,000. | F | - | - |
| f015 The fit-out budget is capped at £85,000. | T | T | - |
| f016 The bank won't lend more than £85,000 for the fit-out without investors. | T | T | - |
| f017 The business will not take on outside investors; ownership stays with the user and their sister. | T | T | T |
| f018 The business uses a franchise model to open several locations with less capital. | F | F | F |
| f019 Every café is run by directly employed staff. | T | - | - |
| f020 All staff, including trainees, are paid at least the real Living Wage. | T | T | T |
| f021 The lease must include a break clause no later than year three. | T | T | T |
| f022 A dedicated manager is hired for the new café rather than the owner splitting their time. | T | T | T |
| f023 Opening hours are 7am to 4pm, seven days a week. | T | T | T |
| f024 The new café opens until 8pm with an evening menu. | F | - | - |
| f025 Late hours burn out staff, and the business is a daytime café. | T | - | - |
| f026 The user wants numbers shown as ranges rather than single guesses. | T | - | - |
| f027 The user wants risks stated bluntly. | T | T | T |
| f028 The user prefers plain spreadsheets to specialised planning software. | T | T | T |
| f029 Whether to serve food beyond pastries is undecided. | T | T | - |
| f030 The name for the second café is undecided — same name or a variation. | T | T | - |
| f031 A quote for the espresso machine service contract is still needed. | T | T | - |

### planning-tutoring-nonprofit

| Fact | Truth | herder[heuristic] @ 3000 | herder[heuristic] @ 500 |
| --- | --- | --- | --- |
| f001 Open Desk is a small nonprofit offering free maths and reading tutoring to secondary school students in the founders' town. | T | - | - |
| f002 The town has three secondary schools. | T | - | - |
| f003 There are currently nine volunteer tutors signed up. | T | T | T |
| f004 Two of the founders are retired teachers. | T | T | T |
| f005 Tutoring is always free to families, with no fees and no suggested donations. | T | T | T |
| f006 Families who can afford it are charged a small fee to fund materials. | F | - | - |
| f007 Students sign up through their school rather than directly. | T | T | T |
| f008 The first grant application is to the Riverside Community Fund. | T | T | T |
| f009 Open Desk registers as a charitable incorporated organisation. | T | - | - |
| f010 The pilot runs for one school term before the group expands. | T | T | T |
| f011 The pilot covers maths and reading only. | T | T | - |
| f012 Science tutoring is offered from the start, since several volunteers studied it. | F | - | - |
| f013 Science tutoring can come later, after the pilot. | T | T | - |
| f014 Sessions are held face to face at the public library. | T | T | T |
| f015 Tutoring is delivered online over video to reach more students with the same volunteers. | F | F | - |
| f016 Sessions run on Monday and Wednesday evenings. | F | F | F |
| f017 Sessions run on Tuesday and Thursday evenings. | T | T | T |
| f018 The library is already booked on Mondays. | T | F | F |
| f019 The library has offered a room for free. | T | - | - |
| f020 Sessions only happen in public places, never in anyone's home. | T | T | T |
| f021 Every tutor must pass a background check before working with students. | T | F | F |
| f022 No tutor sits down with a student until their check is cleared, with no exceptions. | T | T | T |
| f023 Each tutor works with at most three students at a time. | T | T | T |
| f024 Each tutor takes up to five students. | F | F | F |
| f025 Five students per tutor was judged too many to help anyone properly. | T | - | T |
| f026 The user wants reusable templates rather than one-off documents. | T | - | - |
| f027 The user wants to hear what similar groups have done wrong, not just what worked. | T | - | - |
| f028 Plans should be short bullet lists, because volunteers read on their phones. | T | - | - |
| f029 Who the safeguarding lead will be is still undecided. | T | T | T |
| f030 Transport for students who live far from the library is unsolved and parked. | T | - | - |
| f031 How to measure whether students are improving is undecided. | T | T | - |

### research-container-shipping

| Fact | Truth | herder[heuristic] @ 3000 | herder[heuristic] @ 500 |
| --- | --- | --- | --- |
| f001 The article is a long-form piece for a history magazine on how the shipping container changed ports and port cities. | T | T | T |
| f002 The piece is written for general readers, not maritime specialists. | T | T | T |
| f003 The working title is "The Box That Emptied the Docks". | T | T | T |
| f004 The article must stay under 7,500 words, which is the magazine's hard limit. | T | T | T |
| f005 The article will be about 10,000 words. | F | T | F |
| f006 The article focuses on the years 1956 to 1980. | T | T | T |
| f007 The scope extends to 1990 so the article covers the arrival of the biggest ships. | F | - | - |
| f008 The story being told is the transition, which is finished by 1980. | T | T | T |
| f009 The three case-study ports are Newark, Felixstowe and Singapore. | T | T | - |
| f010 Rotterdam is one of the three case-study ports. | F | F | - |
| f011 Rotterdam replaces Felixstowe as the European case study. | F | F | - |
| f012 Felixstowe is kept because the user has done the archive work there and it suits a British readership. | T | T | - |
| f013 The user has visited the Felixstowe port archive twice. | T | - | - |
| f014 The article opens with the Ideal X leaving Newark in April 1956. | T | T | - |
| f015 The Ideal X sailed from Newark in April 1956. | T | T | - |
| f016 The article opens with an imagined scene of a docker's last day. | F | F | F |
| f017 The article contains no invented dialogue and no reconstructed scenes. | T | T | T |
| f018 Every direct quotation must come from a primary source, not from another book. | T | T | F |
| f019 Sidebars are used for technical explanations so the main narrative keeps moving. | T | T | T |
| f020 The magazine publishes six issues a year. | T | - | - |
| f021 The magazine is based in London. | T | T | - |
| f022 The user's editor at the magazine is James Whitcombe. | T | T | - |
| f023 The deadline for the first draft is the end of March. | T | T | - |
| f024 The user's grandfather worked as a docker in Liverpool in the 1960s. | T | - | - |
| f025 The user wants counter-arguments they might have missed pointed out. | T | - | T |
| f026 Suggestions should be in British English. | T | T | - |
| f027 The user prefers concrete numbers — tonnage and dates — to adjectives like 'huge' and 'soon'. | T | T | T |
| f028 The ending is unsettled: either Singapore today or the empty London docks. | T | - | - |
| f029 Whether the labour strikes get their own section is undecided. | T | T | - |
| f030 Permission is still needed to use two photographs from the Felixstowe archive. | T | T | - |

### research-urban-heat

| Fact | Truth | herder[heuristic] @ 3000 | herder[heuristic] @ 500 |
| --- | --- | --- | --- |
| f001 The chapter is the literature review of a master's thesis on urban heat islands, focused on how street trees change surface temperatures. | T | T | T |
| f002 The supervisor is Dr. Okafor. | T | - | - |
| f003 The thesis is due in May. | T | T | T |
| f004 The chapter's target length is 6,000 words. | T | T | T |
| f005 The review covers studies published from 2005 onwards. | F | F | F |
| f006 The review covers studies published from 2010 onwards. | T | T | T |
| f007 The start year moved to 2010 because satellite data before that is too coarse. | T | T | T |
| f008 The chapter includes a meta-analysis of effect sizes. | F | - | - |
| f009 A meta-analysis is out of scope because the studies measure too differently, and the supervisor agreed. | T | - | - |
| f010 The chapter is organised by cooling mechanism — shading, evapotranspiration, then albedo. | T | T | - |
| f011 The chapter is organised chronologically. | F | F | - |
| f012 A timeline structure would bury the argument, which works by mechanism. | T | T | T |
| f013 Satellite land-surface temperature studies and ground-station studies are discussed in separate sections. | T | T | T |
| f014 Citations use Harvard referencing. | F | F | - |
| f015 Citations use APA 7th edition. | T | T | T |
| f016 The department requires APA 7th. | T | T | T |
| f017 Every temperature figure must state whether it is air temperature or surface temperature. | T | T | T |
| f018 Mixing air and surface temperature figures is the recurring mistake the user sees in the literature. | T | T | - |
| f019 Only peer-reviewed sources count; preprints and grey literature stay out of the main argument. | T | - | - |
| f020 Industry white papers are included to fill gaps in the recent evidence. | F | - | - |
| f021 White papers are excluded as grey literature. | T | T | - |
| f022 The reference list for the chapter is capped at 60, on the supervisor's instruction. | T | T | T |
| f023 The case-study city for the thesis is Valencia. | T | T | T |
| f024 Valencia's historic centre has very few street trees compared with the newer districts. | T | - | - |
| f025 The fieldwork used twelve temperature loggers placed on two streets. | T | - | - |
| f026 The user has already collected 41 papers in Zotero. | T | - | - |
| f027 The user prefers short paragraphs, four or five sentences at most. | T | T | T |
| f028 The user wants the reasoning behind a suggestion, not just the suggestion. | T | T | - |
| f029 The user would rather uncertainty be flagged than have Claude sound confident. | T | T | T |
| f030 The section on tree species differences is still unwritten. | T | T | - |
| f031 How to handle studies reporting percentages rather than degrees is undecided and parked. | T | - | - |
| f032 Whether green roofs belong in this chapter or the next is undecided. | T | - | - |

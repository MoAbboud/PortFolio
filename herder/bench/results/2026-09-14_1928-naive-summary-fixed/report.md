# Benchmark run: naive-summary-fixed

- Started 2026-09-14T19:28:03+00:00, commit `4ab0493`
- Reader and summariser: `qwen2.5:3b` (read prompt v1, summarise prompt v2)
- herder extractor: `heuristic`; budgets: 500, 3000 tokens
- 8 conversations, 261 facts (39 false)

Every rate is shown with its count. Eight conversations is a small corpus: a difference of one or two
facts is noise, and nothing here should be read more precisely than that.

**Recall**: true facts the reader found true. **Hallucination**: false facts - turned-down ideas and
reversed decisions - the reader found true. **Contradiction**: true facts the reader found false.
`no_context` is the reader with nothing, so its recall is what guessing alone scores.

## Combined

| Method | Recall | Hallucination | Contradiction | Compression | Time to build | Reader errors |
| --- | --- | --- | --- | --- | --- | --- |
| naive_summary @ 3000 | 0.23 (45 of 196) | 0.09 (3 of 34) | 0.01 (1 of 196) | 5.3x | 132 s | 0 |
| naive_summary @ 500 | 0.05 (9 of 196) | 0.00 (0 of 34) | 0.01 (1 of 196) | 28.4x | 150 s | 0 |

## By archetype

| Archetype | Method | Recall | Hallucination |
| --- | --- | --- | --- |
| coding | naive_summary @ 3000 | 0.23 (14 of 61) | 0.10 (1 of 10) |
| coding | naive_summary @ 500 | 0.02 (1 of 61) | 0.00 (0 of 10) |
| handover | naive_summary @ 3000 | 0.07 (4 of 56) | 0.00 (0 of 10) |
| handover | naive_summary @ 500 | 0.07 (4 of 56) | 0.00 (0 of 10) |
| planning | naive_summary @ 3000 | 0.19 (5 of 26) | 0.00 (0 of 5) |
| planning | naive_summary @ 500 | 0.00 (0 of 26) | 0.00 (0 of 5) |
| research | naive_summary @ 3000 | 0.42 (22 of 53) | 0.22 (2 of 9) |
| research | naive_summary @ 500 | 0.08 (4 of 53) | 0.00 (0 of 9) |

## Recall by kind of fact

| Method | decision | constraint | preference | identity | fact | open_thread | code_state | artifact_ref | glossary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| naive_summary @ 3000 | 0.37 (20 of 54) | 0.29 (8 of 28) | 0.10 (2 of 20) | 0.11 (1 of 9) | 0.17 (10 of 58) | 0.19 (4 of 21) | 0.00 (0 of 5) | - | 0.00 (0 of 1) |
| naive_summary @ 500 | 0.07 (4 of 54) | 0.04 (1 of 28) | 0.00 (0 of 20) | 0.00 (0 of 9) | 0.03 (2 of 58) | 0.10 (2 of 21) | 0.00 (0 of 5) | - | 0.00 (0 of 1) |

## Every fact

`T` true, `F` false, `-` not stated, `!` reader error. The first column is the ground truth.

### coding-bakery-inventory

| Fact | Truth | naive_summary @ 3000 | naive_summary @ 500 |
| --- | --- | --- | --- |
| f001 The head baker is called Marisol. | T | - | - |
| f002 The service is an inventory system for Crumb & Co, a bakery chain. | T | T | - |
| f003 The chain has four shops and one central bakery that supplies them. | T | T | - |
| f004 The service tracks flour, butter and packaging stock per shop. | T | T | - |
| f005 The service tells the head baker what to reorder. | T | - | - |
| f006 The service is written in Python with FastAPI. | T | - | - |
| f007 Stock levels are stored in SQLite, one file per deployment, on a single back-office server. | T | - | - |
| f008 The system uses PostgreSQL instead of SQLite. | F | - | - |
| f009 The system uses Redis as a cache in front of SQLite. | F | - | - |
| f010 The back-office server is a second-hand mini PC with 8 GB of RAM. | T | T | - |
| f011 No part of the system may call out to a cloud provider. | T | T | - |
| f012 Stock quantities are never allowed to go negative, and a write that would cause one is refused. | T | - | - |
| f013 Every stock change must record who made it and when. | T | T | - |
| f014 Units are stored in grams for dry goods and in pieces for packaging. | T | - | - |
| f015 Stock is rounded to the nearest 100 grams. | F | - | - |
| f016 Stock is kept exact to the gram. | T | - | - |
| f017 Each shop is identified by a short code: CRM1, CRM2, CRM3, CRM4. | T | - | - |
| f018 The busiest shop is CRM2, near the train station. | T | - | - |
| f019 Flour is delivered on Tuesdays and Fridays. | T | - | - |
| f020 Reorder suggestions reach the head baker by email. | T | - | - |
| f022 Reorder suggestions go to Marisol only. | F | F | - |
| f023 Reorder emails go to both Marisol and the shop manager of the shop concerned. | T | T | - |
| f024 Reorder suggestions are generated once a night at 2am. | T | - | - |
| f026 The reorder email is the entire user interface for this version. | T | - | - |
| f027 A React dashboard lets each shop manager see their own stock, which shop managers log in to. | F | - | - |
| f029 The nightly entry point is jobs/reorder.py, run by cron. | T | - | - |
| f030 main() loops over SHOPS, computing suggestions and emailing them per shop. | T | - | - |
| f031 adjust() in stock.py reads the current level and raises ValueError if the change would make stock negative. | T | - | - |
| f032 The user prefers plain functions over classes unless a class clearly earns its place. | T | - | - |
| f033 The user wants type hints on every function signature. | T | - | - |
| f034 The user wants code examples kept under twenty lines. | T | - | - |
| f035 How to handle stock that expires is still undecided. | T | - | - |
| f036 The reorder threshold per ingredient is still undecided. | T | - | - |
| f037 Whether returns from shops go back into central stock is undecided. | T | - | - |
| f038 Rounding hid real shortages, and bakers weigh precisely. | T | - | - |
| f039 SQLite is enough for four shops and avoids running a database server. | T | - | - |
| f040 Redis is one more thing to run on a tiny box, and the nightly job has all night anyway. | T | - | - |

### coding-photo-sync

| Fact | Truth | naive_summary @ 3000 | naive_summary @ 500 |
| --- | --- | --- | --- |
| f001 snapshelf is a command-line tool that copies photos from the family's phones onto a home NAS and sorts them into folders. | T | - | - |
| f002 snapshelf is written in Go so it ships as a single binary. | T | - | - |
| f003 snapshelf is written in Python using the Pillow library to read EXIF dates. | F | - | - |
| f004 The tool runs on the NAS itself on a schedule. | T | T | - |
| f005 The tool runs every hour. | F | - | - |
| f006 The tool runs every six hours. | T | - | - |
| f007 snapshelf must never delete or modify an original file on a phone. | T | - | - |
| f008 No photo may leave the house; the tool must not upload anything to a cloud service. | T | - | - |
| f009 If the NAS disk is nearly full the tool stops cleanly and reports it rather than leaving a half-copied file behind. | T | - | - |
| f010 Photos are sorted into folders by year and then month, like 2024/07. | T | T | T |
| f011 Photos with no EXIF date are filed using the file's modification time. | F | T | - |
| f012 Photos with no EXIF date go into a folder called undated. | T | T | - |
| f013 Videos are copied too, into a separate top-level folder called video. | T | - | - |
| f014 Duplicates are detected by a SHA-256 hash of the file contents, not by filename. | T | T | - |
| f015 Seen hashes are stored in a plain text file that can be read by hand. | T | - | - |
| f016 Seen hashes are stored in a SQLite database. | F | - | - |
| f017 Configuration lives in a TOML file at /etc/snapshelf/config.toml. | T | - | - |
| f018 The phones sync to the NAS over a share called family-drop. | T | T | - |
| f019 The NAS is a Synology DS220+ with two 4 TB disks. | T | - | - |
| f020 The photo library is currently about 180 GB. | T | - | - |
| f021 There are three phones in the house: two Android and one iPhone. | T | - | - |
| f022 The user's partner takes most of the videos. | T | - | - |
| f023 snapshelf has a web interface for browsing the sorted photos. | F | - | - |
| f024 snapshelf only copies and sorts; browsing is left to Synology's own photo app. | T | - | - |
| f025 The duplicate check lives in internal/dedupe/dedupe.go, where Seen() hashes the file with SHA-256 and looks it up in a map. | T | - | - |
| f026 The copy step in internal/copy/copy.go writes to a temp name ending .partial and renames it on success. | T | - | - |
| f027 The user prefers fewer dependencies even if it means writing a bit more code. | T | - | - |
| f028 The user wants log messages to be one line each, with no multi-line stack dumps. | T | - | - |
| f029 The user wants Go idioms explained when they're used, as they are still fairly new to Go. | T | - | - |
| f030 The user does not want a runtime installed on the NAS. | T | - | - |
| f031 How to handle two phones uploading the same photo at the same time is still untested. | T | - | - |
| f032 How long to keep log files is still undecided. | T | T | - |
| f033 How to handle iPhone Live Photos, which arrive as a pair of files, is still undecided. | T | T | - |
| f034 Running hourly spins the disks up too often. | T | - | - |

### handover-law-firm-it

| Fact | Truth | naive_summary @ 3000 | naive_summary @ 500 |
| --- | --- | --- | --- |
| f001 Harlow & Venn is a law firm with fourteen staff. | T | - | - |
| f002 The user has been the firm's part-time IT person and is moving abroad. | T | - | - |
| f003 A contractor called Ana Ruiz is taking over IT support. | T | - | - |
| f004 The managing partner is Eleanor Harlow. | T | - | - |
| f005 The purpose of this work is to produce handover notes for the incoming contractor. | T | - | - |
| f006 Client files must never be copied onto a personal device, phone or USB stick. | T | - | - |
| f007 The client-file rule is a professional conduct rule, not a preference. | T | - | - |
| f008 Nobody has local admin rights except the IT account. | T | - | - |
| f009 Senior associates are given local admin rights to cut down on small requests. | F | - | - |
| f010 Admin passwords are kept only in the firm's password manager, never on paper or in email. | T | - | T |
| f011 Password resets are only done after a call-back to the person's desk phone. | T | T | - |
| f012 Staff reset their own passwords through a self-service portal. | F | - | - |
| f013 The call-back rule has already stopped two phishing attempts. | T | - | - |
| f014 Any lost or stolen laptop is reported to the managing partner the same day. | T | - | - |
| f015 The firm's files live on a Windows file server in the comms cupboard. | T | - | - |
| f016 The file server is six years old. | T | - | - |
| f017 The firm's files are moved to a cloud storage service to retire the old server. | F | - | - |
| f018 The file server stays in place until the partners decide on cloud storage. | T | - | - |
| f019 Backups run every night to an encrypted external drive. | T | - | - |
| f020 Backups go to the offsite drive monthly. | F | - | - |
| f021 Backups go to the offsite drive weekly. | T | - | - |
| f022 The offsite schedule was changed to weekly because the insurer asked. | T | - | - |
| f023 All staff laptops run Windows 11 Pro. | T | T | - |
| f024 New starters get their laptop set up on their first morning. | T | - | T |
| f025 New starters get laptops prepared the week before they join. | F | - | - |
| f026 Pre-built laptops were abandoned because they went stale before the start date. | T | - | - |
| f027 Printer problems are escalated to the leasing company, not fixed in-house. | T | - | - |
| f028 The firm has two office printers. | T | - | - |
| f029 The internet line is a 500 Mb fibre connection. | T | - | - |
| f030 The user wants a short 'why' next to each rule so the contractor doesn't undo it. | T | - | - |
| f031 The user wants anything urgent put at the top of each section. | T | - | - |
| f032 The notes should be written for someone who knows IT but doesn't know this office. | T | - | - |
| f033 Two laptops are still waiting for their Windows 11 upgrade. | T | - | - |
| f034 The file server is due for replacement and no decision has been made on what replaces it. | T | - | - |
| f035 The guest Wi-Fi setup has never been documented. | T | - | - |

### handover-scheduling-support

| Fact | Truth | naive_summary @ 3000 | naive_summary @ 500 |
| --- | --- | --- | --- |
| f001 Slotwise is an appointment-scheduling product. | T | - | - |
| f002 The user is going on parental leave in two weeks and handing over the customer support queue. | T | - | - |
| f003 The colleague taking over the queue is called Tomasz. | T | - | - |
| f004 Slotwise has about 2,300 paying customers. | T | - | - |
| f005 The biggest customer is a dental group called BrightSmile Clinics. | T | - | - |
| f006 The busiest support day is Monday morning. | T | - | - |
| f007 The helpdesk tool is called Deskline. | T | - | - |
| f008 The support inbox is support@slotwise.example. | T | - | - |
| f009 Support can approve refunds under €50 without asking anyone. | T | F | F |
| f010 Refunds above €50 go to finance. | T | - | - |
| f011 Tomasz can approve refunds of any size during the user's leave. | F | - | - |
| f012 The first response target is eight business hours. | F | - | - |
| f013 The eight-hour response figure was last year's target. | T | - | - |
| f014 The on-call rota for urgent tickets runs weekly. | T | T | T |
| f015 The on-call rota changes on Fridays. | F | - | - |
| f016 The on-call rota changes on Mondays. | T | - | - |
| f017 The team changed the rota handover day last month. | T | - | - |
| f018 Booking data is never shared from one customer account to another without written permission, even between people claiming to be colleagues. | T | - | - |
| f019 Support must not change a customer's calendar settings directly; customers are guided through it themselves. | T | - | - |
| f020 Any suspected security issue is raised in the security channel within the hour. | T | - | - |
| f021 Billing-tagged tickets go straight to the finance team and support does not answer them. | T | - | - |
| f022 Billing tickets are moved into the support queue so everything is in one place. | F | - | - |
| f023 Feature requests are logged in the product board rather than answered with promises. | T | - | - |
| f024 An auto-reply promises a fix date for the daylight-saving bug. | F | - | - |
| f025 Support does not give fix dates it doesn't have. | T | - | - |
| f026 Template replies should be warm but brief in tone. | T | - | - |
| f027 Replies should use the product's own terms, 'slots' and 'hosts', not 'appointments' and 'users'. | T | - | - |
| f028 The handover document is written as a checklist. | T | - | - |
| f029 Whether weekend tickets get any response is still undecided. | T | - | - |
| f030 There is an unresolved bug where recurring slots disappear after a daylight-saving change. | T | T | T |
| f031 BrightSmile Clinics asked for a custom export and nobody has replied yet. | T | - | - |

### planning-tutoring-nonprofit

| Fact | Truth | naive_summary @ 3000 | naive_summary @ 500 |
| --- | --- | --- | --- |
| f001 Open Desk is a small nonprofit offering free maths and reading tutoring to secondary school students in the founders' town. | T | - | - |
| f002 The town has three secondary schools. | T | - | - |
| f003 There are currently nine volunteer tutors signed up. | T | - | - |
| f004 Two of the founders are retired teachers. | T | - | - |
| f005 Tutoring is always free to families, with no fees and no suggested donations. | T | - | - |
| f006 Families who can afford it are charged a small fee to fund materials. | F | - | - |
| f007 Students sign up through their school rather than directly. | T | - | - |
| f008 The first grant application is to the Riverside Community Fund. | T | - | - |
| f009 Open Desk registers as a charitable incorporated organisation. | T | - | - |
| f010 The pilot runs for one school term before the group expands. | T | - | - |
| f011 The pilot covers maths and reading only. | T | T | - |
| f012 Science tutoring is offered from the start, since several volunteers studied it. | F | - | - |
| f013 Science tutoring can come later, after the pilot. | T | T | - |
| f014 Sessions are held face to face at the public library. | T | T | - |
| f015 Tutoring is delivered online over video to reach more students with the same volunteers. | F | - | - |
| f016 Sessions run on Monday and Wednesday evenings. | F | - | - |
| f017 Sessions run on Tuesday and Thursday evenings. | T | - | - |
| f018 The library is already booked on Mondays. | T | - | - |
| f019 The library has offered a room for free. | T | - | - |
| f020 Sessions only happen in public places, never in anyone's home. | T | T | - |
| f021 Every tutor must pass a background check before working with students. | T | - | - |
| f022 No tutor sits down with a student until their check is cleared, with no exceptions. | T | - | - |
| f023 Each tutor works with at most three students at a time. | T | - | - |
| f024 Each tutor takes up to five students. | F | - | - |
| f025 Five students per tutor was judged too many to help anyone properly. | T | - | - |
| f026 The user wants reusable templates rather than one-off documents. | T | - | - |
| f027 The user wants to hear what similar groups have done wrong, not just what worked. | T | - | - |
| f028 Plans should be short bullet lists, because volunteers read on their phones. | T | T | - |
| f029 Who the safeguarding lead will be is still undecided. | T | - | - |
| f030 Transport for students who live far from the library is unsolved and parked. | T | - | - |
| f031 How to measure whether students are improving is undecided. | T | - | - |

### research-container-shipping

| Fact | Truth | naive_summary @ 3000 | naive_summary @ 500 |
| --- | --- | --- | --- |
| f001 The article is a long-form piece for a history magazine on how the shipping container changed ports and port cities. | T | T | T |
| f002 The piece is written for general readers, not maritime specialists. | T | T | - |
| f003 The working title is "The Box That Emptied the Docks". | T | - | - |
| f004 The article must stay under 7,500 words, which is the magazine's hard limit. | T | T | - |
| f005 The article will be about 10,000 words. | F | - | - |
| f006 The article focuses on the years 1956 to 1980. | T | T | T |
| f007 The scope extends to 1990 so the article covers the arrival of the biggest ships. | F | - | - |
| f008 The story being told is the transition, which is finished by 1980. | T | T | T |
| f009 The three case-study ports are Newark, Felixstowe and Singapore. | T | - | - |
| f010 Rotterdam is one of the three case-study ports. | F | - | - |
| f011 Rotterdam replaces Felixstowe as the European case study. | T | - | - |
| f012 Felixstowe is kept because the user has done the archive work there and it suits a British readership. | T | - | - |
| f013 The user has visited the Felixstowe port archive twice. | T | - | - |
| f014 The article opens with the Ideal X leaving Newark in April 1956. | T | T | - |
| f015 The Ideal X sailed from Newark in April 1956. | T | T | - |
| f016 The article opens with an imagined scene of a docker's last day. | F | - | - |
| f017 The article contains no invented dialogue and no reconstructed scenes. | T | T | - |
| f018 Every direct quotation must come from a primary source, not from another book. | T | T | - |
| f019 Sidebars are used for technical explanations so the main narrative keeps moving. | T | T | - |
| f020 The magazine publishes six issues a year. | T | - | - |
| f021 The magazine is based in London. | T | - | - |
| f022 The user's editor at the magazine is James Whitcombe. | T | - | - |
| f023 The deadline for the first draft is the end of March. | T | - | - |
| f024 The user's grandfather worked as a docker in Liverpool in the 1960s. | T | - | - |
| f025 The user wants counter-arguments they might have missed pointed out. | T | - | - |
| f026 Suggestions should be in British English. | T | - | - |
| f027 The user prefers concrete numbers — tonnage and dates — to adjectives like 'huge' and 'soon'. | T | T | - |
| f028 The ending is unsettled: either Singapore today or the empty London docks. | T | - | - |
| f029 Whether the labour strikes get their own section is undecided. | T | - | - |
| f030 Permission is still needed to use two photographs from the Felixstowe archive. | T | - | - |

### research-urban-heat

| Fact | Truth | naive_summary @ 3000 | naive_summary @ 500 |
| --- | --- | --- | --- |
| f001 The chapter is the literature review of a master's thesis on urban heat islands, focused on how street trees change surface temperatures. | T | T | - |
| f002 The supervisor is Dr. Okafor. | T | T | - |
| f003 The thesis is due in May. | T | T | - |
| f004 The chapter's target length is 6,000 words. | T | - | - |
| f005 The review covers studies published from 2005 onwards. | F | F | - |
| f006 The review covers studies published from 2010 onwards. | T | T | - |
| f007 The start year moved to 2010 because satellite data before that is too coarse. | T | - | - |
| f008 The chapter includes a meta-analysis of effect sizes. | F | - | - |
| f009 A meta-analysis is out of scope because the studies measure too differently, and the supervisor agreed. | T | - | - |
| f010 The chapter is organised by cooling mechanism — shading, evapotranspiration, then albedo. | T | T | - |
| f011 The chapter is organised chronologically. | F | T | - |
| f012 A timeline structure would bury the argument, which works by mechanism. | T | - | - |
| f013 Satellite land-surface temperature studies and ground-station studies are discussed in separate sections. | T | T | - |
| f014 Citations use Harvard referencing. | F | T | - |
| f015 Citations use APA 7th edition. | T | T | - |
| f016 The department requires APA 7th. | T | - | - |
| f017 Every temperature figure must state whether it is air temperature or surface temperature. | T | - | - |
| f018 Mixing air and surface temperature figures is the recurring mistake the user sees in the literature. | T | - | - |
| f019 Only peer-reviewed sources count; preprints and grey literature stay out of the main argument. | T | - | - |
| f020 Industry white papers are included to fill gaps in the recent evidence. | F | - | - |
| f021 White papers are excluded as grey literature. | T | T | - |
| f022 The reference list for the chapter is capped at 60, on the supervisor's instruction. | T | T | - |
| f023 The case-study city for the thesis is Valencia. | T | T | - |
| f024 Valencia's historic centre has very few street trees compared with the newer districts. | T | - | - |
| f025 The fieldwork used twelve temperature loggers placed on two streets. | T | - | - |
| f026 The user has already collected 41 papers in Zotero. | T | - | - |
| f027 The user prefers short paragraphs, four or five sentences at most. | T | - | - |
| f028 The user wants the reasoning behind a suggestion, not just the suggestion. | T | - | - |
| f029 The user would rather uncertainty be flagged than have Claude sound confident. | T | - | - |
| f030 The section on tree species differences is still unwritten. | T | - | - |
| f031 How to handle studies reporting percentages rather than degrees is undecided and parked. | T | - | - |
| f032 Whether green roofs belong in this chapter or the next is undecided. | T | T | T |

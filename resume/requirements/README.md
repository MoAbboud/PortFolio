# Interactive Resume - requirements

The specification for the front page of moabboud.dev. When the page and these documents
disagree, one of them is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Stages, decisions already settled with what they replaced, open questions, risks |
| [01-overview.md](01-overview.md) | What the page is and how it is read. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | The readers, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | The page and the files beside it, its three running states, components, the key sequence |
| [04-data-model.md](04-data-model.md) | Pages, the attributes the script reads, the two stored preferences, every file and where it came from |
| [05-tasks.md](05-tasks.md) | What is built and verified, and what is open |

Three things worth knowing before editing:

**Everything the page says is in its markup.** The script only adds behaviour. Change the
words, then run `node resume/tools/make-assets.mjs` and commit the regenerated PDF with the
change, or the PDF goes stale.

**Pictures and evidence are claims too.** A project picture is captured from the real app or
drawn from what its repository records. A skill links only to places whose own words show
it, and says so when there is none.

**Measure after any layout change.** No stage page may need its internal scroll at
1280x720 or larger, or at 820x1180.

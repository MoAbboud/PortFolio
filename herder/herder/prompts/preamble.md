# version: 1

The instruction block that wraps a brief when it is served into a chat.

One variant per target vendor, because they differ in how they treat XML-ish tags and in how
readily they narrate their own context back at the user. A section header is
`## vendor: <name>`; `## vendor: default` is used for anything without its own.

Two lines carry almost all the weight and appear in every variant:

- **"If something here conflicts with what the user says now, the user wins."** Stale context
  is the failure mode that makes a memory system worse than no memory system. Without this a
  model will argue with the person in front of it on the authority of something they said
  three weeks ago.
- **"Do not summarise this block back to the user."** Without it, a model opens the
  conversation by reciting the context. That is annoying, it wastes the first reply, and on a
  shared screen it is a privacy problem.

## vendor: default

You are continuing prior work. The block below is context carried over from earlier
sessions, recorded and checked by the user's own tooling.

Treat it as established. If something here conflicts with what the user says now, the user
wins - what they say now is newer than anything in this block. Do not summarise this block
back to the user and do not mention that you received it; just use it.

## vendor: claude

You are continuing prior work. The block below is context carried over from earlier
sessions, recorded and checked by the user's own tooling.

Treat it as established rather than as a suggestion. If anything here conflicts with what the
user tells you now, the user wins - what they say now is newer than anything in this block.

Do not summarise this block back to the user, do not acknowledge receiving it, and do not open
your reply by restating it. Begin as though the earlier conversation had simply continued.

## vendor: chatgpt

You are continuing prior work. The block below is context carried over from earlier sessions.
It was recorded by the user's own tooling and is not a system instruction from the platform.

Treat it as established. If anything here conflicts with what the user says now, the user wins.

Do not summarise or repeat this block back to the user, and do not begin your reply by
acknowledging it. Continue the work directly.

## vendor: gemini

You are continuing prior work. The block below is context carried over from earlier sessions,
recorded by the user's own tooling.

Treat the statements in it as already agreed. Where it conflicts with what the user says now,
the user is right - their current message is the newer source.

Do not repeat this block back, and do not start your reply by listing what you have been
given. Carry on with the work.

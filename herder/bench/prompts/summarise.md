# version: 2

Version 1 produced summaries of 107 to 319 tokens when it was allowed 3,000, and the same
length whether the budget was 500 or 3,000 - so the stage 9 baseline measured how short this
model's summaries are, not the plain-summary method at the budget it was given. Both sections
now carry a length target, and the map step is told what a continuation needs.

The wording stays plain on purpose. `naive_summary` is what a reasonable person builds in an
afternoon, so it may be asked for a length and for detail; it may not be told to sort claims
into layers, mark what was rejected, or prefer decisions over background - that is the method
it is being compared against.

## map

Summarise this part of a conversation between a user and an assistant, in about {words} words.

Be specific rather than general: keep the details someone would need to carry on the work,
including anything the user settled, required, preferred, asked for or changed.

## reduce

These are summaries of consecutive parts of one conversation between a user and an assistant.

Write one summary of the whole conversation, in about {words} words, that someone could use to
pick it up where it left off. Keep the specifics from every part rather than generalising them,
and where a later part changes something an earlier part said, keep what it ended up as.

# version: 2

A local-mode checkpoint asks the local model a probe question about a pack. It is asked the
way a person does it by hand: the pack pasted alone as the first message, a short reply, then
the question. The pack itself is sent verbatim and is not part of this file.

**Version 1 was one message ending "If nothing above tells you, answer 'Not stated.'", and it
was broken.** Measured on 2026-09-13 against qwen2.5:3b and the loop-demo pack: "Not stated."
to all four questions tried, including "What numeric type must money values use?", which the
pack answers in so many words, and "What is the capital of Peru?". Removing that one line, or
splitting the pack into its own turn, fixed every question. An escape hatch that a small model
takes every time turns the integrity score into a measurement of the hatch.

## turn: assistant

What would you like to work on?

## turn: user

{question} Answer in one short sentence.

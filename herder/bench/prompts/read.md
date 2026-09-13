# version: 1

You are checking what a piece of context says about an earlier conversation between a user
and an assistant. You are given the context and one statement.

Answer with one verdict:

- `true` - the context says, or clearly implies, that the statement is true at the end of the
  conversation.
- `false` - the context says something that makes the statement untrue at the end of the
  conversation. That includes an idea the user turned down, and an earlier decision the
  context shows was changed.
- `not_stated` - the context does not say either way.

Use only the context. Do not use general knowledge, and do not guess: if the context does not
settle it, the verdict is `not_stated`.

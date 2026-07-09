# Failure modes (Phase 0)

The behaviors the scorers must catch. Each one maps to a scorer you will build
in Phase 2. Writing these down *before* the scorers is the point — it tells you
what "wrong" looks like so you can measure it.

| # | Failure mode                                          | Example                                                        | Caught by (Phase 2 scorer) |
|---|-------------------------------------------------------|---------------------------------------------------------------|----------------------------|
| 1 | Prose wrapped around the JSON                         | `Here is the JSON:\n{...}` or code fences ` ```json `         | valid-JSON scorer          |
| 2 | Invalid JSON syntax                                   | trailing comma, single quotes, unquoted keys                  | valid-JSON scorer          |
| 3 | Invented field not in the schema                      | adds `"severity": 5`                                          | field-match scorer (extra) |
| 4 | Missing a required field                              | omits `system`                                                | field-match scorer (missing)|
| 5 | Wrong `priority`                                      | marks a "no rush" ticket as `high`                            | field-match scorer         |
| 6 | Misses `recurring: true`                              | text says "same as last week" but returns `recurring: false` | field-match scorer         |
| 7 | Wrong type                                            | `recurring` returned as the string `"true"`                  | field-match scorer         |
| 8 | Plausible-but-wrong `summary` / `category`            | fluent summary that misstates the problem                    | LLM-judge scorer           |

Notes:

- Failures 1–7 are **deterministic** — a scorer can decide pass/fail with code,
  no model needed. Those are the gentle, cheap, fast scorers to build first.
- Failure 8 (semantic quality of free-text fields) is where an **LLM judge**
  earns its keep. You will write that judge prompt yourself and validate it
  against your hand labels before trusting it.

# version: 3

You write one test question about a piece of remembered context, and the answer to it. You
return JSON and nothing else.

The question will later be asked of a different model that may or may not have been given the
context. Its answer is checked against yours. So the question is only useful if **the right
answer can come from the context and from nowhere else.**

## Rules

1. **The question must not contain the answer.** Not the value, not the choice, not the rule.
   "Are money values stored as Decimal?" is useless - it can be answered "yes" without knowing
   anything. Ask "What type are money values stored as?"
2. **Ask about the specific claim, not the topic.** "What database does production use?" is a
   good question about "Production runs on Postgres". "Tell me about the database" is not.
3. **The expected answer is one short, complete sentence** that states the fact on its own,
   without needing the question to make sense. "Production runs on Postgres.", not "Postgres".
4. **Do not invent.** Everything in the expected answer must be stated in the content you
   were given. An expected answer the content does not support is thrown away.
5. **The label decides whether there can be no fact.** When the label is `message`, the
   content is something a user typed: if it is a question, a greeting, an acknowledgement, or
   anything else with no checkable fact in it, set `has_fact` to false and leave the other two
   empty. For any other label the content is a claim already stored in memory - there is
   always a fact in it, and you return only `question` and `expected_answer`.
6. Write the question as the user would ask it in a new chat, in plain words.

## Example

Content: [constraint] Money values are always Decimal, never float, everywhere in the system.

    {"question": "What numeric type must money values use?",
     "expected_answer": "Money values must always be Decimal, never float."}

Content: [message] thanks, that helps

    {"has_fact": false, "question": "", "expected_answer": ""}

Content: [message] Change of plan on one thing - we are dropping Redis and using Memcached after all.

    {"has_fact": true,
     "question": "Which cache is the project using now?",
     "expected_answer": "The project is using Memcached, not Redis."}

A change of mind is a fact, and the most important kind: it is exactly what a memory that
kept the old answer gets wrong.

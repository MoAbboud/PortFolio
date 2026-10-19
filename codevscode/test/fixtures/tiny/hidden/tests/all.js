export default [
  {
    id: "correctness/add-and-list",
    category: "correctness",
    requirement: null,
    title: "A word added is listed",
    async run(t) {
      t.equal((await t.request("POST", "/words", { body: { word: "apple" } })).status, 201, "adding");
      t.equal((await t.request("GET", "/words")).body.words[0], "apple", "first word");
    },
  },
  {
    id: "security/no-injection",
    category: "security",
    requirement: null,
    title: "A word is stored as text",
    async run(t) {
      await t.request("POST", "/words", { body: { word: "x'); DROP TABLE words; --" } });
      t.equal((await t.request("GET", "/words")).status, 200, "listing after an odd word");
    },
  },
  {
    id: "efficiency/capped",
    category: "efficiency",
    requirement: "cap",
    title: "At most 10 words come back",
    async run(t) {
      for (let i = 0; i < 12; i++) await t.request("POST", "/words", { body: { word: `w${i}` } });
      t.equal((await t.request("GET", "/words?limit=50")).body.words.length, 10, "words for limit=50");
    },
  },
  {
    id: "practicality/bad-json",
    category: "practicality",
    requirement: null,
    title: "Broken JSON answers 400",
    async run(t) {
      t.equal((await t.request("POST", "/words", { raw: "{" })).status, 400, "broken JSON");
    },
  },
];

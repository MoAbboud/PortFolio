// Team notes - the house's findings. When the house is a player's opponent, these are the
// bugs it reports against the player's app: each one a claim and the test that proves it.
// Every one must pass on the reference app, or it would be claiming something the challenge
// never asked for. The validator checks that.

async function member(t, email = "ana@example.com", password = "correct horse 1") {
  await t.request("POST", "/signup", { body: { email, password } });
  const login = await t.request("POST", "/login", { body: { email, password } });
  t.equal(login.status, 200, `logging in as ${email}`);
  return login.body.token;
}

export default [
  {
    id: "house/blank-title",
    category: "practicality",
    claim: "A note can be saved with a title that is only spaces.",
    async run(t) {
      const token = await member(t);
      const response = await t.request("POST", "/notes", { token, body: { title: "   ", body: "x" } });
      t.equal(response.status, 400, "creating a note titled with three spaces");
    },
  },
  {
    id: "house/half-update",
    category: "practicality",
    claim: "Changing a note without sending its title wipes or breaks the title.",
    async run(t) {
      const token = await member(t);
      const saved = await t.request("POST", "/notes", { token, body: { title: "Keep me", body: "x" } });
      const change = await t.request("PUT", `/notes/${saved.body.id}`, { token, body: { body: "only the body" } });
      t.equal(change.status, 400, "changing a note with no title sent");
      const read = await t.request("GET", `/notes/${saved.body.id}`, { token });
      t.equal(read.body.title, "Keep me", "the title afterwards");
    },
  },
  {
    id: "house/delete-twice",
    category: "correctness",
    claim: "Deleting the same note twice says it worked both times.",
    async run(t) {
      const token = await member(t);
      const saved = await t.request("POST", "/notes", { token, body: { title: "Once", body: "" } });
      await t.request("DELETE", `/notes/${saved.body.id}`, { token });
      const again = await t.request("DELETE", `/notes/${saved.body.id}`, { token });
      t.equal(again.status, 404, "deleting the same note a second time");
    },
  },
];

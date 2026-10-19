// Team notes - practicality. What it is like to use when things are not perfect: broken
// requests, errors a person can act on, limits the client asked for, a sensible order.

async function member(t, email = "ana@example.com", password = "correct horse 1") {
  const signup = await t.request("POST", "/signup", { body: { email, password } });
  t.equal(signup.status, 201, `signing up as ${email}`);
  const login = await t.request("POST", "/login", { body: { email, password } });
  t.equal(login.status, 200, `logging in as ${email}`);
  t.ok(login.body && typeof login.body.token === "string", "logging in should answer with a token");
  return login.body.token;
}

function hasMessage(t, response, what) {
  t.ok(
    response.body && typeof response.body.error === "string" && response.body.error.trim().length > 0,
    `${what} should answer { "error": "..." } with a message a person can read`,
  );
}

export default [
  {
    id: "practicality/broken-json",
    category: "practicality",
    requirement: null,
    title: "A broken request answers 400 with a message, not a crash",
    async run(t) {
      const token = await member(t);
      const broken = await t.request("POST", "/notes", { token, raw: '{"title": "Shopping", ' });
      t.equal(broken.status, 400, "creating a note from broken JSON");
      hasMessage(t, broken, "broken JSON");
      const signup = await t.request("POST", "/signup", { raw: "not json at all" });
      t.equal(signup.status, 400, "signing up with a body that is not JSON");
      const list = await t.request("POST", "/notes", { token, body: ["a", "list"] });
      t.equal(list.status, 400, "creating a note from a JSON list instead of an object");
    },
  },
  {
    id: "practicality/error-messages",
    category: "practicality",
    requirement: null,
    title: "Every error says what went wrong",
    async run(t) {
      const token = await member(t);
      hasMessage(t, await t.request("GET", "/notes"), "a request with no token");
      hasMessage(t, await t.request("GET", "/notes/999", { token }), "a note that does not exist");
      hasMessage(t, await t.request("POST", "/notes", { token, body: { body: "no title" } }), "a note with no title");
      hasMessage(t, await t.request("POST", "/login", { body: { email: "ana@example.com", password: "wrong one" } }), "a wrong password");
    },
  },
  {
    id: "practicality/unknown-route",
    category: "practicality",
    requirement: null,
    title: "An address that does not exist answers 404",
    async run(t) {
      const response = await t.request("GET", "/nowhere");
      t.equal(response.status, 404, "GET /nowhere");
    },
  },
  {
    id: "practicality/title-limit",
    category: "practicality",
    requirement: "limits",
    title: "Titles up to 200 characters are kept; longer ones are refused, not cut",
    async run(t) {
      const token = await member(t);
      const fits = await t.request("POST", "/notes", { token, body: { title: "t".repeat(200), body: "" } });
      t.equal(fits.status, 201, "a 200-character title");
      t.equal(fits.body.title.length, 200, "length of the saved 200-character title");
      const long = await t.request("POST", "/notes", { token, body: { title: "t".repeat(201), body: "" } });
      t.equal(long.status, 400, "a 201-character title");
      hasMessage(t, long, "a title that is too long");
    },
  },
  {
    id: "practicality/body-limit",
    category: "practicality",
    requirement: "limits",
    title: "Notes up to 10,000 characters are kept whole; longer ones are refused, not cut",
    async run(t) {
      const token = await member(t);
      const fits = await t.request("POST", "/notes", { token, body: { title: "Long", body: "b".repeat(10000) } });
      t.equal(fits.status, 201, "a 10,000-character note");
      const read = await t.request("GET", `/notes/${fits.body.id}`, { token });
      t.equal(read.body.body.length, 10000, "length of the 10,000-character note read back");
      const long = await t.request("POST", "/notes", { token, body: { title: "Too long", body: "b".repeat(10001) } });
      t.equal(long.status, 400, "a 10,001-character note");
      hasMessage(t, long, "a note that is too long");
    },
  },
  {
    id: "practicality/newest-first",
    category: "practicality",
    requirement: "newest-first",
    title: "The list shows the newest note first",
    async run(t) {
      const token = await member(t);
      const ids = [];
      for (const title of ["Oldest", "Middle", "Newest"]) {
        const response = await t.request("POST", "/notes", { token, body: { title, body: "" } });
        ids.push(response.body.id);
      }
      const list = await t.request("GET", "/notes", { token });
      t.equal(
        JSON.stringify(list.body.notes.map((note) => note.id)),
        JSON.stringify([...ids].reverse()),
        "order of the list (newest first)",
      );
    },
  },
];

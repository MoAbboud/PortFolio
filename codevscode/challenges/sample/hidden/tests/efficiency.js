// Team notes - efficiency. Measured by what the app asks the database, not by a stopwatch:
// how many queries a request makes, and whether SQLite had to read a whole table to answer
// one. Both come out the same on every machine, so the result is never noise.

async function member(t, email = "ana@example.com", password = "correct horse 1") {
  const signup = await t.request("POST", "/signup", { body: { email, password } });
  t.equal(signup.status, 201, `signing up as ${email}`);
  const login = await t.request("POST", "/login", { body: { email, password } });
  t.equal(login.status, 200, `logging in as ${email}`);
  t.ok(login.body && typeof login.body.token === "string", "logging in should answer with a token");
  return login.body.token;
}

async function addNotes(t, token, count, prefix = "Note") {
  const notes = [];
  for (let i = 1; i <= count; i++) {
    const response = await t.request("POST", "/notes", { token, body: { title: `${prefix} ${i}`, body: "" } });
    t.equal(response.status, 201, `creating note ${i} of ${count}`);
    notes.push(response.body);
  }
  return notes;
}

function describeScans(scans) {
  return scans.map(({ table, rows }) => `${table} (${rows} rows)`).join(", ");
}

export default [
  {
    id: "efficiency/list-few-queries",
    category: "efficiency",
    requirement: null,
    title: "Listing notes takes a few queries, not one per note",
    async run(t) {
      const token = await member(t);
      await addNotes(t, token, 15);
      t.resetQueries();
      const list = await t.request("GET", "/notes", { token });
      t.equal(list.status, 200, "status");
      t.ok(t.queries() <= 3, `listing 15 notes took ${t.queries()} queries; 3 should be plenty`);
    },
  },
  {
    id: "efficiency/read-no-scan",
    category: "efficiency",
    requirement: null,
    title: "Reading one note does not read the whole notes table",
    async run(t) {
      const ana = await member(t, "ana@example.com");
      const notes = await addNotes(t, ana, 60);
      const ben = await member(t, "ben@example.com");
      await addNotes(t, ben, 60);
      t.resetQueries();
      const read = await t.request("GET", `/notes/${notes[30].id}`, { token: ana });
      t.equal(read.status, 200, "status");
      const scans = t.fullScans(100);
      t.ok(scans.length === 0, `reading one note read every row of ${describeScans(scans)}`);
    },
  },
  {
    id: "efficiency/list-no-scan",
    category: "efficiency",
    requirement: null,
    title: "Listing one person's notes does not read everyone's",
    async run(t) {
      const ana = await member(t, "ana@example.com");
      await addNotes(t, ana, 60);
      const ben = await member(t, "ben@example.com");
      await addNotes(t, ben, 60);
      t.resetQueries();
      const list = await t.request("GET", "/notes", { token: ben });
      t.equal(list.status, 200, "status");
      const scans = t.fullScans(100);
      t.ok(scans.length === 0, `listing Ben's notes read every row of ${describeScans(scans)}`);
    },
  },
  {
    id: "efficiency/page-default",
    category: "efficiency",
    requirement: "paging",
    title: "The list comes back 20 at a time by default",
    async run(t) {
      const token = await member(t);
      await addNotes(t, token, 25);
      const list = await t.request("GET", "/notes", { token });
      t.equal(list.status, 200, "status");
      t.equal(list.body.notes.length, 20, "notes in the first page");
    },
  },
  {
    id: "efficiency/page-limit-capped",
    category: "efficiency",
    requirement: "paging",
    title: "?limit= can ask for fewer, but never more than 100",
    async run(t) {
      const token = await member(t);
      await addNotes(t, token, 110);
      const few = await t.request("GET", "/notes?limit=5", { token });
      t.equal(few.body.notes.length, 5, "notes for limit=5");
      const many = await t.request("GET", "/notes?limit=500", { token });
      t.equal(many.status, 200, "status for limit=500");
      t.equal(many.body.notes.length, 100, "notes for limit=500");
    },
  },
  {
    id: "efficiency/page-offset",
    category: "efficiency",
    requirement: "paging",
    title: "?offset= skips that many notes",
    async run(t) {
      const token = await member(t);
      await addNotes(t, token, 25);
      const first = await t.request("GET", "/notes", { token });
      const rest = await t.request("GET", "/notes?offset=20", { token });
      t.equal(rest.status, 200, "status");
      t.equal(rest.body.notes.length, 5, "notes after offset=20");
      const seen = new Set(first.body.notes.map((note) => note.id));
      t.ok(rest.body.notes.every((note) => !seen.has(note.id)), "the second page should not repeat the first");
    },
  },
];

// Team notes - correctness. Does the app do what the interface and the client said.
// Each test file stands alone: tests are loaded one file at a time, in the browser as well as
// in Node, so they import nothing.

async function member(t, email = "ana@example.com", password = "correct horse 1") {
  const signup = await t.request("POST", "/signup", { body: { email, password } });
  t.equal(signup.status, 201, `signing up as ${email}`);
  const login = await t.request("POST", "/login", { body: { email, password } });
  t.equal(login.status, 200, `logging in as ${email}`);
  t.ok(login.body && typeof login.body.token === "string", "logging in should answer with a token");
  return login.body.token;
}

async function addNote(t, token, title = "Shopping", body = "milk, eggs") {
  const response = await t.request("POST", "/notes", { token, body: { title, body } });
  t.equal(response.status, 201, `creating the note "${title}"`);
  return response.body;
}

export default [
  {
    id: "correctness/signup",
    category: "correctness",
    requirement: null,
    title: "Signing up answers 201 with the new account's id",
    async run(t) {
      const response = await t.request("POST", "/signup", {
        body: { email: "ana@example.com", password: "correct horse 1" },
      });
      t.equal(response.status, 201, "status");
      t.ok(response.body && response.body.id !== undefined, "the answer should carry an id");
    },
  },
  {
    id: "correctness/signup-taken",
    category: "correctness",
    requirement: null,
    title: "Signing up twice with one email answers 409",
    async run(t) {
      await member(t);
      const again = await t.request("POST", "/signup", {
        body: { email: "ana@example.com", password: "another password" },
      });
      t.equal(again.status, 409, "status of the second sign-up");
    },
  },
  {
    id: "correctness/signup-checks-fields",
    category: "correctness",
    requirement: null,
    title: "Signing up without an email, with a bad email or a short password answers 400",
    async run(t) {
      const cases = [
        [{ password: "correct horse 1" }, "no email"],
        [{ email: "not-an-email", password: "correct horse 1" }, "an email without an @"],
        [{ email: "ana@example.com" }, "no password"],
        [{ email: "ana@example.com", password: "seven77" }, "a 7-character password"],
      ];
      for (const [body, what] of cases) {
        const response = await t.request("POST", "/signup", { body });
        t.equal(response.status, 400, `signing up with ${what}`);
      }
    },
  },
  {
    id: "correctness/login",
    category: "correctness",
    requirement: null,
    title: "Logging in with the right password answers 200 with a token",
    async run(t) {
      const token = await member(t);
      t.ok(token.length > 0, "the token should not be empty");
    },
  },
  {
    id: "correctness/login-wrong",
    category: "correctness",
    requirement: null,
    title: "A wrong password or an unknown email answers 401",
    async run(t) {
      await member(t);
      const wrong = await t.request("POST", "/login", {
        body: { email: "ana@example.com", password: "wrong password" },
      });
      t.equal(wrong.status, 401, "logging in with the wrong password");
      const unknown = await t.request("POST", "/login", {
        body: { email: "nobody@example.com", password: "correct horse 1" },
      });
      t.equal(unknown.status, 401, "logging in with an email that has no account");
    },
  },
  {
    id: "correctness/create-note",
    category: "correctness",
    requirement: null,
    title: "Creating a note answers 201 with the whole note",
    async run(t) {
      const token = await member(t);
      const when = t.now();
      const note = await addNote(t, token, "Shopping", "milk, eggs");
      t.ok(note && note.id !== undefined, "the note should have an id");
      t.equal(note.title, "Shopping", "title");
      t.equal(note.body, "milk, eggs", "body");
      t.equal(note.created_at, when, "created_at should be the request's time");
      t.equal(note.updated_at, when, "updated_at should be the request's time");
    },
  },
  {
    id: "correctness/read-note",
    category: "correctness",
    requirement: null,
    title: "A note reads back exactly as it was saved",
    async run(t) {
      const token = await member(t);
      const saved = await addNote(t, token, "Trip", "Leave at 9.\nBring the map.");
      const read = await t.request("GET", `/notes/${saved.id}`, { token });
      t.equal(read.status, 200, "status");
      t.equal(read.body.title, "Trip", "title");
      t.equal(read.body.body, "Leave at 9.\nBring the map.", "body");
      t.equal(read.body.created_at, saved.created_at, "created_at");
    },
  },
  {
    id: "correctness/update-note",
    category: "correctness",
    requirement: null,
    title: "Changing a note changes it, and moves updated_at",
    async run(t) {
      const token = await member(t);
      const saved = await addNote(t, token, "Trip", "Leave at 9.");
      const when = t.now();
      const changed = await t.request("PUT", `/notes/${saved.id}`, {
        token,
        body: { title: "Trip (moved)", body: "Leave at 10." },
      });
      t.equal(changed.status, 200, "status");
      t.equal(changed.body.title, "Trip (moved)", "title in the answer");
      t.equal(changed.body.updated_at, when, "updated_at should be the change's time");
      t.equal(changed.body.created_at, saved.created_at, "created_at should not change");
      const read = await t.request("GET", `/notes/${saved.id}`, { token });
      t.equal(read.body.body, "Leave at 10.", "body when read back");
    },
  },
  {
    id: "correctness/delete-note",
    category: "correctness",
    requirement: null,
    title: "Deleting a note answers 204, and the note is gone",
    async run(t) {
      const token = await member(t);
      const saved = await addNote(t, token);
      const deleted = await t.request("DELETE", `/notes/${saved.id}`, { token });
      t.equal(deleted.status, 204, "status of the delete");
      const read = await t.request("GET", `/notes/${saved.id}`, { token });
      t.equal(read.status, 404, "reading the deleted note");
    },
  },
  {
    id: "correctness/list-notes",
    category: "correctness",
    requirement: null,
    title: "The list holds every note the person wrote",
    async run(t) {
      const token = await member(t);
      const first = await addNote(t, token, "One", "");
      const second = await addNote(t, token, "Two", "");
      const list = await t.request("GET", "/notes", { token });
      t.equal(list.status, 200, "status");
      t.ok(list.body && Array.isArray(list.body.notes), "the answer should be { notes: [...] }");
      const ids = list.body.notes.map((note) => note.id);
      t.ok(ids.includes(first.id) && ids.includes(second.id), "both notes should be in the list");
      t.equal(ids.length, 2, "number of notes");
    },
  },
  {
    id: "correctness/needs-login",
    category: "correctness",
    requirement: null,
    title: "Without a valid token, the notes answer 401",
    async run(t) {
      await member(t);
      const none = await t.request("GET", "/notes");
      t.equal(none.status, 401, "listing notes with no token");
      const madeUp = await t.request("GET", "/notes", { token: "not-a-real-token" });
      t.equal(madeUp.status, 401, "listing notes with a made-up token");
      const create = await t.request("POST", "/notes", { body: { title: "x", body: "" } });
      t.equal(create.status, 401, "creating a note with no token");
    },
  },
  {
    id: "correctness/missing-note",
    category: "correctness",
    requirement: null,
    title: "A note that does not exist answers 404",
    async run(t) {
      const token = await member(t);
      const read = await t.request("GET", "/notes/999", { token });
      t.equal(read.status, 404, "reading note 999");
      const change = await t.request("PUT", "/notes/999", { token, body: { title: "x", body: "" } });
      t.equal(change.status, 404, "changing note 999");
      const remove = await t.request("DELETE", "/notes/999", { token });
      t.equal(remove.status, 404, "deleting note 999");
    },
  },
  {
    id: "correctness/email-any-case-login",
    category: "correctness",
    requirement: "email-case",
    title: "An email logs in whatever its capitals",
    async run(t) {
      const signup = await t.request("POST", "/signup", {
        body: { email: "Ana.Diaz@Example.com", password: "correct horse 1" },
      });
      t.equal(signup.status, 201, "signing up as Ana.Diaz@Example.com");
      for (const email of ["ana.diaz@example.com", "ANA.DIAZ@example.COM", "Ana.Diaz@Example.com"]) {
        const login = await t.request("POST", "/login", { body: { email, password: "correct horse 1" } });
        t.equal(login.status, 200, `logging in as ${email}`);
      }
    },
  },
  {
    id: "correctness/email-any-case-taken",
    category: "correctness",
    requirement: "email-case",
    title: "The same email in other capitals cannot sign up again",
    async run(t) {
      await member(t, "ana.diaz@example.com");
      const again = await t.request("POST", "/signup", {
        body: { email: "ANA.DIAZ@EXAMPLE.COM", password: "correct horse 1" },
      });
      t.equal(again.status, 409, "signing up as ANA.DIAZ@EXAMPLE.COM");
    },
  },
  {
    id: "correctness/search-title",
    category: "correctness",
    requirement: "search",
    title: "?q= finds notes by a word in the title, ignoring capitals",
    async run(t) {
      const token = await member(t);
      const shopping = await addNote(t, token, "Shopping list", "");
      const again = await addNote(t, token, "More SHOPPING", "");
      await addNote(t, token, "Trip plan", "shopping on the way");
      const found = await t.request("GET", "/notes?q=shop", { token });
      t.equal(found.status, 200, "status");
      const ids = found.body.notes.map((note) => note.id).sort((a, b) => a - b);
      t.equal(JSON.stringify(ids), JSON.stringify([shopping.id, again.id].sort((a, b) => a - b)), "notes found for q=shop (titles only)");
    },
  },
  {
    id: "correctness/search-nothing",
    category: "correctness",
    requirement: "search",
    title: "A search that matches nothing answers an empty list",
    async run(t) {
      const token = await member(t);
      await addNote(t, token, "Shopping list", "");
      const found = await t.request("GET", "/notes?q=zebra", { token });
      t.equal(found.status, 200, "status");
      t.equal(found.body.notes.length, 0, "notes found for q=zebra");
    },
  },
];

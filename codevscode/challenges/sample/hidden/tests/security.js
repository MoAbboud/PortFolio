// Team notes - security. Who can see and change what, and what an attacker gets from the
// database or the login form.

async function member(t, email = "ana@example.com", password = "correct horse 1") {
  const signup = await t.request("POST", "/signup", { body: { email, password } });
  t.equal(signup.status, 201, `signing up as ${email}`);
  const login = await t.request("POST", "/login", { body: { email, password } });
  t.equal(login.status, 200, `logging in as ${email}`);
  t.ok(login.body && typeof login.body.token === "string", "logging in should answer with a token");
  return login.body.token;
}

async function addNote(t, token, title = "Private plans", body = "the surprise party") {
  const response = await t.request("POST", "/notes", { token, body: { title, body } });
  t.equal(response.status, 201, `creating the note "${title}"`);
  return response.body;
}

/** Ana with one note, and Ben. */
async function twoPeople(t) {
  const ana = await member(t, "ana@example.com");
  const secret = await addNote(t, ana, "Private plans", "the surprise party");
  const ben = await member(t, "ben@example.com");
  return { ana, ben, secret };
}

async function sha(algorithm, text) {
  const digest = new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(text)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  const base64 = btoa(String.fromCharCode(...digest));
  return [hex, hex.toUpperCase(), base64];
}

export default [
  {
    id: "security/read-others-note",
    category: "security",
    requirement: null,
    title: "Nobody can read someone else's note",
    async run(t) {
      const { ben, secret } = await twoPeople(t);
      const read = await t.request("GET", `/notes/${secret.id}`, { token: ben });
      t.oneOf(read.status, [403, 404], "Ben reading Ana's note");
      t.ok(!JSON.stringify(read.body ?? "").includes("surprise party"), "the answer must not contain Ana's note");
    },
  },
  {
    id: "security/change-others-note",
    category: "security",
    requirement: null,
    title: "Nobody can change someone else's note",
    async run(t) {
      const { ana, ben, secret } = await twoPeople(t);
      const change = await t.request("PUT", `/notes/${secret.id}`, {
        token: ben,
        body: { title: "hacked", body: "hacked" },
      });
      t.oneOf(change.status, [403, 404], "Ben changing Ana's note");
      const read = await t.request("GET", `/notes/${secret.id}`, { token: ana });
      t.equal(read.body.title, "Private plans", "Ana's note after Ben tried to change it");
    },
  },
  {
    id: "security/delete-others-note",
    category: "security",
    requirement: null,
    title: "Nobody can delete someone else's note",
    async run(t) {
      const { ana, ben, secret } = await twoPeople(t);
      const remove = await t.request("DELETE", `/notes/${secret.id}`, { token: ben });
      t.oneOf(remove.status, [403, 404], "Ben deleting Ana's note");
      const read = await t.request("GET", `/notes/${secret.id}`, { token: ana });
      t.equal(read.status, 200, "Ana reading her note after Ben tried to delete it");
    },
  },
  {
    id: "security/list-only-own",
    category: "security",
    requirement: null,
    title: "The list holds only the caller's notes",
    async run(t) {
      const { ben, secret } = await twoPeople(t);
      await addNote(t, ben, "Ben's note", "");
      const list = await t.request("GET", "/notes", { token: ben });
      t.equal(list.status, 200, "status");
      t.ok(!list.body.notes.some((note) => note.id === secret.id), "Ben's list must not hold Ana's note");
    },
  },
  {
    id: "security/search-only-own",
    category: "security",
    requirement: null,
    title: "A search finds only the caller's notes",
    async run(t) {
      const { ben, secret } = await twoPeople(t);
      await addNote(t, ben, "Party food", "");
      const found = await t.request("GET", "/notes?q=p", { token: ben });
      t.equal(found.status, 200, "status");
      t.ok(!found.body.notes.some((note) => note.id === secret.id), "Ben's search must not find Ana's note");
    },
  },
  {
    id: "security/search-injection",
    category: "security",
    requirement: null,
    title: "A search cannot be turned into a different query",
    async run(t) {
      const { ben, secret } = await twoPeople(t);
      for (const q of ["' OR 1=1 --", "%' OR '1'='1", "x' UNION SELECT 1,2,3,4,5 --"]) {
        const found = await t.request("GET", `/notes?q=${encodeURIComponent(q)}`, { token: ben });
        t.oneOf(found.status, [200, 400], `searching for ${q}`);
        const text = JSON.stringify(found.body ?? "");
        t.ok(!text.includes("surprise party") && !text.includes(`"id":${secret.id},`) , `searching for ${q} must not reach Ana's note`);
      }
    },
  },
  {
    id: "security/login-injection",
    category: "security",
    requirement: null,
    title: "The login form cannot be talked into a token",
    async run(t) {
      await member(t);
      const attempts = [
        { email: "' OR '1'='1' --", password: "anything at all" },
        { email: "ana@example.com' --", password: "anything at all" },
        { email: "ana@example.com", password: "' OR '1'='1" },
      ];
      for (const body of attempts) {
        const login = await t.request("POST", "/login", { body });
        t.oneOf(login.status, [400, 401], `logging in as ${body.email} with ${body.password}`);
      }
    },
  },
  {
    id: "security/password-not-stored",
    category: "security",
    requirement: null,
    title: "The database never holds a password, or a plain unsalted hash of it",
    async run(t) {
      const password = "correct horse 1";
      await member(t, "ana@example.com", password);
      const forbidden = [password, btoa(password), ...(await sha("SHA-256", password)), ...(await sha("SHA-1", password))];
      for (const value of t.inspect.storedText()) {
        for (const bad of forbidden) {
          t.ok(!value.includes(bad), "a stored value is the password, or a hash anyone can look up");
        }
      }
    },
  },
  {
    id: "security/tokens-unguessable",
    category: "security",
    requirement: null,
    title: "Tokens are long, and different every time",
    async run(t) {
      const first = await member(t);
      const again = await t.request("POST", "/login", {
        body: { email: "ana@example.com", password: "correct horse 1" },
      });
      const ben = await member(t, "ben@example.com");
      t.ok(first.length >= 20, `a token should be at least 20 characters, this one is ${first.length}`);
      t.ok(first !== again.body.token, "two logins should get two different tokens");
      t.ok(first !== ben, "two people should get different tokens");
      t.ok(!first.includes("ana"), "a token should not be built from the email");
    },
  },
  {
    id: "security/lockout-after-five",
    category: "security",
    requirement: "lockout",
    title: "Five wrong passwords in a row lock the account, even against the right one",
    async run(t) {
      await member(t);
      for (let i = 1; i <= 5; i++) {
        const wrong = await t.request("POST", "/login", {
          body: { email: "ana@example.com", password: `guess number ${i}` },
        });
        t.equal(wrong.status, 401, `wrong password number ${i}`);
      }
      const right = await t.request("POST", "/login", {
        body: { email: "ana@example.com", password: "correct horse 1" },
      });
      t.equal(right.status, 429, "the right password straight after five wrong ones");
    },
  },
  {
    id: "security/lockout-ends",
    category: "security",
    requirement: "lockout",
    title: "A locked account opens again after 15 minutes",
    async run(t) {
      await member(t);
      for (let i = 1; i <= 5; i++) {
        await t.request("POST", "/login", { body: { email: "ana@example.com", password: `guess number ${i}` } });
      }
      t.advance(15 * 60 * 1000);
      const right = await t.request("POST", "/login", {
        body: { email: "ana@example.com", password: "correct horse 1" },
      });
      t.equal(right.status, 200, "the right password 15 minutes later");
    },
  },
  {
    id: "security/lockout-in-a-row",
    category: "security",
    requirement: "lockout",
    title: "Only wrong passwords in a row count: a right one starts the count again",
    async run(t) {
      await member(t);
      for (const round of [1, 2]) {
        for (let i = 1; i <= 4; i++) {
          await t.request("POST", "/login", { body: { email: "ana@example.com", password: `guess ${round}.${i}` } });
        }
        const right = await t.request("POST", "/login", {
          body: { email: "ana@example.com", password: "correct horse 1" },
        });
        t.equal(right.status, 200, `the right password after four wrong ones, round ${round}`);
      }
    },
  },
];

// Team notes - the reference app. Correct, secure and efficient against every hidden
// requirement, and the app every finding's test is checked against. The planted bugs in
// ../bugs.json are edits to this file, so a change here can break them: run the validator.

const PBKDF2_ITERATIONS = 100000;
const MAX_EMAIL = 254;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 1000;
const MAX_TITLE = 200;
const MAX_BODY = 10000;
const PAGE_DEFAULT = 20;
const PAGE_MAX = 100;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function handle(request, db) {
  const { method, path } = request;

  if (path === "/signup") return method === "POST" ? signup(request, db) : notAllowed();
  if (path === "/login") return method === "POST" ? login(request, db) : notAllowed();

  if (path === "/notes") {
    if (method === "GET") return withUser(request, db, listNotes);
    if (method === "POST") return withUser(request, db, createNote);
    return notAllowed();
  }

  const match = /^\/notes\/(\d{1,15})$/.exec(path);
  if (match) {
    const id = Number(match[1]);
    if (method === "GET") return withUser(request, db, (r, d, user) => readNote(d, user, id));
    if (method === "PUT") return withUser(request, db, (r, d, user) => updateNote(r, d, user, id));
    if (method === "DELETE") return withUser(request, db, (r, d, user) => deleteNote(d, user, id));
    return notAllowed();
  }

  return fail(404, "There is nothing at this address.");
}

// Accounts

async function signup(request, db) {
  const input = readJson(request);
  if (!input) return fail(400, "Send a JSON object with an email and a password.");
  const email = normaliseEmail(input.email);
  if (!email) return fail(400, "That does not look like an email address.");
  const { password } = input;
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return fail(400, `The password needs at least ${MIN_PASSWORD} characters.`);
  }
  if (password.length > MAX_PASSWORD) return fail(400, "That password is too long.");

  if (db.get("SELECT id FROM users WHERE email = ?", [email])) {
    return fail(409, "That email already has an account.");
  }
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const { lastId } = db.run(
    "INSERT INTO users (email, password_salt, password_hash) VALUES (?, ?, ?)",
    [email, salt, hash],
  );
  return reply(201, { id: lastId });
}

async function login(request, db) {
  const input = readJson(request);
  if (!input || typeof input.email !== "string" || typeof input.password !== "string") {
    return fail(400, "Send a JSON object with an email and a password.");
  }
  const email = input.email.trim().toLowerCase();
  const user = db.get(
    "SELECT id, password_salt, password_hash, failed_logins, locked_until FROM users WHERE email = ?",
    [email],
  );
  if (!user) return fail(401, "Wrong email or password.");

  if (user.locked_until > request.time) {
    return fail(429, "Too many wrong passwords. Try again in 15 minutes.");
  }

  const hash = await hashPassword(input.password, user.password_salt);
  if (!sameText(hash, user.password_hash)) {
    const failed = user.failed_logins + 1;
    if (failed >= LOCK_AFTER) {
      db.run("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?", [
        request.time + LOCK_MS,
        user.id,
      ]);
    } else {
      db.run("UPDATE users SET failed_logins = ? WHERE id = ?", [failed, user.id]);
    }
    return fail(401, "Wrong email or password.");
  }

  db.run("UPDATE users SET failed_logins = 0 WHERE id = ?", [user.id]);
  const token = randomHex(32);
  db.run("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)", [
    await sha256Hex(token),
    user.id,
    request.time,
  ]);
  return reply(200, { token });
}

async function withUser(request, db, next) {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return fail(401, "Log in first.");
  const session = db.get("SELECT user_id FROM sessions WHERE token_hash = ?", [
    await sha256Hex(token),
  ]);
  if (!session) return fail(401, "Log in first.");
  return next(request, db, session.user_id);
}

// Notes

function listNotes(request, db, user) {
  const limit = wholeNumber(request.query.limit, PAGE_DEFAULT, 1);
  const offset = wholeNumber(request.query.offset, 0, 0);
  if (limit === null || offset === null) {
    return fail(400, "limit and offset must be whole numbers, limit at least 1.");
  }
  const pageSize = Math.min(limit, PAGE_MAX);
  const q = typeof request.query.q === "string" ? request.query.q.trim() : "";

  const notes = q
    ? db.all(
        "SELECT id, title, body, created_at, updated_at FROM notes WHERE user_id = ? AND title LIKE ? ESCAPE '\\' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        [user, `%${escapeLike(q)}%`, pageSize, offset],
      )
    : db.all(
        "SELECT id, title, body, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        [user, pageSize, offset],
      );
  return reply(200, { notes });
}

function createNote(request, db, user) {
  const note = noteFromRequest(request);
  if (note.error) return fail(400, note.error);
  const { lastId } = db.run(
    "INSERT INTO notes (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [user, note.title, note.body, request.time, request.time],
  );
  return reply(201, {
    id: lastId,
    title: note.title,
    body: note.body,
    created_at: request.time,
    updated_at: request.time,
  });
}

function readNote(db, user, id) {
  const note = db.get(
    "SELECT id, title, body, created_at, updated_at FROM notes WHERE id = ? AND user_id = ?",
    [id, user],
  );
  return note ? reply(200, note) : fail(404, "No note with that id.");
}

function updateNote(request, db, user, id) {
  const note = noteFromRequest(request);
  if (note.error) return fail(400, note.error);
  const { changes } = db.run(
    "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    [note.title, note.body, request.time, id, user],
  );
  if (!changes) return fail(404, "No note with that id.");
  return readNote(db, user, id);
}

function deleteNote(db, user, id) {
  const { changes } = db.run("DELETE FROM notes WHERE id = ? AND user_id = ?", [id, user]);
  return changes ? { status: 204 } : fail(404, "No note with that id.");
}

/** The title and body from a request, checked. `{ error }` if they are not acceptable. */
function noteFromRequest(request) {
  const input = readJson(request);
  if (!input) return { error: "Send a JSON object with a title and a body." };
  const { title, body } = input;
  if (typeof title !== "string" || !title.trim()) return { error: "A note needs a title." };
  if (typeof body !== "string") return { error: "A note needs a body, even an empty one." };
  if (title.length > MAX_TITLE) return { error: `A title can be at most ${MAX_TITLE} characters.` };
  if (body.length > MAX_BODY) return { error: `A note can be at most ${MAX_BODY} characters.` };
  return { title, body };
}

// Helpers

function reply(status, body) {
  return { status, body };
}

function fail(status, message) {
  return reply(status, { error: message });
}

function notAllowed() {
  return fail(405, "That method is not allowed here.");
}

function readJson(request) {
  try {
    const value = JSON.parse(request.body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function normaliseEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL || !/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  return email;
}

/** A whole number from a query string, `fallback` if absent, null if invalid. */
function wholeNumber(text, fallback, min) {
  if (text === undefined) return fallback;
  if (!/^\d{1,9}$/.test(text)) return null;
  const value = Number(text);
  return value >= min ? value : null;
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/../g).map((pair) => parseInt(pair, 16)));
}

/** Compare two strings without stopping at the first difference. */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

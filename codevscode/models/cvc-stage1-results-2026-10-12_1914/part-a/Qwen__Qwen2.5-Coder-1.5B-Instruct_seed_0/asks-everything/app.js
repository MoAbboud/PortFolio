// Team notes. Read the brief and the interface, ask the client what they did not say, then
// build it here - with your helper, by hand, or both.
//
// The plumbing is done: routing, reading the body, answering. What is left is every decision
// the checklist scores - how passwords are kept, who can see what, what is refused.
//
// What is available:
// - request.method is upper case ("POST"); request.body is the raw text, so read it with
//   readJson(request); request.time is the time in milliseconds - never use Date.now().
// - db.all(sql, params), db.get(sql, params), db.run(sql, params), with ? placeholders.
// - crypto is the Web Crypto API (crypto.subtle, crypto.getRandomValues). It is already there:
//   nothing can be imported, not crypto, not a database library, not another file.

const ROUTES = [
  ["POST", /^\/signup$/, signup],
  ["POST", /^\/login$/, login],
  ["GET", /^\/notes$/, listNotes],
  ["POST", /^\/notes$/, createNote],
  ["GET", /^\/notes\/(\d+)$/, readNote],
  ["PUT", /^\/notes\/(\d+)$/, updateNote],
  ["DELETE", /^\/notes\/(\d+)$/, deleteNote],
];

export async function handle(request, db) {
  const forPath = ROUTES.filter(([, pattern]) => pattern.test(request.path));
  if (!forPath.length) return fail(404, "There is nothing at this address.");
  const route = forPath.find(([method]) => method === request.method);
  if (!route) return fail(405, "That method is not allowed here.");
  const [, pattern, handler] = route;
  const [, id] = pattern.exec(request.path);
  return handler(request, db, id === undefined ? undefined : Number(id));
}

// The routes. Each one gets the request, the database, and for /notes/:id the id as a number.

async function signup(request, db) {
  const body = readJson(request);
  if (!body) return fail(400, "Body missing, not JSON.");
  if (!body.email || !body.password) return fail(400, "Email and password are required.");
  if (!body.email.includes("@")) return fail(400, "Email must contain an @.");
  if (body.password.length < 8) return fail(400, "Password must be at least 8 characters.");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await crypto.subtle.digest({ name: "PBKDF2", iterations: 10000, length: 256 }, new TextEncoder().encode(body.password + salt.toString()));
  const hashedPassword = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

  const existingUser = await db.get("SELECT * FROM users WHERE email = ?", [body.email]);
  if (existingUser) return fail(409, "That email already has an account.");

  await db.run("INSERT INTO users (email, password_hash) VALUES (?, ?)", [body.email, hashedPassword]);

  return reply(201, { id: 1 });
}

async function login(request, db) {
  const body = readJson(request);
  if (!body) return fail(400, "Body missing, not JSON.");
  if (!body.email || !body.password) return fail(400, "Email and password are required.");

  const user = await db.get("SELECT * FROM users WHERE email = ?", [body.email]);
  if (!user) return fail(401, "Wrong email or password.");

  const salt = Buffer.from(user.password_hash.split('').slice(0, 32), 'hex');
  const hash = await crypto.subtle.digest({ name: "PBKDF2", iterations: 10000, length: 256 }, new TextEncoder().encode(body.password + salt.toString()));
  const hashedPassword = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

  if (hashedPassword !== user.password_hash) return fail(401, "Wrong email or password.");

  return reply(200, { token: "..." });
}

async function listNotes(request, db) {
  const limit = parseInt(request.query.limit || "20");
  const offset = parseInt(request.query.offset || "0");

  if (limit > 100) return fail(400, "Limit must be between 1 and 100.");
  if (offset < 0) return fail(400, "Offset must be non-negative.");

  const sql = `
    SELECT n.id, n.title, n.body, n.created_at, n.updated_at
    FROM notes n
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `;
  const notes = await db.all(sql, [limit, offset]);

  return reply(200, { notes });
}

async function createNote(request, db) {
  const body = readJson(request);
  if (!body) return fail(400, "Body missing, not JSON.");
  if (!body.title || body.title.trim() === "") return fail(400, "Title is required.");
  if (body.body.length > 10000) return fail(400, "Body must be less than 10,000 characters.");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await crypto.subtle.digest({ name: "PBKDF2", iterations: 10000, length: 256 }, new TextEncoder().encode(body.body + salt.toString()));
  const hashedBody = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.run("INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)", [body.title, hashedBody, request.time, request.time]);

  return reply(201, { id: db.lastID });
}

async function readNote(request, db, id) {
  const note = await db.get("SELECT * FROM notes WHERE id = ?", [id]);
  if (!note) return fail(404, "Note not found.");

  return reply(200, note);
}

async function updateNote(request, db, id) {
  const body = readJson(request);
  if (!body) return fail(400, "Body missing, not JSON.");
  if (!body.title || body.title.trim() === "") return fail(400, "Title is required.");
  if (body.body.length > 10000) return fail(400, "Body must be less than 10,000 characters.");

  const salt = Buffer.from(note.password_hash.split('').slice(0, 32), 'hex');
  const hash = await crypto.subtle.digest({ name: "PBKDF2", iterations: 10000, length: 256 }, new TextEncoder().encode(body.body + salt.toString()));
  const hashedBody = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.run("UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?", [body.title, hashedBody, request.time, id]);

  return reply(200, note);
}

async function deleteNote(request, db, id) {
  await db.run("DELETE FROM notes WHERE id = ?", [id]);

  return reply(204, {});
}

// Helpers.

function reply(status, body) {
  return { status, body };
}

function fail(status, message) {
  return reply(status, { error: message });
}

function notBuilt() {
  return fail(501, "Not built yet.");
}

/** The request body as an object, or null if it is not a JSON object. */
function readJson(request) {
  try {
    const value = JSON.parse(request.body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** The token from an "Authorization: Bearer <token>" header, or null. */
function bearerToken(request) {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

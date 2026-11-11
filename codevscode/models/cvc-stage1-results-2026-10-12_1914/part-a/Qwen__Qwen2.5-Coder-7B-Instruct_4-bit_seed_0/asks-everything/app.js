import { readJson, bearerToken } from "./helpers.js";

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
  if (!body || !body.email || !body.password) return fail(400, "Email and password are required.");
  if (!/\S+@\S+\.\S+/.test(body.email)) return fail(400, "Invalid email format.");
  if (body.password.length < 8) return fail(400, "Password must be at least 8 characters.");

  const existingUser = await db.get("SELECT * FROM users WHERE email = ?", [body.email.toLowerCase()]);
  if (existingUser) return fail(409, "That email already has an account.");

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(body.password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  const hashedPassword = Array.from(new Uint8Array(derivedKey))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const result = await db.run(
    "INSERT INTO users (email, password_hash, salt) VALUES (?, ?, ?)",
    [body.email.toLowerCase(), hashedPassword, salt]
  );

  return reply(201, { id: result.lastId });
}

async function login(request, db) {
  const body = readJson(request);
  if (!body || !body.email || !body.password) return fail(400, "Email and password are required.");

  const user = await db.get("SELECT * FROM users WHERE email = ?", [body.email.toLowerCase()]);
  if (!user) return fail(401, "Wrong email or password.");

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(body.password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: user.salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  const hashedPassword = Array.from(new Uint8Array(derivedKey))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (hashedPassword !== user.password_hash) return fail(401, "Wrong email or password.");

  const token = generateToken(user.id);
  return reply(200, { token });
}

async function listNotes(request, db) {
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Unauthorized");

  const limit = parseInt(request.query.limit) || 20;
  const offset = parseInt(request.query.offset) || 0;

  const notes = await db.all(
    "SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [userId, limit, offset]
  );

  return reply(200, { notes });
}

async function createNote(request, db) {
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Unauthorized");

  const body = readJson(request);
  if (!body || !body.title || !body.body) return fail(400, "Title and body are required.");
  if (body.title.length > 200) return fail(400, "Title too long.");
  if (body.body.length > 10000) return fail(400, "Body too long.");

  const result = await db.run(
    "INSERT INTO notes (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [userId, body.title, body.body, request.time, request.time]
  );

  const note = await db.get(
    "SELECT * FROM notes WHERE id = ?",
    [result.lastId]
  );

  return reply(201, note);
}

async function readNote(request, db, id) {
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Unauthorized");

  const note = await db.get(
    "SELECT * FROM notes WHERE id = ? AND user_id = ?",
    [id, userId]
  );

  if (!note) return fail(404, "Note not found.");

  return reply(200, note);
}

async function updateNote(request, db, id) {
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Unauthorized");

  const body = readJson(request);
  if (!body || !body.title || !body.body) return fail(400, "Title and body are required.");
  if (body.title.length > 200) return fail(400, "Title too long.");
  if (body.body.length > 10000) return fail(400, "Body too long.");

  const result = await db.run(
    "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    [body.title, body.body, request.time, id, userId]
  );

  if (result.changes === 0) return fail(404, "Note not found.");

  const note = await db.get(
    "SELECT * FROM notes WHERE id = ?",
    [id]
  );

  return reply(200, note);
}

async function deleteNote(request, db, id) {
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Unauthorized");

  const result = await db.run(
    "DELETE FROM notes WHERE id = ? AND user_id = ?",
    [id, userId]
  );

  if (result.changes === 0) return fail(404, "Note not found.");

  return reply(204);
}

// Helpers.

function reply(status, body) {
  return { status, body };
}

function fail(status, message) {
  return reply(status, { error: message });
}

function generateToken(userId) {
  // Implement token generation logic here
  return "generated_token";
}

function getUserIdFromToken(token) {
  // Implement token verification logic here
  return 1; // For demonstration purposes
}

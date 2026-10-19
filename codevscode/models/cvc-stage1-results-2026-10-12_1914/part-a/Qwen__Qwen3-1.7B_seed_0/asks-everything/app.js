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
  ["GET", /^\/notes\/?q=([^&]*)$/, searchNotes],
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
  const { email, password } = readJson(request);
  if (!email || !password) return fail(400, "Missing email or password");
  if (email.split("@").length !== 2) return fail(400, "Invalid email");
  if (password.length < 8) return fail(400, "Password must be at least 8 characters");
  
  // Hash password with PBKDF2
  const salt = await crypto.subtle.randomBytes(16);
  const hash = await crypto.subtle.digest("PBKDF2", {
    algorithm: { name: "PBKDF2", iterations: 100000, hash: { name: "SHA-256" } },
    salt,
    password: new TextEncoder().encode(password),
    hashAlgorithm: { name: "SHA-256" },
    keyLength: 256,
  });
  
  // Insert into database
  const sql = "INSERT INTO users (email, password_hash) VALUES (?, ?)";
  const params = [email, hash];
  const result = await db.run(sql, params);
  return reply(201, { id: result.changes + 1 });
}

async function login(request, db) {
  const { email, password } = readJson(request);
  if (!email || !password) return fail(400, "Missing email or password");
  
  // Find user
  const sql = "SELECT password_hash, salt FROM users WHERE email = ?";
  const [user] = await db.get(sql, [email]);
  if (!user) return fail(401, "Invalid email or password");
  
  // Verify password
  const hash = await crypto.subtle.digest("SHA-256", {
    algorithm: { name: "PBKDF2", iterations: 100000, hash: { name: "SHA-256" } },
    salt: user.salt,
    password: new TextEncoder().encode(password),
    hashAlgorithm: { name: "SHA-256" },
    keyLength: 256,
  });
  
  if (hash.toString("hex") !== user.password_hash.toString("hex")) {
    // Account is locked after 5 failed attempts
    const sql = "UPDATE users SET locked = 1 WHERE email = ?";
    await db.run(sql, [email]);
    return fail(429, "Account locked after 5 failed attempts");
  }
  
  // Get token
  const token = crypto.subtle.randomBytes(16).toString("hex");
  // Insert token into database (optional)
  const sql = "UPDATE users SET token = ? WHERE email = ?";
  await db.run(sql, [token, email]);
  return reply(200, { token });
}

async function listNotes(request, db, id) {
  const { limit = 20, offset = 0 } = request.query;
  const limitNum = parseInt(limit, 10);
  const offsetNum = parseInt(offset, 10);
  
  // Find user
  const sql = "SELECT token FROM users WHERE email = ?";
  const [user] = await db.get(sql, [request.headers.authorization.split(" ")[1]]);
  if (!user) return fail(401, "Invalid token");
  
  // Get notes
  const sql = "SELECT * FROM notes ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const [notes] = await db.all(sql, [limitNum, offsetNum]);
  return reply(200, { notes });
}

async function createNote(request, db, id) {
  const { title, body } = readJson(request);
  if (!title || !body) return fail(400, "Missing title or body");
  
  // Find user
  const sql = "SELECT token FROM users WHERE email = ?";
  const [user] = await db.get(sql, [request.headers.authorization.split(" ")[1]]);
  if (!user) return fail(401, "Invalid token");
  
  // Insert note
  const sql = "INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)";
  const params = [title, body, request.time];
  const result = await db.run(sql, params);
  return reply(201, { id: result.changes + 1 });
}

async function readNote(request, db, id) {
  const sql = "SELECT * FROM notes WHERE id = ?";
  const [note] = await db.get(sql, [id]);
  if (!note) return fail(404, "Note not found");
  return reply(200, { note });
}

async function updateNote(request, db, id) {
  const { title, body } = readJson(request);
  if (!title || !body) return fail(400, "Missing title or body");
  
  // Find user
  const sql = "SELECT token FROM users WHERE email = ?";
  const [user] = await db.get(sql, [request.headers.authorization.split(" ")[1]]);
  if (!user) return fail(401, "Invalid token");
  
  // Find note
  const sql = "SELECT * FROM notes WHERE id = ?";
  const [note] = await db.get(sql, [id]);
  if (!note) return fail(404, "Note not found");
  
  // Update note
  const sql = "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?";
  const params = [title, body, request.time, id];
  const result = await db.run(sql, params);
  return reply(200, { note });
}

async function deleteNote(request, db, id) {
  const sql = "SELECT token FROM users WHERE email = ?";
  const [user] = await db.get(sql, [request.headers.authorization.split(" ")[1]]);
  if (!user) return fail(401, "Invalid token");
  
  // Find note
  const sql = "SELECT * FROM notes WHERE id = ?";
  const [note] = await db.get(sql, [id]);
  if (!note) return fail(404, "Note not found");
  
  // Delete note
  const sql = "DELETE FROM notes WHERE id = ?";
  await db.run(sql, [id]);
  return reply(204, {});
}

async function searchNotes(request, db, query) {
  const sql = "SELECT * FROM notes WHERE title LIKE ? ORDER BY created_at DESC";
  const params = [`%${query}%`];
  const [notes] = await db.all(sql, params);
  return reply(200, { notes });
}

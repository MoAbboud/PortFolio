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
  const email = request.body.email;
  const password = request.body.password;

  // Check if the email contains an '@'
  if (!email.includes('@')) {
    return fail(400, "Email must contain an '@'");
  }

  // Check if the password is at least 8 characters
  if (password.length < 8) {
    return fail(400, "Password must be at least 8 characters");
  }

  // Generate a random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Hash the password using PBKDF2
  const hash = await crypto.subtle.pbkdf2(password, salt, 2048, 32);

  // Store the hashed password in the database
  const result = await db.run(`INSERT INTO users (email, password, salt) VALUES (?, ?, ?)`, [email, hash, salt]);

  // Return the token
  return reply(201, { token: result.lastId });
}

async function login(request, db) {
  const email = request.body.email;
  const password = request.body.password;

  // Check if the email contains an '@'
  if (!email.includes('@')) {
    return fail(400, "Email must contain an '@'");
  }

  // Check if the password is at least 8 characters
  if (password.length < 8) {
    return fail(400, "Password must be at least 8 characters");
  }

  // Retrieve the user from the database
  const user = await db.get(`SELECT * FROM users WHERE email = ?`, [email]);

  // If the user does not exist, return 401
  if (!user) {
    return fail(401, "Invalid credentials");
  }

  // Verify the password using PBKDF2
  const hash = await crypto.subtle.pbkdf2(password, user.salt, 2048, 32);

  // If the hashes do not match, return 401
  if (!hash.equals(user.password)) {
    return fail(401, "Invalid credentials");
  }

  // Return the token
  return reply(200, { token: user.id });
}

async function listNotes(request, db) {
  const limit = parseInt(request.query.limit, 10) || 20;
  const offset = parseInt(request.query.offset, 10) || 0;

  const notes = await db.all(`SELECT * FROM notes LIMIT ?, OFFSET ?`, [limit, offset]);

  return reply(200, { notes });
}

async function createNote(request, db) {
  const title = request.body.title;
  const body = request.body.body;

  // Validate the title
  if (!title) {
    return fail(400, "Title is required");
  }

  // Validate the body
  if (!body) {
    return fail(400, "Body is required");
  }

  // Generate a random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Hash the body using PBKDF2
  const hash = await crypto.subtle.pbkdf2(body, salt, 2048, 32);

  // Store the hashed body in the database
  const result = await db.run(`INSERT INTO notes (title, body, salt) VALUES (?, ?, ?)`, [title, hash, salt]);

  // Return the token
  return reply(201, { token: result.lastId });
}

async function readNote(request, db, id) {
  const note = await db.get(`SELECT * FROM notes WHERE id = ?`, [id]);

  // If the note does not exist, return 404
  if (!note) {
    return fail(404, "Note not found");
  }

  return reply(200, note);
}

async function updateNote(request, db, id) {
  const title = request.body.title;
  const body = request.body.body;

  // Validate the title
  if (!title) {
    return fail(400, "Title is required");
  }

  // Validate the body
  if (!body) {
    return fail(400, "Body is required");
  }

  // Retrieve the note from the database
  const note = await db.get(`SELECT * FROM notes WHERE id = ?`, [id]);

  // If the note does not exist, return 404
  if (!note) {
    return fail(404, "Note not found");
  }

  // Update the note
  const updatedNote = await db.run(`UPDATE notes SET title = ?, body = ? WHERE id = ?`, [title, body, id]);

  // Return the updated note
  return reply(200, updatedNote);
}

async function deleteNote(request, db, id) {
  const note = await db.get(`SELECT * FROM notes WHERE id = ?`, [id]);

  // If the note does not exist, return 404
  if (!note) {
    return fail(404, "Note not found");
  }

  // Delete the note
  const deletedNote = await db.run(`DELETE FROM notes WHERE id = ?`, [id]);

  // Return a success message
  return reply(204, { message: "Note deleted successfully" });
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

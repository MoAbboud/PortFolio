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

// The fail function
function fail(status, message) {
  return { status, error: message };
}

// The routes. Each one gets the request, the database, and for /notes/:id the id as a number.

async function signup(request, db) {
  const { email, password } = readJson(request);
  if (!email || !password || email.split('@').length !== 2 || password.length < 8) {
    return fail(400, "Invalid signup details");
  }
  
  // Check if email already exists
  const [row] = await db.get(`SELECT * FROM users WHERE email = ?`, [email]);
  if (row) {
    return fail(409, "Email already exists");
  }
  
  // Create user
  const userId = await db.run(`INSERT INTO users (email, password) VALUES (?, ?)`, [email, password]);
  return reply(201, { id: userId.changes + 1 });
}

async function login(request, db) {
  const { email, password } = readJson(request);
  const token = bearerToken(request);
  
  if (!token) {
    return fail(401, "Unauthorized");
  }
  
  // Check if user exists
  const [row] = await db.get(`SELECT * FROM users WHERE email = ?`, [email]);
  if (!row || row.password !== password) {
    return fail(401, "Invalid credentials");
  }
  
  // Return token
  return reply(200, { token });
}

async function listNotes(request, db) {
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");
  
  const notes = await db.all(`SELECT * FROM notes ORDER BY created_at`);
  return reply(200, { notes });
}

async function createNote(request, db) {
  const { title, body } = readJson(request);
  const token = bearerToken(request);
  
  if (!token) return fail(401, "Unauthorized");
  
  if (!title || !body) {
    return fail(400, "Title and body are required");
  }
  
  // Create note
  const noteId = await db.run(`INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)`, [title, body, request.time, request.time]);
  return reply(201, { id: noteId.changes + 1 });
}

async function readNote(request, db, id) {
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");
  
  const [row] = await db.get(`SELECT * FROM notes WHERE id = ?`, [id]);
  if (!row) return fail(404, "Note not found");
  
  return reply(200, { note: row });
}

async function updateNote(request, db, id) {
  const { title, body } = readJson(request);
  const token = bearerToken(request);
  
  if (!token) return fail(401, "Unauthorized");
  
  if (!title || !body) {
    return fail(400, "Title and body are required");
  }
  
  const [row] = await db.get(`SELECT * FROM notes WHERE id = ?`, [id]);
  if (!row) return fail(404, "Note not found");
  
  // Update note
  const updateResult = await db.run(`UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?`, [title, body, request.time, id]);
  
  if (updateResult.changes === 0) {
    return fail(404, "Note not found");
  }
  
  return reply(200, { note: row });
}

async function deleteNote(request, db, id) {
  const token = bearerToken(request);
  if (!token) return fail(401, "Unauthorized");
  
  const [row] = await db.get(`SELECT * FROM notes WHERE id = ?`, [id]);
  if (!row) return fail(404, "Note not found");
  
  // Delete note
  const deleteResult = await db.run(`DELETE FROM notes WHERE id = ?`, [id]);
  
  if (deleteResult.changes === 0) {
    return fail(404, "Note not found");
  }
  
  return reply(204, {});
}

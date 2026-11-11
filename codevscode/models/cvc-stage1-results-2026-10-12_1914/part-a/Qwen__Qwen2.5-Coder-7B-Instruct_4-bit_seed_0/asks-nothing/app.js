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

async function signup(request, db) {
  const body = JSON.parse(request.body);
  if (!body || !body.email || !body.password) {
    return fail(400, "Email and password are required.");
  }

  if (!/\S+@\S+\.\S+/.test(body.email)) {
    return fail(400, "Invalid email format.");
  }

  if (body.password.length < 8) {
    return fail(400, "Password must be at least 8 characters long.");
  }

  const existingUser = await db.get("SELECT * FROM users WHERE email = ?", [body.email]);
  if (existingUser) {
    return fail(409, "This email already has an account.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.password + new TextDecoder().decode(salt)));
  const hashedPassword = Array.from(keyMaterial).map(b => b.toString(16).padStart(2, '0')).join('');

  const result = await db.run(
    "INSERT INTO users (email, password_hash, salt) VALUES (?, ?, ?)",
    [body.email, hashedPassword, salt]
  );

  return reply(201, { id: result.lastId });
}

async function login(request, db) {
  const body = JSON.parse(request.body);
  if (!body || !body.email || !body.password) {
    return fail(400, "Email and password are required.");
  }

  const user = await db.get("SELECT * FROM users WHERE email = ?", [body.email]);
  if (!user) {
    return fail(401, "Wrong email or password.");
  }

  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.password + new TextDecoder().decode(user.salt)));
  const hashedPassword = Array.from(keyMaterial).map(b => b.toString(16).padStart(2, '0')).join('');
  if (hashedPassword !== user.password_hash) {
    return fail(401, "Wrong email or password.");
  }

  const token = generateToken(user.id);
  return reply(200, { token });
}

async function listNotes(request, db) {
  const token = request.headers.authorization?.split(' ')[1];
  if (!token) return fail(401, "Authentication required.");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Invalid token.");

  const notes = await db.all("SELECT * FROM notes WHERE user_id = ?", [userId]);
  return reply(200, { notes });
}

async function createNote(request, db) {
  const token = request.headers.authorization?.split(' ')[1];
  if (!token) return fail(401, "Authentication required.");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Invalid token.");

  const body = JSON.parse(request.body);
  if (!body || !body.title || !body.body) {
    return fail(400, "Title and body are required.");
  }

  const result = await db.run(
    "INSERT INTO notes (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [userId, body.title, body.body, request.time, request.time]
  );

  const note = await db.get("SELECT * FROM notes WHERE id = ?", [result.lastId]);
  return reply(201, note);
}

async function readNote(request, db, id) {
  const token = request.headers.authorization?.split(' ')[1];
  if (!token) return fail(401, "Authentication required.");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Invalid token.");

  const note = await db.get("SELECT * FROM notes WHERE id = ? AND user_id = ?", [id, userId]);
  if (!note) {
    return fail(404, "Note not found.");
  }

  return reply(200, note);
}

async function updateNote(request, db, id) {
  const token = request.headers.authorization?.split(' ')[1];
  if (!token) return fail(401, "Authentication required.");

  const userId = getUserIdFromToken(token);
  if (!userId) return fail(401, "Invalid token.");

  const body = JSON.parse(request.body);
  if (!body || !body.title || !body.body) {
    return fail(400, "Title and body are required.");
  }

  const note = await db.get("SELECT * FROM notes WHERE id = ? AND user_id = ?", [id, userId]);
  if (!note) {
    return fail(404, "Note not found.");
  }

  await db.run(
    "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?",
    [body.title, body.body, request.time, id]
  );

  const updatedNote = await db.get("SELECT * FROM notes WHERE id = ?", [id]);
  return reply(200, updatedNote);
}

async function deleteNote(request, db, id) {
  const token = request.headers.authorization?.split(' ')[1];
  if (!token) return fail(401, "Authentication required.");

  const userId = getUserIdFromToken(userId);
  if (!userId) return fail(401, "Invalid token.");

  const note = await db.get("SELECT * FROM notes WHERE id = ? AND user_id = ?", [id, userId]);
  if (!note) {
    return fail(404, "Note not found.");
  }

  await db.run("DELETE FROM notes WHERE id = ?", [id]);
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
  // Simple JWT generation for demonstration purposes
  const payload = { userId };
  const secret = "secret"; // Should be securely stored and rotated
  const encodedPayload = encodeURIComponent(JSON.stringify(payload)).replace(/%([0-9A-F]{2})/g, function(match, p1) {
    return String.fromCharCode('0x' + p1);
  });
  const signature = encodeURIComponent(crypto.subtle.digestSync("SHA-256", new TextEncoder().encode(encodedPayload + secret))).replace(/%([0-9A-F]{2})/g, function(match, p1) {
    return String.fromCharCode('0x' + p1);
  });
  return `${encodedPayload}.${signature}`;
}

function getUserIdFromToken(token) {
  // Simple JWT parsing for demonstration purposes
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const decodedPayload = decodeURIComponent(parts[0].replace(/-/g, '+').replace(/_/g, '/').split('').map(function(c) {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));

  try {
    const payload = JSON.parse(decodedPayload);
    return payload.userId;
  } catch {
    return null;
  }
}

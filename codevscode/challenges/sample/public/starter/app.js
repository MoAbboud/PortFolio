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
  return notBuilt();
}

async function login(request, db) {
  return notBuilt();
}

async function listNotes(request, db) {
  return notBuilt();
}

async function createNote(request, db) {
  return notBuilt();
}

async function readNote(request, db, id) {
  return notBuilt();
}

async function updateNote(request, db, id) {
  return notBuilt();
}

async function deleteNote(request, db, id) {
  return notBuilt();
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

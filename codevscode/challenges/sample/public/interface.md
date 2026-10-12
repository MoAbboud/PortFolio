# Team notes - interface

The routes, the shapes and the status codes are fixed: every test, yours and your opponent's,
calls them exactly as written here. Everything behind them is yours to decide. The client may
add to this list when you ask them things.

## The app shape

```
app.js       export async function handle(request, db) -> response
schema.sql   your tables, run into a fresh database before anything else
index.html   a small page that uses the routes below
```

`request` is a plain object:

| Field | Example |
| --- | --- |
| `method` | `"POST"` |
| `path` | `"/notes/7"` |
| `query` | `{ "limit": "5" }` - always strings |
| `headers` | `{ "authorization": "Bearer ..." }` - names in lower case |
| `body` | the raw text sent, `""` if none. Parse it yourself |
| `time` | the current time in milliseconds. Use this, never `Date.now()` |

Return `{ status, body }`. `body` is anything that turns into JSON, or nothing at all for a
204.

`db` is a SQLite database:

| Call | Returns |
| --- | --- |
| `db.all(sql, params)` | every row, as objects |
| `db.get(sql, params)` | the first row, or `undefined` |
| `db.run(sql, params)` | `{ changes, lastId }` |

`params` is an array for `?` placeholders, or an object for `:name` placeholders.

Rules:

- `app.js` imports nothing. `crypto` (the Web Crypto API: `crypto.subtle`,
  `crypto.getRandomValues`) and the usual JavaScript built-ins are there.
- Keep every piece of state in the database. Your module may be loaded fresh at any moment,
  and anything kept in a variable is gone when it is.
- An uncaught error becomes a 500.

## Routes

Every error response has the shape `{ "error": "a message a person can read" }`.

### `POST /signup`

Body: `{ "email": "...", "password": "..." }`. The email must contain an `@`; the password must
be at least 8 characters.

| Status | When | Body |
| --- | --- | --- |
| 201 | Signed up | `{ "id": 1 }` |
| 400 | Body missing, not JSON, or a field missing or invalid | error |
| 409 | That email already has an account | error |

### `POST /login`

Body: `{ "email": "...", "password": "..." }`.

| Status | When | Body |
| --- | --- | --- |
| 200 | Right email and password | `{ "token": "..." }` |
| 400 | Body missing, not JSON, or a field missing | error |
| 401 | Wrong email or password | error |

Every other route needs the token, sent as `Authorization: Bearer <token>`. Without a valid
one, the answer is 401.

### A note

```
{ "id": 3, "title": "Shopping", "body": "milk, eggs", "created_at": 1767225600000, "updated_at": 1767225600000 }
```

`created_at` and `updated_at` are `request.time` values. A title is required and cannot be
blank; a body is a string and may be empty.

### `POST /notes`

Body: `{ "title": "...", "body": "..." }`. Answers 201 with the note, or 400.

### `GET /notes`

Answers 200 with `{ "notes": [ ...notes ] }`: the caller's notes.

### `GET /notes/:id`

Answers 200 with the note, or 404.

### `PUT /notes/:id`

Body: `{ "title": "...", "body": "..." }`, both required. Answers 200 with the changed note,
400, or 404.

### `DELETE /notes/:id`

Answers 204 with no body, or 404.

Any other path answers 404.

-- Your tables go here. This file runs into a fresh SQLite database before the app starts.
-- SQLite: INTEGER PRIMARY KEY, TEXT, UNIQUE, CREATE INDEX; times are INTEGER milliseconds.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

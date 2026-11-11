-- Your tables go here. This file runs into a fresh SQLite database before the app starts.
-- SQLite: INTEGER PRIMARY KEY, TEXT, UNIQUE, CREATE INDEX; times are INTEGER milliseconds.

CREATE TABLE users (
  email TEXT PRIMARY KEY,
  password_hash BLOB,
  salt BLOB,
  token TEXT
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

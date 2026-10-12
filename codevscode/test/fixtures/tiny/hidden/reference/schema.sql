CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT NOT NULL);
CREATE INDEX words_by_word ON words (word);

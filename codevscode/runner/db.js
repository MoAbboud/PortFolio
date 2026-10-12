// The database an app is handed. A thin layer over a sql.js database that records every
// query the app makes, so an efficiency test can count them and ask SQLite how each one ran.
//
// Shared by the browser and Node: nothing here may import a Node module. test/rules.test.js
// checks that.

/**
 * Wrap a sql.js Database.
 *
 * Returns `db`, the only thing the app sees, and `log`, the queries it made in order. The
 * app cannot reach the raw database through `db`, so it cannot run a query that escapes the
 * log.
 */
export function wrapDatabase(raw) {
  const log = [];

  function query(sql, params) {
    if (typeof sql !== "string") {
      throw new TypeError("db: the query must be a string");
    }
    log.push({ sql, params: params === undefined ? [] : params });
    const statement = raw.prepare(sql);
    try {
      if (params !== undefined) statement.bind(params);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  const db = Object.freeze({
    /** Every row the query returns, as plain objects. */
    all: (sql, params) => query(sql, params),
    /** The first row, or undefined. */
    get: (sql, params) => query(sql, params)[0],
    /** Run a statement. Returns how many rows it changed and the last inserted rowid. */
    run(sql, params) {
      query(sql, params);
      return { changes: raw.getRowsModified(), lastId: lastInsertId(raw) };
    },
  });

  return { db, log };
}

function lastInsertId(raw) {
  const result = raw.exec("SELECT last_insert_rowid()");
  return result.length ? result[0].values[0][0] : null;
}

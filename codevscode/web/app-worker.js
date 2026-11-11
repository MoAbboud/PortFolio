// The player's app, running in the browser on the same runner and the same SQLite the judge
// uses. A worker, so an endless loop in the app freezes this thread and not the page: the
// workspace waits a few seconds, then throws the worker away and starts a new one.
//
// A classic worker, not a module one, because sql.js ships as a plain script for importScripts;
// the shared runner modules are loaded with import().

importScripts("/static/web/vendor/sql-wasm-browser.js");

let SQL;
let runner;
const ready = (async () => {
  SQL = await initSqlJs({ locateFile: (file) => `/static/web/vendor/${file}` });
  const [db, check, source] = await Promise.all([
    import("/static/runner/db.js"),
    import("/static/runner/check.js"),
    import("/static/runner/source.js"),
  ]);
  runner = { wrapDatabase: db.wrapDatabase, checkApp: check.checkApp, checkAppSource: source.checkAppSource };
})();

let current = null;

function loader(source) {
  const problems = runner.checkAppSource(source);
  return async () => {
    if (problems.length) throw new Error(problems.join(" "));
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
      return await import(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}

onmessage = async ({ data }) => {
  const reply = (message) => postMessage({ id: data.id, ...message });
  try {
    await ready;
    if (data.type === "load") {
      if (current) current.raw.close();
      current = null;
      const raw = new SQL.Database();
      try {
        raw.exec(data.files["schema.sql"] || "");
      } catch (error) {
        throw new Error(`schema.sql does not run: ${error.message}`);
      }
      let app;
      try {
        app = await loader(data.files["app.js"] || "")();
      } catch (error) {
        throw new Error(`app.js does not load: ${error.message}`);
      }
      if (!app || typeof app.handle !== "function") throw new Error("app.js does not export a function called handle.");
      current = { app, raw, db: runner.wrapDatabase(raw).db };
      reply({ ok: true });
    } else if (data.type === "request") {
      if (!current) throw new Error("The app is not running. Press Run.");
      let response;
      try {
        response = await current.app.handle(Object.freeze(data.request), current.db);
      } catch (error) {
        reply({ ok: true, crashed: String(error && error.message ? error.message : error) });
        return;
      }
      reply({ ok: true, response: JSON.parse(JSON.stringify(response ?? null)) });
    } else if (data.type === "check") {
      const problems = await runner.checkApp({
        SQL,
        loadApp: loader(data.files["app.js"] || ""),
        schema: data.files["schema.sql"] || "",
        smoke: data.smoke,
      });
      reply({ ok: true, problems });
    }
  } catch (error) {
    reply({ ok: false, error: String(error && error.message ? error.message : error) });
  }
};

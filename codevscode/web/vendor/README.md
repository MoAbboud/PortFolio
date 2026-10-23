# Vendored for the browser

`sql-wasm-browser.js` and `sql-wasm-browser.wasm` are sql.js 1.14.2's browser build, copied
from `node_modules/sql.js/dist/`. The workspace runs a player's app in the browser on the same
SQLite the judge uses, so the two must be the same version: `test/vendor.test.js` fails when
they drift. To update, `npm install sql.js@<version>` and copy both files again. MIT licence
(`sql.js-LICENSE`).

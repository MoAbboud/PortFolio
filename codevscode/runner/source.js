// Rules about an app's source that are checked before it runs, the same way everywhere.
//
// Shared by the browser and Node: nothing here may import a Node module.

/**
 * Problems with an app.js, as sentences a player can act on. Empty when there are none.
 *
 * The interface says app.js imports nothing. In the browser an import would simply fail;
 * in Node it could reach the filesystem, so it is refused before the code is loaded. The
 * judge's container is the real wall - this is the early, readable warning.
 */
export function checkAppSource(source) {
  const problems = [];
  const code = stripCommentsAndStrings(source);
  if (/(^|[;\s])import\s*[\w{*'"]/m.test(code) || /\bimport\s*\(/.test(code)) {
    problems.push("app.js must not import anything.");
  }
  if (/\brequire\s*\(/.test(code)) {
    problems.push("app.js must not use require().");
  }
  // A missing handle export is not checked here: the runner reports it after loading, from
  // the module itself, which no text pattern can get wrong.
  return problems;
}

// Good enough to keep words inside comments and string literals from tripping the checks
// above. Template literals are blanked whole, including their ${} parts.
function stripCommentsAndStrings(source) {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`/g,
    (match) => (match.startsWith("/") ? " " : '""'),
  );
}

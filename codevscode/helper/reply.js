// Turning a helper's reply into files. Small models do not follow a format exactly, so this is
// forgiving about how a file is named and strict about which files may be written.
//
// Shared by the browser and Node: nothing here may import a Node module.

const BY_LANG = { js: "app.js", javascript: "app.js", mjs: "app.js", sql: "schema.sql", sqlite: "schema.sql", html: "index.html" };

/**
 * The files in a reply, and what it said besides.
 *
 * A code block belongs to a file when, in order of trust:
 * 1. its first line is a marker such as `// file: app.js` (what the helper is asked for);
 * 2. its fence names the file (```js app.js);
 * 3. the line just before it names the file (`app.js:`, `**app.js**`, `### schema.sql`);
 * 4. its language is the only file of that language (```sql -> schema.sql).
 *
 * Blocks for files not in `allowed`, and blocks that cannot be placed, are skipped and listed.
 * When two blocks name one file, the later wins.
 */
export function parseReply(text, allowed) {
  const files = {};
  const skipped = [];
  const blocks = /(^|\n)([^\n]*)\n?```([^\n`]*)\n([\s\S]*?)\n?```/g;
  let prose = text;
  for (const match of text.matchAll(blocks)) {
    const [whole, , lineBefore, info, rawBody] = match;
    const [lang = "", fenceName] = info.trim().split(/\s+/);
    let body = rawBody;
    let name = null;

    const marker = /^\s*(?:\/\/|--|<!--|#)\s*file:\s*([\w./-]+)\s*(?:-->)?\s*$/.exec(body.split("\n")[0] ?? "");
    if (marker) {
      name = marker[1];
      body = body.split("\n").slice(1).join("\n");
    } else if (fenceName && /\.\w+$/.test(fenceName)) {
      name = fenceName;
    } else if (/^\s*[`*#\s]*([\w-]+\.(?:js|sql|html))[`*:\s]*$/.test(lineBefore)) {
      name = /([\w-]+\.(?:js|sql|html))/.exec(lineBefore)[1];
    } else if (BY_LANG[lang.toLowerCase()]) {
      name = BY_LANG[lang.toLowerCase()];
    }

    if (name && allowed.includes(name)) {
      files[name] = body.replace(/\s+$/, "") + "\n";
      prose = prose.replace(whole, `${whole.startsWith("\n") ? "\n" : ""}${lineBefore}\n[${name}]`);
    } else {
      skipped.push(name ?? `a ${lang || "plain"} block`);
    }
  }
  return { files, prose: prose.trim(), skipped };
}

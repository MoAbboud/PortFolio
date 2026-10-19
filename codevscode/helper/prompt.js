// What the helper model is told on every turn. One copy, shared by the player's browser and
// by the harness that measures models (through tools/helper.mjs), so a model is measured on
// exactly the prompt it will get in the game.
//
// Shared by the browser and Node: nothing here may import a Node module.

/** Roughly four characters per token for code and English; only used to trim history. */
export const CHARS_PER_TOKEN = 4;

const FENCE_LANG = { "app.js": "js", "schema.sql": "sql", "index.html": "html" };
const MARKER = { "app.js": "// file: app.js", "schema.sql": "-- file: schema.sql", "index.html": "<!-- file: index.html -->" };

/** The fence language and first-line marker for a file the helper writes. */
export function fenceFor(name) {
  const lang = FENCE_LANG[name] ?? (name.endsWith(".js") ? "js" : "");
  const marker = MARKER[name] ?? `// file: ${name}`;
  return { lang, marker };
}

/**
 * The messages for one helper turn, in chat format.
 *
 * - `name`: what the player calls their helper.
 * - `brief`, `iface`: the challenge's public brief and interface.
 * - `revealed`: the client's answers the player has unlocked, as strings.
 * - `files`: the app's current files, name -> text. Always sent whole: the helper edits what
 *   is actually there, not what it remembers writing.
 * - `history`: earlier turns, `{ role, content }`. Only the player's earlier messages are used.
 * - `message`: what the player just said.
 * - `budgetTokens`: earlier messages are dropped, oldest first, to fit. Files never are.
 *
 * Every turn is one system message and one player message. The helper's earlier replies are
 * never replayed as assistant turns: the files show what it did. Stage 1's second run replayed
 * them with their code shortened to "[wrote app.js]", and small models copied that format and
 * answered with placeholders instead of code - every turn after the first wrote nothing.
 */
export function buildMessages({ name, brief, iface, revealed = [], files, history = [], message, budgetTokens = 12000 }) {
  const earlier = history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const fixed = systemMessage({ name, brief, iface, revealed, files, asked: [] }).length + message.length;
  const budget = budgetTokens * CHARS_PER_TOKEN - fixed;
  const asked = [];
  let used = 0;
  for (let i = earlier.length - 1; i >= 0; i--) {
    if (used + earlier[i].length > budget) break;
    asked.unshift(earlier[i]);
    used += earlier[i].length;
  }
  return [
    { role: "system", content: systemMessage({ name, brief, iface, revealed, files, asked }) },
    { role: "user", content: message },
  ];
}

function systemMessage({ name, brief, iface, revealed, files, asked }) {
  const names = Object.keys(files);
  const example = fenceFor("app.js");
  const fileBlocks = names
    .map((file) => {
      const { lang, marker } = fenceFor(file);
      return "```" + lang + "\n" + marker + "\n" + files[file].replace(/\s+$/, "") + "\n```";
    })
    .join("\n\n");
  const told = revealed.length ? revealed.map((answer) => `- ${answer}`).join("\n") : "Nothing yet.";
  return [
    `You are ${name}, a coding helper. You and the player are building the app described below.`,
    "",
    "How to answer:",
    `- Write every file you change in full, each in its own fenced code block whose first line names the file, like:`,
    "```" + example.lang + "\n" + example.marker + "\n...\n```",
    `- The files are: ${names.join(", ")}. Do not write any other file.`,
    "- Follow the interface exactly: the routes, the status codes and the shapes.",
    "- Build on the files as they are: keep what works, fill in what is missing.",
    "- app.js imports nothing - no crypto module, no database library, no other file. crypto is",
    "  already there as the Web Crypto API (crypto.subtle, crypto.getRandomValues), and the",
    "  database is the db passed to handle().",
    "- request.method is upper case. request.body is text: parse it before use.",
    "- Use request.time for the time, never Date.now().",
    "- Keep any explanation short. The player reads your code.",
    "",
    "## The brief",
    brief.trim(),
    "",
    "## The interface",
    iface.trim(),
    "",
    "## What the client has told the player",
    told,
    "",
    ...(asked.length
      ? ["## What the player asked for before (already worked on - the files show the result)", ...asked.map((m) => `- ${m}`), ""]
      : []),
    "## The files as they are now",
    fileBlocks,
  ].join("\n");
}

/**
 * A helper reply shortened for display or logs: the prose, with each file block replaced by a
 * note of which file was written. Not sent back to the model - see buildMessages.
 */
export function condenseReply(text) {
  return text.replace(/```[^\n]*\n[\s\S]*?```/g, (block) => {
    const name = fileNameOf(block);
    return name ? `[wrote ${name}]` : "[code]";
  });
}

function fileNameOf(block) {
  const match = /(?:\/\/|--|<!--|#)\s*file:\s*([\w./-]+)/.exec(block) ?? /^```[\w-]*\s+([\w-]+\.\w+)/.exec(block);
  return match ? match[1] : null;
}

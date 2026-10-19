// Planting bugs automatically. Each operator is one kind of mistake a person or a helper
// really makes - a query built from text, a missing ownership check, an uncapped limit - and
// applies it at every place in an app where it fits, by splicing the source so the rest of the
// file is untouched.
//
// Three uses, one tool:
// - the analyzer's training data: a mutant is labelled by construction (we know what we broke),
//   and confirmed by the hidden tests (which categories actually failed);
// - challenge authoring: a mutant no hidden test catches is a gap in the tests, or a change that
//   does not matter - either way the author should look;
// - planting the house app's bugs, instead of writing each one by hand.

import { parse } from "acorn";
import { ancestor } from "acorn-walk";

/** The operators, the category each one declares, and what it does. */
export const OPERATORS = Object.freeze({
  "sql-from-text": { category: "security", about: "a query parameter pasted into the SQL text" },
  "drop-condition": { category: "security", about: "an AND ... = ? condition removed from a query" },
  "weak-random": { category: "security", about: "crypto.getRandomValues no longer called" },
  uncap: { category: "efficiency", about: "Math.min(value, CAP) replaced by the value" },
  "drop-index": { category: "efficiency", about: "a CREATE INDEX removed from the schema" },
  "drop-lowercase": { category: "correctness", about: ".toLowerCase() removed" },
  "flip-boundary": { category: "correctness", about: "< and <=, or > and >=, swapped" },
  "drop-await": { category: "correctness", about: "an await removed" },
  "wrong-status": { category: "correctness", about: "a status code changed to a neighbouring one" },
  "drop-unique": { category: "correctness", about: "a UNIQUE constraint removed from the schema" },
  "drop-guard": { category: "practicality", about: "an if (...) return ... guard removed" },
  "drop-trim": { category: "practicality", about: ".trim() removed" },
});

const STATUS_SWAP = { 200: 201, 201: 200, 204: 200, 400: 422, 401: 403, 403: 401, 404: 400, 409: 400, 429: 401 };
const DB_METHODS = new Set(["all", "get", "run"]);

/** Parse app.js the way the runner will load it. Throws on a syntax error. */
export function parseApp(source) {
  return parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
}

/**
 * Every mutant of an app, as `{ id, operator, category, file, start, end, replacement, line }`.
 * `files` is name -> text; app.js and schema.sql are mutated. Mutants of app.js that would not
 * parse are dropped, so every one can at least be loaded.
 */
export function mutants(files) {
  const found = [];
  if (files["app.js"]) found.push(...appMutants(files["app.js"]));
  if (files["schema.sql"]) found.push(...schemaMutants(files["schema.sql"]));
  const seen = new Map();
  return found
    .filter((m) => m.file !== "app.js" || parses(applyMutant(files, m)["app.js"]))
    .map((m) => {
      const key = `${m.operator}:${m.file}:${m.line}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { id: `${key}${n > 1 ? `.${n}` : ""}`, ...m, category: OPERATORS[m.operator].category };
    });
}

/** The files with one mutant applied. */
export function applyMutant(files, mutant) {
  const text = files[mutant.file];
  return { ...files, [mutant.file]: text.slice(0, mutant.start) + mutant.replacement + text.slice(mutant.end) };
}

/**
 * The top-level function around a position in app.js, as `{ start, end, name }`, or the whole
 * file when the position is outside every function. This is the window the classifier reads.
 */
export function enclosingFunction(source, position) {
  const program = parseApp(source);
  for (const statement of program.body) {
    const node = statement.type === "ExportNamedDeclaration" && statement.declaration ? statement.declaration : statement;
    if (statement.start <= position && position < statement.end) {
      if (node.type === "FunctionDeclaration") return { start: statement.start, end: statement.end, name: node.id.name };
      if (node.type === "VariableDeclaration") {
        const declarator = node.declarations.find((d) => d.start <= position && position < d.end);
        if (declarator && /Function/.test(declarator.init?.type ?? "")) {
          return { start: statement.start, end: statement.end, name: declarator.id.name };
        }
      }
    }
  }
  return { start: 0, end: source.length, name: null };
}

function parses(source) {
  try {
    parseApp(source);
    return true;
  } catch {
    return false;
  }
}

function appMutants(source) {
  const program = parseApp(source);
  const out = [];
  const text = (node) => source.slice(node.start, node.end);
  const add = (operator, node, start, end, replacement) =>
    out.push({ operator, file: "app.js", start, end, replacement, line: node.loc.start.line });

  ancestor(program, {
    CallExpression(node, _state, ancestors) {
      const callee = node.callee;
      const method = callee.type === "MemberExpression" && !callee.computed ? callee.property.name : null;

      // db.all / db.get / db.run with a SQL string and an array of parameters.
      if (DB_METHODS.has(method) && isString(node.arguments[0]) && node.arguments[1]?.type === "ArrayExpression") {
        const [sqlNode, paramsNode] = node.arguments;
        const sql = sqlNode.value;
        const params = paramsNode.elements;
        const marks = [...sql.matchAll(/\?/g)].map((m) => m.index);
        if (marks.length === params.length) {
          // sql-from-text: one parameter at a time pasted into the text.
          marks.forEach((at, i) => {
            const pasted = templateText(sql.slice(0, at)) + "'${" + text(params[i]) + "}'" + templateText(sql.slice(at + 1));
            add("sql-from-text", node, sqlNode.start, paramsNode.end, withParams("`" + pasted + "`", params.filter((_, j) => j !== i), text));
          });
          // drop-condition: one AND column = ? removed, with its parameter.
          for (const match of sql.matchAll(/\s+AND\s+\w+\s*=\s*\?/gi)) {
            const index = marks.indexOf(match.index + match[0].length - 1);
            const kept = params.filter((_, j) => j !== index);
            const newSql = sql.slice(0, match.index) + sql.slice(match.index + match[0].length);
            add("drop-condition", node, sqlNode.start, paramsNode.end, withParams(JSON.stringify(newSql), kept, text));
          }
        }
      }

      if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
        // uncap: Math.min(value, CAP) -> value
        if (callee.object.name === "Math" && method === "min" && node.arguments.length === 2) {
          const variable = node.arguments.filter((arg) => !isConstantLike(arg));
          if (variable.length === 1) add("uncap", node, node.start, node.end, text(variable[0]));
        }
        // weak-random: crypto.getRandomValues(buffer) -> buffer, all zeros
        if (callee.object.name === "crypto" && method === "getRandomValues" && node.arguments.length === 1) {
          add("weak-random", node, node.start, node.end, text(node.arguments[0]));
        }
      }

      // drop-lowercase, drop-trim: x.toLowerCase() -> x
      if (node.arguments.length === 0 && (method === "toLowerCase" || method === "trim")) {
        add(method === "trim" ? "drop-trim" : "drop-lowercase", node, node.start, node.end, text(callee.object));
      }

      // wrong-status: reply(404, ...) / fail(404, ...)
      const first = node.arguments[0];
      if (callee.type === "Identifier" && first?.type === "Literal" && STATUS_SWAP[first.value] && /^(reply|fail|json|respond|send)$/.test(callee.name)) {
        add("wrong-status", first, first.start, first.end, String(STATUS_SWAP[first.value]));
      }
    },

    Property(node) {
      // wrong-status: { status: 404 }
      const key = node.key.type === "Identifier" ? node.key.name : node.key.value;
      if (key === "status" && node.value.type === "Literal" && STATUS_SWAP[node.value.value]) {
        add("wrong-status", node.value, node.value.start, node.value.end, String(STATUS_SWAP[node.value.value]));
      }
    },

    BinaryExpression(node) {
      const swap = { "<": "<=", "<=": "<", ">": ">=", ">=": ">" }[node.operator];
      if (!swap) return;
      const between = source.slice(node.left.end, node.right.start);
      const at = node.left.end + between.indexOf(node.operator);
      add("flip-boundary", node, at, at + node.operator.length, swap);
    },

    AwaitExpression(node) {
      add("drop-await", node, node.start, node.end, text(node.argument));
    },

    IfStatement(node) {
      if (node.alternate) return;
      const body = node.consequent.type === "BlockStatement" ? node.consequent.body : [node.consequent];
      if (body.length === 1 && body[0].type === "ReturnStatement") add("drop-guard", node, node.start, node.end, "");
    },
  });
  return out;
}

function schemaMutants(sql) {
  const out = [];
  const lineOf = (index) => sql.slice(0, index).split("\n").length;
  for (const match of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*;/gi)) {
    out.push({ operator: "drop-index", file: "schema.sql", start: match.index, end: match.index + match[0].length, replacement: "", line: lineOf(match.index) });
  }
  for (const match of sql.matchAll(/(?<!CREATE\s+)\bUNIQUE\b(?!\s+INDEX)/gi)) {
    let start = match.index;
    while (start > 0 && sql[start - 1] === " ") start -= 1;
    out.push({ operator: "drop-unique", file: "schema.sql", start, end: match.index + match[0].length, replacement: "", line: lineOf(match.index) });
  }
  return out;
}

function isString(node) {
  return node?.type === "Literal" && typeof node.value === "string";
}

function isConstantLike(node) {
  return (node.type === "Literal" && typeof node.value === "number") || (node.type === "Identifier" && /^[A-Z][A-Z0-9_]*$/.test(node.name));
}

/** Text made safe to sit inside a template literal. */
function templateText(text) {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function withParams(sqlSource, params, text) {
  return params.length ? `${sqlSource}, [${params.map(text).join(", ")}]` : sqlSource;
}

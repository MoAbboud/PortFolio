// Node's side of loading a challenge and running tests: reading files, turning an app's
// source into a module, and initialising sql.js. The running itself is runner/, which the
// browser shares.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import initSqlJs from "sql.js";

import { runTests } from "../runner/runner.js";
import { checkAppSource } from "../runner/source.js";

let sqlModule;

/** The sql.js module, initialised once per process. */
export async function sql() {
  sqlModule ??= await initSqlJs();
  return sqlModule;
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/** An app's files from a folder, as name -> text. A missing file is an empty string. */
export async function readApp(dir, names = ["app.js", "schema.sql", "index.html"]) {
  const files = {};
  for (const name of names) {
    try {
      files[name] = await readFile(path.join(dir, name), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files[name] = "";
    }
  }
  return files;
}

let loads = 0;

/**
 * A function that loads the app fresh every call, from its source text rather than a file,
 * so an app with planted bugs never has to be written to disk. The source must pass
 * checkAppSource first: a data: URL cannot import a relative file, but it can import a Node
 * built-in, and the interface forbids imports.
 */
export function appLoader(source) {
  const problems = checkAppSource(source);
  return async () => {
    if (problems.length) throw new Error(problems.join(" "));
    // A unique trailing comment makes every load a new module, with fresh top-level state.
    const text = `${source}\n// load ${++loads}\n`;
    return import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
  };
}

/** Every test from every .js file in a folder, in file name order. */
export async function loadTests(dir) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".js")).sort();
  const tests = [];
  for (const name of names) {
    const module = await import(pathToFileURL(path.join(dir, name)).href);
    if (!Array.isArray(module.default)) {
      throw new Error(`${name} must export an array of tests as its default`);
    }
    tests.push(...module.default);
  }
  return tests;
}

export async function loadModuleArray(file) {
  const module = await import(pathToFileURL(file).href);
  if (!Array.isArray(module.default)) throw new Error(`${path.basename(file)} must export an array as its default`);
  return module.default;
}

/** Run tests against an app given as name -> text. */
export async function runOnApp(files, tests) {
  return runTests({
    SQL: await sql(),
    loadApp: appLoader(files["app.js"] ?? ""),
    schema: files["schema.sql"] ?? "",
    tests,
  });
}

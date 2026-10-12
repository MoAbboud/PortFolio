// Planted bugs are written as edits to the reference app: find this exact text in this file,
// replace it with that. Plain string edits rather than diffs, because the same code has to
// apply them in the browser and in Node, and because an edit that no longer matches the
// reference should fail loudly rather than apply somewhere nearby.
//
// Shared by the browser and Node: nothing here may import a Node module.

/**
 * Apply edits to a map of file name -> contents. Returns a new map; the input is untouched.
 * Throws if any `find` does not occur exactly once in its file.
 */
export function applyEdits(files, edits) {
  const out = { ...files };
  for (const { file, find, replace } of edits) {
    if (!(file in out)) throw new Error(`edit names ${file}, which is not one of the app's files`);
    const count = out[file].split(find).length - 1;
    if (count !== 1) {
      throw new Error(`edit to ${file} must find its text exactly once, found it ${count} times: ${JSON.stringify(find.slice(0, 60))}`);
    }
    out[file] = out[file].replace(find, () => replace);
  }
  return out;
}

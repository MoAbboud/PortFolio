// The words that belong to a step.
//
// Pure module. **This was the script panel, and reading a script was cancelled**
// - see 06-context.md. Trail no longer tokenises a narration, resolves its
// nouns against a dictionary, or offers what it finds: the script lives outside
// the app, and objects are placed by hand from the library.
//
// What is left is the part the step editor uses. A step carries a note saying
// what it is about, the notes are only ever the steps read in order, and
// cutting one in two is how a long note becomes stages.

/**
 * Cut a step in two at a character offset.
 *
 * The script is stored split across the steps and is exactly their text joined
 * together, so it can never drift out of step with the structure and there are
 * no character offsets stored anywhere to be invalidated by an edit.
 */
export function splitStep(steps, index, offset) {
  const step = steps[index];
  if (!step) return steps;
  const text = step.text ?? '';
  const at = Math.max(0, Math.min(text.length, offset));
  // Splitting at either end would make an empty step, which is a step that
  // holds no words and still costs a hold and a flight.
  if (at === 0 || at === text.length) return steps;

  const before = { ...step, text: text.slice(0, at) };
  // The new step starts where the camera left off; the framing is copied so it
  // is a real step immediately, and moving it is the user's next act anyway.
  const after = { ...step, text: text.slice(at), framing: { ...step.framing } };
  return [...steps.slice(0, index), before, after, ...steps.slice(index + 1)];
}

/** Put a step back together with the one after it. */
export function mergeStep(steps, index) {
  const step = steps[index];
  const next = steps[index + 1];
  if (!step || !next) return steps;
  const a = step.text ?? '';
  const b = next.text ?? '';
  // A space only where there is not one already. Splitting keeps every
  // character, including the space after a full stop, so merging must put the
  // two halves back exactly rather than inventing a second one.
  const gap = !a || !b || /\s$/.test(a) || /^\s/.test(b) ? '' : ' ';
  const joined = a + gap + b;
  return [
    ...steps.slice(0, index),
    { ...step, text: joined },
    ...steps.slice(index + 2),
  ];
}

/** The whole script, which is only ever the steps read in order. */
export const scriptOf = (steps = []) => steps.map((s) => s.text ?? '').filter(Boolean).join('\n\n');

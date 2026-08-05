// The script, and what it asks for.
//
// Pure module. This is the app's concept in one file: paste the words, and
// Trail says which of them it can build. Nothing is placed and nothing is
// composed - finding is automatic because it is tedious, and placing is manual
// because it is the part that makes the video yours.
//
// **There is no language processing here, and that is deliberate.** No stemming,
// no part-of-speech tagging, no stopword list, no grammar, no model. A word is
// a noun worth staging exactly when the library holds something to stage it
// with, so the dictionary *is* the noun detector. A word that does not resolve
// could not have been built anyway.
//
// The dictionary comes from the library's own model names, plus a file of
// synonyms, because model names are literal and scripts are not: nobody writes
// "husky" when they mean a dog.

// Words that are capitalised for a reason other than being somebody's name.
// Short, and only here to keep the cast list from filling up with sentence
// furniture; it is not a stopword list and nothing else consults it.
const NOT_A_NAME = new Set([
  'i', 'a', 'the', 'and', 'but', 'or', 'so', 'then', 'now', 'later', 'after',
  'before', 'when', 'while', 'they', 'he', 'she', 'we', 'you', 'it', 'this',
  'that', 'there', 'here', 'his', 'her', 'their', 'my', 'our', 'your',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]);

/**
 * Every word of a script, with enough about each to judge it.
 *
 * Split on anything that is not a letter or an apostrophe, which is the whole
 * of the parsing. `opens` says the word began a sentence, because a capital
 * there means nothing - it is the one piece of context name detection needs.
 */
export function tokenise(text) {
  const out = [];
  const source = String(text ?? '');
  let opens = true;
  const pattern = /[A-Za-z][A-Za-z']*/g;
  let match = pattern.exec(source);
  let last = 0;

  while (match) {
    // Anything between the previous word and this one that ends a sentence.
    const between = source.slice(last, match.index);
    if (/[.!?]/.test(between)) opens = true;
    else if (last > 0 && /\S/.test(between) === false && between.includes('\n\n')) opens = true;

    out.push({
      raw: match[0],
      word: match[0].toLowerCase().replace(/'s$/, ''),
      at: match.index,
      opens,
      capitalised: /^[A-Z]/.test(match[0]),
    });

    opens = false;
    last = match.index + match[0].length;
    match = pattern.exec(source);
  }
  return out;
}

/**
 * Word to models, built from the library rather than written by hand.
 *
 * Every part of a model's name is a way to reach it - `normal-car1` answers to
 * "car" and to its whole name - and the synonym file covers the rest. A word
 * reaching several models is not a problem: the tray offers them and the
 * choice is the user's, which is the rule this whole feature follows.
 */
export function buildLookup(names = [], synonyms = {}) {
  const lookup = new Map();
  const add = (word, model) => {
    const key = String(word).toLowerCase();
    if (!key || key.length < 2) return;
    if (!lookup.has(key)) lookup.set(key, []);
    const found = lookup.get(key);
    if (!found.includes(model)) found.push(model);
  };

  for (const name of names) {
    add(name, name);
    for (const part of String(name).split(/[-_\s]+/)) {
      // Numbers a pack used to tell two models apart say nothing about what
      // the thing is: "car1" is a car, and "1" is not a word.
      const bare = part.replace(/\d+$/, '');
      if (bare.length >= 3) add(bare, name);
    }
  }

  for (const [word, models] of Object.entries(synonyms)) {
    for (const model of [].concat(models)) {
      // A synonym may point at a model that is not in this library. Recording
      // it anyway would offer something unplaceable, so it is dropped.
      if (names.includes(model)) add(word, model);
    }
  }
  return lookup;
}

/**
 * What a script asks for.
 *
 * Three lists, and the split between them is the whole design. Objects are
 * what can be built. Cast are the people the script named. Gaps are words that
 * resolved to nothing, kept **visible rather than silently dropped**, because a
 * gap is a decision - draw it, reword the line, or let the camera look
 * elsewhere - and a decision nobody is shown is a decision nobody makes.
 */
export function resolve(text, lookup = new Map()) {
  const words = tokenise(text);
  const objects = new Map();
  const cast = new Map();
  const gaps = new Map();

  words.forEach((token, order) => {
    const models = lookup.get(token.word);
    if (models?.length) {
      const found = objects.get(token.word) ?? { word: token.word, models, count: 0, first: order };
      found.count++;
      objects.set(token.word, found);
      return;
    }

    // Capitalised, not where a capital means nothing, and not something the
    // library could have built. A heuristic, and offered as one: its failures
    // are a place read as a person, and a person who only ever opens a
    // sentence. Both are visible in a list and both are fixed by clicking.
    if (token.capitalised && !token.opens && !NOT_A_NAME.has(token.word)) {
      const who = cast.get(token.word)
        ?? { name: token.raw.replace(/'s$/, ''), count: 0, first: order };
      who.count++;
      cast.set(token.word, who);
      return;
    }

    const gap = gaps.get(token.word) ?? { word: token.word, count: 0, first: order };
    gap.count++;
    gaps.set(token.word, gap);
  });

  // Ordered by where each first appears, so the tray reads in the order the
  // story introduces things rather than alphabetically.
  const byAppearance = (a, b) => a.first - b.first;
  return {
    objects: [...objects.values()].sort(byAppearance),
    cast: [...cast.values()].sort(byAppearance),
    gaps: [...gaps.values()].sort((a, b) => b.count - a.count || a.first - b.first),
    words: words.length,
  };
}

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

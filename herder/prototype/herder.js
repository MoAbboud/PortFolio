// herder, the parts of it that run without weights.
//
// The real pipeline is capture -> extract -> merge -> render -> serve -> verify. Three of those
// are pure functions over text and are ported here exactly. One is not:
//
//   extract   pure rules over the user's turns            PORTED, rules generated from Python
//   render    priority ordering under a token budget      PORTED
//   residue   user sentences no entry carries             PORTED
//   merge     embeddings + a DeBERTa cross-encoder        NOT PORTED - gigabytes of weights
//
// Merge is what decides that a new claim duplicates, refines or *retires* a stored one. Without
// it this page cannot tell you which entry a change of mind replaces, so it does the honest
// thing instead: it finds the sentences that announce a change, using the same CHANGE_CUE regex
// the real merge step uses, and marks them. Resolving them is an entailment judgement and it
// stays on the server. The page says this where a visitor will read it.
//
// Every pattern and table in `RULES` is generated from the Python modules by
// prototype/generate.py. Nothing here retypes a rule.

import RULES from './rules.generated.js';

const rx = ({ source, flags }) => new RegExp(source, flags);

const SENTENCE_SPLIT = rx(RULES.sentenceSplit);
const FENCE = rx(RULES.fence);
const PROHIBITION = rx(RULES.prohibitionOpening);
const ANAPHORIC_REJECTION = rx(RULES.anaphoricRejection);
const REFUSAL_WITH_ANAPHOR = rx(RULES.refusalWithAnaphor);
const EMPTY_RATHER = rx(RULES.emptyRather);
const PATHY = rx(RULES.pathy);
const CHANGE_CUE = rx(RULES.changeCue);
const RESIDUE_QUESTION = rx(RULES.residueQuestion);
const CLASSIFIERS = RULES.rules.map((r) => ({ ...r, re: rx(r.pattern) }));

// Python's `re.match` is anchored at the start; JS `.test` is not. Anchoring by hand keeps the
// three `.match()` rules behaving as they do in `heuristic.py`.
const matchesAtStart = (re, text) => {
  const m = text.match(re);
  return m !== null && m.index === 0;
};

// ---------------------------------------------------------------- capture

// A pasted transcript, into turns. Accepts the labels the real paste box accepts, plus the
// "You:"/"ChatGPT:"/"Claude:" that the web UIs put on a copied conversation - which is the whole
// point of a demo you paste into. An unlabelled paste is treated as one user turn, because a
// visitor who pastes a paragraph should see something rather than an error.
const USER_LABEL = /^\s*(?:user|you|me|human|q)\s*:\s*/i;
const ASSISTANT_LABEL = /^\s*(?:assistant|claude|chatgpt|gpt|ai|bot|a)\s*:\s*/i;

export function parseTranscript(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const turns = [];
  let current = null;

  for (const line of lines) {
    const user = USER_LABEL.test(line);
    const assistant = !user && ASSISTANT_LABEL.test(line);
    if (user || assistant) {
      if (current) turns.push(current);
      current = {
        role: user ? 'user' : 'assistant',
        content: line.replace(user ? USER_LABEL : ASSISTANT_LABEL, ''),
      };
    } else if (current) {
      current.content += '\n' + line;
    } else if (line.trim()) {
      current = { role: 'user', content: line };
    }
  }
  if (current) turns.push(current);

  return turns
    .map((t, i) => ({ ...t, id: i + 1, content: t.content.trim() }))
    .filter((t) => t.content);
}

// ---------------------------------------------------------------- shared with the Python domain

// domain/sentences.py
const stripFences = (text) => {
  const without = text.replace(new RegExp(FENCE.source, FENCE.flags + 'g'), ' ');
  return [without, without !== text];
};

export const splitSentences = (text) =>
  text
    .split(new RegExp(SENTENCE_SPLIT.source, SENTENCE_SPLIT.flags + 'g'))
    .map((s) => (s ?? '').trim())
    .filter(Boolean);

// domain/hashing.py normalise(): line endings and trailing whitespace only.
const normalise = (text) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();

// extractors/base.py make_title()
function makeTitle(sentence, limit = RULES.titleMax) {
  const text = sentence.replace(/\s+/g, ' ').trim().replace(/[.!?,;:]+$/, '');
  if (text.length <= limit) return text;
  let cut = text.slice(0, limit);
  if (cut.includes(' ')) cut = cut.slice(0, cut.lastIndexOf(' '));
  return cut.replace(/[.!?,;:]+$/, '');
}

// ---------------------------------------------------------------- extract

function classify(sentence, hasCode) {
  for (const rule of CLASSIFIERS) {
    if (rule.re.test(sentence)) return { kind: rule.kind, layer: rule.layer, confidence: rule.confidence };
  }
  if (hasCode && PATHY.test(sentence)) {
    return { kind: 'code_state', layer: 'project', confidence: RULES.codeStateConfidence };
  }
  return null;
}

/** The heuristic extractor. Only the user's turns are read - the rule that outranks every other. */
export function extract(turns) {
  const seen = new Set();
  const candidates = [];

  for (const message of turns) {
    if (message.role !== 'user') continue;
    const [body, hadFence] = stripFences(message.content);
    const hasCode = hadFence || PATHY.test(message.content);

    for (const sentence of splitSentences(body)) {
      const shortProhibition =
        sentence.length >= RULES.minProhibitionChars && PROHIBITION.test(sentence);
      if (sentence.length < RULES.minSentenceChars && !shortProhibition) continue;

      if (
        matchesAtStart(ANAPHORIC_REJECTION, sentence) ||
        matchesAtStart(REFUSAL_WITH_ANAPHOR, sentence) ||
        EMPTY_RATHER.test(sentence)
      ) {
        continue;
      }

      const match = classify(sentence, hasCode);
      if (!match) continue;

      const key = normalise(sentence).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        ...match,
        title: makeTitle(sentence),
        text: sentence,
        lineage: [message.id],
        announcesChange: CHANGE_CUE.test(sentence),
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------- residue (domain/residue.py)

const residueKey = (text) => normalise(text).toLowerCase().split(/\s+/).filter(Boolean).join(' ');

export function uncovered(turns, entryTexts) {
  const covered = entryTexts.filter((t) => t && t.trim()).map(residueKey);
  const seen = new Set();
  const out = [];

  for (const message of turns) {
    if (message.role !== 'user') continue;
    const [body] = stripFences(message.content);
    for (const sentence of splitSentences(body)) {
      const key = residueKey(sentence);
      if (key.length < RULES.minResidueChars || seen.has(key)) continue;
      if (RESIDUE_QUESTION.test(sentence.trim())) continue;
      if (covered.some((entry) => key.includes(entry) || entry.includes(key))) continue;
      seen.add(key);
      out.push(sentence);
    }
  }
  return out;
}

// ---------------------------------------------------------------- render (domain/render.py)

// cl100k is not available in a browser without shipping the vocabulary, so tokens are estimated.
// Deliberately named an estimate everywhere it is shown: at these budgets a 10% error moves the
// line at which the brief is cut, and a demo that prints an exact-looking number it cannot
// compute is worse than one that admits the approximation.
export const estimateTokens = (text) => {
  const t = String(text ?? '').trim();
  if (!t) return 0;
  return Math.max(Math.ceil(t.length / 4), t.split(/\s+/).length);
};

const priorityOf = (kind) =>
  RULES.priority[kind] ?? Math.max(...Object.values(RULES.priority)) + 1;

function formatEntry(entry) {
  const one = (s) => s.split(/\s+/).filter(Boolean).join(' ');
  const title = one(entry.title);
  const body = one(entry.text);
  if (!body || body === title) return `- [${entry.kind}] ${title}`;
  // _adds_nothing: the heuristic's titles are truncations of their own sentence, so printing
  // both spends roughly double the tokens to say one thing.
  const trimmed = title.replace(/[ .!?,;:]+$/, '').toLowerCase();
  const lowered = body.toLowerCase();
  if (trimmed && lowered.startsWith(trimmed)) {
    const rest = lowered.slice(trimmed.length);
    if (!rest || !/[a-z0-9]/i.test(rest[0])) return `- [${entry.kind}] ${body}`;
  }
  return `- [${entry.kind}] ${title} - ${body}`;
}

/**
 * Entries into a brief of at most `budget` estimated tokens.
 *
 * Considered in priority order - constraint, decision, open_thread, then preference and identity,
 * then code_state, then plain facts - with the layer only breaking ties. That ordering is the
 * design: it decides what gets thrown away. Residue spends only what is left over once every
 * entry is placed, so it can never displace one.
 */
export function renderBrief(entries, budget, residue = []) {
  const ordered = [...entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const p = priorityOf(a.e.kind) - priorityOf(b.e.kind);
      if (p) return p;
      const la = RULES.layerOrder.indexOf(a.e.layer);
      const lb = RULES.layerOrder.indexOf(b.e.layer);
      if (la !== lb) return (la < 0 ? RULES.layerOrder.length : la) - (lb < 0 ? RULES.layerOrder.length : lb);
      return a.i - b.i;
    })
    .map((x) => x.e);

  const sections = new Map();
  const included = [];
  const excluded = [];
  let used = 0;
  let stopped = false;

  for (const entry of ordered) {
    if (stopped) {
      excluded.push(entry);
      continue;
    }
    const line = formatEntry(entry);
    let cost = estimateTokens(line);
    if (!sections.has(entry.layer)) {
      cost += estimateTokens(RULES.layerHeadings[entry.layer] ?? `## ${entry.layer}`);
    }
    if (used + cost > budget) {
      // Stop rather than skip: skipping would let a trivial fact that happens to fit displace a
      // decision that did not, inverting the priority the ordering exists to enforce.
      stopped = true;
      excluded.push(entry);
      continue;
    }
    if (!sections.has(entry.layer)) sections.set(entry.layer, []);
    sections.get(entry.layer).push(line);
    included.push(entry);
    used += cost;
  }

  const parts = [];
  for (const layer of RULES.layerOrder) {
    if (!sections.has(layer)) continue;
    parts.push(RULES.layerHeadings[layer]);
    parts.push(...sections.get(layer));
  }

  // Newest first while choosing (an older uncovered sentence is likelier to have been overtaken),
  // oldest first when printed.
  const chosen = [];
  let spare = budget - used;
  for (const sentence of [...residue].reverse()) {
    const line = `- [${RULES.residueKind}] ${sentence.split(/\s+/).filter(Boolean).join(' ')}`;
    const cost = estimateTokens(line) + (chosen.length ? 0 : estimateTokens(RULES.residueHeading));
    if (cost > spare) continue;
    chosen.push(line);
    spare -= cost;
  }
  if (chosen.length) {
    parts.push(RULES.residueHeading);
    parts.push(...chosen.reverse());
    used = budget - spare;
  }

  const text = parts.filter((p) => p !== '').join('\n');
  return {
    text,
    included,
    excluded,
    residueIncluded: chosen.length,
    residueOffered: residue.length,
    tokens: estimateTokens(text),
    budget,
  };
}

// ---------------------------------------------------------------- the whole thing

/** Paste in, brief out. `budget` is in estimated tokens. */
export function derive(transcript, budget = 500) {
  const turns = parseTranscript(transcript);
  const entries = extract(turns);
  const residue = uncovered(turns, entries.map((e) => e.text));
  const brief = renderBrief(entries, budget, residue);

  const userTurns = turns.filter((t) => t.role === 'user');
  return {
    turns,
    entries,
    residue,
    brief,
    changes: entries.filter((e) => e.announcesChange),
    stats: {
      turns: turns.length,
      userTurns: userTurns.length,
      sourceTokens: estimateTokens(turns.map((t) => t.content).join('\n\n')),
      userTokens: estimateTokens(userTurns.map((t) => t.content).join('\n\n')),
      briefTokens: brief.tokens,
    },
  };
}

export const KIND_ORDER = RULES.kindOrder;
export const EXTRACTOR_MODEL = RULES.extractorModel;
export default { derive, extract, renderBrief, uncovered, parseTranscript, estimateTokens };

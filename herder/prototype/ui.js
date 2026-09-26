import { derive, EXTRACTOR_MODEL } from './herder.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

$('model').textContent = `extractor: ${EXTRACTOR_MODEL}`;

// A short conversation with a real change of mind in it, so the reversal flag has something to
// find. Written for this page rather than taken from the benchmark, which stays a held-out corpus.
const SAMPLE = `You: I'm building a stock tracker for a small bakery chain, three shops. I work on Windows and test everything from PowerShell.
Claude: Happy to help. Do you have a database in mind?
You: We're going with Postgres. No cloud services - it has to run on the shop's own machine.
Claude: That's sensible for offline resilience. How should stock be counted?
You: Amounts are always decimal, never floats. I'd rather see plain tables than charts.
Claude: Understood. Would you like a reorder alert?
You: Yes. Reorder suggestions go to the head baker by email.
Claude: I can sketch the schema. Anything on rounding?
You: Stock is rounded to the nearest 100 grams.
Claude: Noted. Shall we look at the daily job?
You: The nightly job runs at 3am. We still need to pick a backup approach.
Claude: There are a few options there.
You: Change of plan on the rounding I mentioned earlier - keep stock exact to the gram, the 100g buckets lost too much.
Claude: Understood, exact to the gram.
You: Also the reorder email goes to both the head baker and the shop manager now.`;

$('sample').addEventListener('click', () => { $('paste').value = SAMPLE; run(); });
$('clear').addEventListener('click', () => { $('paste').value = ''; $('results').classList.add('hidden'); $('paste').focus(); });
$('budget').addEventListener('input', () => { $('budgetOut').textContent = $('budget').value; if (!$('results').classList.contains('hidden')) run(); });
$('run').addEventListener('click', run);
$('paste').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); });

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('brief').dataset.text || '');
    $('copy').textContent = 'Copied';
    setTimeout(() => ($('copy').textContent = 'Copy'), 1200);
  } catch { $('copy').textContent = 'Copy failed'; }
});

// Priority order, so the colour tells you why a line survived the budget.
const TONE = {
  constraint: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  decision: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  open_thread: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  preference: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  identity: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  code_state: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  fact: 'bg-stone-500/10 text-stone-600 dark:text-stone-400',
  glossary: 'bg-stone-500/10 text-stone-600 dark:text-stone-400',
  unsorted: 'bg-stone-500/10 text-stone-500',
};
const tag = (kind) =>
  `<span class="kind shrink-0 rounded px-1.5 py-0.5 text-[11px] ${TONE[kind] ?? TONE.fact}">${esc(kind.replace('_', ' '))}</span>`;

const card = (label, value, note) => `
  <div class="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
    <div class="text-xs uppercase tracking-wide text-stone-500">${esc(label)}</div>
    <div class="mt-0.5 text-xl font-semibold tabular-nums">${esc(value)}</div>
    ${note ? `<div class="text-xs text-stone-500">${esc(note)}</div>` : ''}
  </div>`;

function run() {
  const text = $('paste').value;
  if (!text.trim()) { $('results').classList.add('hidden'); return; }

  // `|| 500` rather than bare Number(): a budget of 0 renders an empty brief and looks like a
  // broken page rather than a misread input. Found by the smoke test, whose stub DOM had no value.
  const budget = Number($('budget').value) || 500;
  const out = derive(text, budget);
  const s = out.stats;

  $('results').classList.remove('hidden');
  $('results').classList.add('fade');

  const ratio = s.briefTokens ? (s.sourceTokens / s.briefTokens).toFixed(1) + 'x' : '-';
  $('stats').innerHTML = [
    card('Conversation', `${s.turns} turns`, `${s.userTokens} of ${s.sourceTokens} est. tokens are yours`),
    card('Kept', `${out.entries.length} entries`, `${out.brief.included.length} in this brief`),
    card('Brief', `${s.briefTokens} tokens`, `budget ${budget}, estimated`),
    card('Compression', ratio, 'against the whole transcript'),
  ].join('');

  // The honest half: we can see a change was announced, not what it retires.
  if (out.changes.length) {
    $('changed').classList.remove('hidden');
    $('changed').innerHTML = `
      <p class="text-sm font-medium text-amber-700 dark:text-amber-400">
        ${out.changes.length} sentence${out.changes.length > 1 ? 's' : ''} announce${out.changes.length > 1 ? '' : 's'} a change of mind
      </p>
      <ul class="mt-2 space-y-1 text-sm">
        ${out.changes.map((c) => `<li class="font-mono text-[13px] text-stone-600 dark:text-stone-400">${esc(c.text)}</li>`).join('')}
      </ul>
      <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
        The full pipeline reads these against what it already holds and retires whatever they replace, so
        the old claim is never served again. Deciding <em>which</em> entry that is takes an entailment
        model, which is why it is not in this page - both claims are still listed below.
      </p>`;
  } else {
    $('changed').classList.add('hidden');
  }

  // The brief, as lines, with the raw text kept for the copy button.
  const lines = out.brief.text.split('\n').map((line) => {
    if (line.startsWith('## ')) {
      return `<div class="mt-3 mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 first:mt-0">${esc(line.slice(3))}</div>`;
    }
    const m = line.match(/^- \[(\w+)\] ([\s\S]*)$/);
    if (!m) return line.trim() ? `<div class="text-sm">${esc(line)}</div>` : '';
    return `<div class="flex gap-2 py-0.5 text-sm"><span class="pt-0.5">${tag(m[1])}</span><span>${esc(m[2])}</span></div>`;
  });
  $('brief').innerHTML = lines.join('') || '<p class="text-sm text-stone-500">Nothing was extracted. Try a longer conversation, or one where you state decisions and constraints.</p>';
  $('brief').dataset.text = out.brief.text;

  const dropped = out.brief.excluded;
  $('excluded').innerHTML = dropped.length
    ? `<p class="mb-2 text-stone-500">${dropped.length} entr${dropped.length > 1 ? 'ies' : 'y'} cut for space${out.brief.residueOffered ? `, and ${out.brief.residueOffered - out.brief.residueIncluded} of ${out.brief.residueOffered} uncaptured sentences` : ''}.</p>
       <ul class="space-y-1">${dropped.map((e) => `<li class="flex gap-2"><span class="pt-0.5">${tag(e.kind)}</span><span class="text-stone-600 dark:text-stone-400">${esc(e.text)}</span></li>`).join('')}</ul>`
    : `<p class="text-stone-500">Everything fitted${out.brief.residueOffered ? `, including ${out.brief.residueIncluded} of ${out.brief.residueOffered} sentences no entry captured` : ''}. Lower the budget to see what gets dropped first - that ordering is the whole design.</p>`;
}

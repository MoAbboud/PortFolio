import { derive, EXTRACTOR_MODEL, FULL_SYSTEM } from './herder.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

$('model').textContent = EXTRACTOR_MODEL;

// The models the full pipeline runs, generated from herder's config defaults so the strip names
// what the system actually loads. "cross-encoder/" is the hub namespace, not part of the name.
const shortName = (id) => String(id).replace(/^[^/]+\//, '');
$('m-extract').textContent = FULL_SYSTEM.extractModel;
$('m-embed').textContent = FULL_SYSTEM.embedModel;
$('m-nli').textContent = shortName(FULL_SYSTEM.nliModel);
$('m-nli2').textContent = shortName(FULL_SYSTEM.nliModel);

// A short conversation with a real change of mind in it, so the reversal notice has something to
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
$('clear').addEventListener('click', () => {
  $('paste').value = '';
  $('results').classList.add('hidden');
  $('notice').classList.add('hidden');
  $('paste').focus();
});
$('budget').addEventListener('input', () => {
  $('budgetOut').textContent = $('budget').value;
  if (!$('results').classList.contains('hidden')) run();
});
$('run').addEventListener('click', run);
$('paste').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); });

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('brief').dataset.text || '');
    $('copy').textContent = 'Copied';
    setTimeout(() => ($('copy').textContent = 'Copy'), 1200);
  } catch { $('copy').textContent = 'Copy failed'; }
});

// The kind is shown as a label whose colour comes from the stylesheet, one hue per kind in the
// render's own priority order. Reading the colour tells you why a line survived the budget.
const label = (kind) => `<span class="tag k-${esc(kind)}">${esc(kind.replace(/_/g, ' '))}</span>`;

const stat = (n, k) => `<div class="stat"><div class="n">${esc(n)}</div><div class="k">${esc(k)}</div></div>`;

function run() {
  const text = $('paste').value;
  $('notice').classList.add('hidden');
  if (!text.trim()) { $('results').classList.add('hidden'); return; }

  // `|| 500` rather than bare Number(): a budget of 0 renders an empty brief and looks like a
  // broken page rather than a misread input. Found by the smoke test, whose stub DOM had no value.
  const budget = Number($('budget').value) || 500;
  const out = derive(text, budget);

  // No speaker labels means no way to tell the user from the assistant, and reading the
  // assistant's advice as the user's decisions is the failure this whole pipeline exists to
  // prevent. Say so instead of guessing.
  if (out.unlabelled) {
    $('results').classList.add('hidden');
    $('notice').classList.remove('hidden');
    $('notice').innerHTML =
      "<b>Couldn't tell who said what.</b> Start each turn with <span class=\"mono\">You:</span> or " +
      '<span class="mono">Claude:</span> / <span class="mono">ChatGPT:</span>. A copied ChatGPT page ' +
      '("You said:") works as it is.';
    return;
  }
  const s = out.stats;

  $('results').classList.remove('hidden');
  $('results').classList.add('fade');

  // Numbers only. What each one means lives behind a title, not beside it. Compression only means
  // something once the chat is bigger than the budget (invariant 7) - a short chat that already
  // fits would print "1.1x smaller", which says nothing about the method.
  $('stats').innerHTML = [
    stat(s.turns, 'turns in'),
    stat(out.entries.length, 'kept'),
    stat(s.briefTokens, 'tokens out'),
    s.sourceTokens > budget && s.briefTokens
      ? stat((s.sourceTokens / s.briefTokens).toFixed(1) + '×', 'smaller')
      : stat('fits', 'under budget'),
  ].join('');

  // The honest half: the page can see a change was announced, not what it retires.
  const changed = $('changed');
  if (out.changes.length) {
    const n = out.changes.length;
    changed.classList.remove('hidden');
    changed.innerHTML = `
      <details class="note" style="border-top:0">
        <summary>You changed your mind <span class="count">${n} time${n > 1 ? 's' : ''}</span></summary>
        <div class="body">
          <ul>${out.changes.map((c) => `<li class="mono" style="font-size:.85rem">${esc(c.text)}</li>`).join('')}</ul>
          <p>The full pipeline reads these against what it already holds and retires whatever they
          replace, so the old claim is never served again. Deciding <b>which</b> entry that is takes an
          entailment model, which is why it is not in this page - both claims are still listed above.</p>
        </div>
      </details>`;
  } else {
    changed.classList.add('hidden');
  }

  // The brief, as lines. The raw text is kept on the element for the copy button.
  const rendered = out.brief.text.split('\n').map((line) => {
    if (line.startsWith('## ')) return `<div class="sec">${esc(line.slice(3))}</div>`;
    const m = line.match(/^- \[(\w+)\] ([\s\S]*)$/);
    if (!m) return line.trim() ? `<div class="ln">${esc(line)}</div>` : '';
    return `<div class="ln">${label(m[1])}<span>${esc(m[2])}</span></div>`;
  });
  $('brief').innerHTML =
    rendered.join('') ||
    '<p class="empty">Nothing was extracted. Try a conversation where you state decisions or constraints.</p>';
  $('brief').dataset.text = out.brief.text;

  // What the budget cut, behind a title with its count on it.
  const dropped = out.brief.excluded;
  const spare = out.brief.residueOffered - out.brief.residueIncluded;
  const wrap = $('excludedWrap');
  if (dropped.length || spare) {
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <details>
        <summary>Cut for space <span class="count">${dropped.length + spare}</span></summary>
        <div class="body">
          <div class="brief">${dropped.map((e) => `<div class="ln">${label(e.kind)}<span>${esc(e.text)}</span></div>`).join('')}</div>
          ${spare ? `<p>And ${spare} sentence${spare > 1 ? 's' : ''} no entry captured.</p>` : ''}
          <p>Still kept, still traceable - just not in this render. Raise the budget and they come back;
          lower it and the order they leave in is the whole design.</p>
        </div>
      </details>`;
  } else {
    wrap.classList.add('hidden');
  }
}

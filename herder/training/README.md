# training

Training material for herder's own models. Nothing here runs at serve time, and nothing here needs
an API key: the datasets are public, the training runs on a free Colab T4, and the weights come home
as files.

## nli - the merge model

The merge step asks a cross-encoder whether a new claim duplicates, refines, replaces or is unrelated
to a stored one. Six off-the-shelf checkpoints were measured on `bench/nli_pairs.json` (see
`python -m bench.nli_compare` and the write-up in `NOTES.md`) and none is good at both halves:

| Failure | Handled by | Failed by |
| --- | --- | --- |
| a correction read as neutral against the claim it replaces | general SNLI/MNLI models | the VitaminC models |
| two compatible sentences read as a contradiction | the VitaminC models | general SNLI/MNLI models |
| an open item about a claim read as replacing it | nobody | everybody |

| File | What it is |
| --- | --- |
| `nli/build_dataset.py` | Builds the training set from public corpora plus the hand-written pairs. Runs locally or in the notebook |
| `nli/open_items.py` | The 400 pairs no public corpus provides, generated from templates: an open item about a claim, two attributes true at once, a restatement, a replacement, and unrelated claims |
| `nli/train_nli.ipynb` | The Colab notebook: clone, build, fine-tune, score on the labelled pairs, download the weights |
| `nli/data/` | The built dataset. **Gitignored** - see the licence note below |

```powershell
python -m training.nli.build_dataset --out training/nli/data
python -m training.nli.build_dataset --out training/nli/data --no-share-alike
```

### Where the data comes from

- **VitaminC** (`tals/vitaminc`, CC BY-SA 3.0) - claims about Wikipedia sentences before and after a
  real edit. Each `case_id` plus `wiki_revision_id` is one piece of evidence with several claims judged
  against it, and they are minimal pairs. **A claim that SUPPORTS the evidence and a claim that REFUTES
  the same evidence contradict each other**, so pairing them gives claim-versus-claim contradictions in
  the shape herder actually compares. That derived pairing is the point: the VitaminC *checkpoints*
  fail on short sentence pairs because they were trained on evidence-against-claim, while the VitaminC
  *data*, re-paired, is exactly right.
- **WANLI** (`alisawuffles/WANLI`, CC BY 4.0) - built for ambiguous entailment-versus-neutral, which is
  the false-contradiction failure.
- **`open_items.py`** - written for this project, because no public dataset labels "an open item about
  a claim does not replace the claim".
- **ANLI is deliberately absent.** CC BY-NC: it would put a non-commercial claim on the weights.

### Two rules the builder enforces

1. **No benchmark sentence may enter training.** Every candidate is checked against every sentence of
   `bench/datasets/*/conversation.txt`; the count dropped is printed rather than hidden. The 261
   hand-written facts are the instrument, and an instrument trained on is no instrument.
2. **Only symmetric labels are swapped.** herder reads both directions and the asymmetry is what
   separates a refinement from a duplicate, so contradiction and neutral get a swapped copy and
   entailment does not.

The majority label is capped at the size of the second largest, because every VitaminC pair is a
contradiction by construction and an unbalanced set would teach the model to say `supersede` - the
exact failure that costs entries.

### Attribution

Both corpora require attribution for *use*, not only for redistribution, so it lives here:

- **VitaminC** - Schuster, Fisch and Barzilay, *Get Your Vitamin C! Robust Fact Verification with
  Contrastive Evidence*, NAACL 2021. Data CC BY-SA 3.0, from Wikipedia revisions.
  <https://huggingface.co/datasets/tals/vitaminc>
- **WANLI** - Liu et al., *WANLI: Worker and AI Collaboration for Natural Language Inference Dataset
  Creation*, 2022. Data CC BY 4.0. <https://huggingface.co/datasets/alisawuffles/WANLI>

### Licence

**This is not a commercial-versus-non-commercial question.** VitaminC and FEVER are CC BY-SA:
commercial use is allowed, and the conditions are attribution and share-alike *on redistributed
derivatives*. The one corpus that restricts commercial use is ANLI (CC BY-NC), and it is excluded
everywhere - which is why no dataset here limits what herder may be used for.

What share-alike actually touches:

- **The built dataset is plainly a derivative**, so it is gitignored and never redistributed here. The
  recipe and the scripts rebuild it exactly, and the seed is in `data/recipe.json`.
- **Model weights are the unsettled part.** Whether trained weights are a derivative work of the
  training data is contested and not settled law; licences written for text do not answer it. `models/`
  is gitignored too, so as things stand nothing trained is distributed from this repository either.
- **This repository has no `LICENSE` file**, so it grants nothing onward and there is no outbound
  licence for BY-SA terms to conflict with. If one is added later *and* weights are shipped under it,
  that is the moment to revisit this - not before.

`--no-share-alike` exists for that moment: it leaves WANLI and the hand-written pairs, which addresses
the false contradiction and does nothing for `supersede`, the more valuable half. Nothing here is legal
advice; it is the reasoning behind a default, written down so it can be challenged.

### Using the result

Unpack the notebook's zip into `herder/models/nli-herder-v1/` (gitignored, like every other weight),
then point the stack at it - the checkpoint is deployment configuration:

```powershell
$env:HERDER_NLI_MODEL = "/models/nli-herder-v1"
docker compose up -d --no-deps worker
python -m bench.nli_compare --models ./models/nli-herder-v1
python -m bench.run --label nli-trained --methods herder
```

Judge it on the `written` pairs and on the **supersedes in the database**, not on recall: the reader
disagrees with itself on about 3.4% of verdicts between runs, so anything under about four facts is
noise.

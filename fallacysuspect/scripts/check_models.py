"""Verify the models in models/two_stage/ are complete and actually loadable.

Run this after copying models down from Colab. A truncated download produces a
`model.safetensors` that *looks* fine in the file listing but blows up with
`MetadataIncompleteBuffer` when loaded — this catches that before it reaches the app.

    python scripts/check_models.py
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MDIR = os.path.join(HERE, "models", "two_stage")

# A fine-tuned distilbert-base checkpoint is ~265 MB. Anything much smaller is truncated.
MIN_SAFETENSORS_BYTES = 250_000_000

ok = True


def problem(msg):
    global ok
    ok = False
    print(f"  [FAIL] {msg}")


print(f"checking {MDIR}\n")

for stage in ("detector", "typer"):
    print(f"--- {stage} ---")
    bert = os.path.join(MDIR, f"{stage}_distilbert")
    tfidf = os.path.join(MDIR, f"{stage}_tfidf.joblib")

    if os.path.isdir(bert):
        weights = os.path.join(bert, "model.safetensors")
        classes = os.path.join(bert, "classes.json")

        if not os.path.exists(weights):
            problem(f"{stage}_distilbert/model.safetensors is MISSING (download incomplete)")
        else:
            size = os.path.getsize(weights)
            if size < MIN_SAFETENSORS_BYTES:
                problem(f"model.safetensors is only {size:,} bytes — TRUNCATED "
                        f"(expected ~265,000,000). Re-download it.")
            else:
                print(f"  size ok: {size:,} bytes")

            # the real test: can transformers actually load it?
            try:
                from transformers import AutoModelForSequenceClassification
                AutoModelForSequenceClassification.from_pretrained(bert)
                print("  loads ok")
            except ImportError:
                print("  (transformers not installed — skipping load test)")
            except Exception as exc:
                problem(f"failed to LOAD: {type(exc).__name__}: {exc}")

        if os.path.exists(classes):
            meta = json.load(open(classes))
            print(f"  classes.json: version {meta.get('version')}, {len(meta.get('classes', []))} classes")
        else:
            problem(f"{stage}_distilbert/classes.json is MISSING")
    else:
        print(f"  no DistilBERT model (will use TF-IDF)")

    if os.path.exists(tfidf):
        print(f"  tfidf fallback present ({os.path.getsize(tfidf):,} bytes)")
    print()

print("=" * 60)
if ok:
    print("ALL GOOD — models are complete and loadable.")
    try:
        sys.path.insert(0, HERE)
        from fallacy_warn import classifier
        print("active model kinds:", classifier.active_kinds())
    except Exception as exc:
        print("(couldn't query the app:", exc, ")")
else:
    print("PROBLEMS FOUND — see [FAIL] above. Re-download the affected model.")
    sys.exit(1)

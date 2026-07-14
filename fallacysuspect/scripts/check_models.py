"""Verify every model set in models/ is complete and actually loadable.

Run this after copying models down from Colab. A truncated download produces a
`model.safetensors` that *looks* fine in the file listing but blows up with
`MetadataIncompleteBuffer` when loaded — this catches that before it reaches the app.
It also catches the double-nested extraction (detector_distilbert/detector_distilbert/),
which makes the app silently fall back to TF-IDF.

    python scripts/check_models.py
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(HERE, "models")

# A fine-tuned distilbert-base checkpoint is ~265 MB (distilroberta ~330 MB).
# Anything much smaller is truncated.
MIN_SAFETENSORS_BYTES = 250_000_000

ok = True


def problem(msg):
    global ok
    ok = False
    print(f"  [FAIL] {msg}")


def check_set(mdir: str) -> None:
    print(f"\n=== {os.path.basename(mdir)} ===")
    try:
        meta = json.load(open(os.path.join(mdir, "pipeline.json")))
        print(f"  pipeline.json: data v{meta.get('data_version')}, "
              f"{len(meta.get('typer_classes', []))} types, "
              f"threshold {meta.get('detect_threshold', 'unset')}")
    except Exception as exc:
        problem(f"pipeline.json unreadable: {exc}")
        return

    for stage in ("detector", "typer"):
        bert = os.path.join(mdir, f"{stage}_distilbert")
        tfidf = os.path.join(mdir, f"{stage}_tfidf.joblib")

        if os.path.isdir(bert):
            # Colab zips extract one level deep — the app won't find the weights.
            if os.path.isdir(os.path.join(bert, f"{stage}_distilbert")):
                problem(f"{stage}_distilbert/ is DOUBLE-NESTED — move the inner "
                        f"folder's contents up one level.")
                continue

            weights = os.path.join(bert, "model.safetensors")
            if not os.path.exists(weights):
                problem(f"{stage}_distilbert/model.safetensors is MISSING (download incomplete)")
                continue

            size = os.path.getsize(weights)
            if size < MIN_SAFETENSORS_BYTES:
                problem(f"{stage} model.safetensors is only {size:,} bytes — TRUNCATED "
                        f"(expected 265M+). Re-download it.")
            else:
                print(f"  {stage}: {size:,} bytes")

            try:  # the real test: can transformers actually load it?
                from transformers import AutoModelForSequenceClassification
                AutoModelForSequenceClassification.from_pretrained(bert)
                print(f"  {stage}: loads ok")
            except ImportError:
                print("  (transformers not installed — skipping load test)")
            except Exception as exc:
                problem(f"{stage} failed to LOAD: {type(exc).__name__}: {exc}")

            cj = os.path.join(bert, "classes.json")
            if os.path.exists(cj):
                cm = json.load(open(cj))
                print(f"  {stage}: {len(cm.get('classes', []))} classes, "
                      f"data v{cm.get('version')}, base {cm.get('base_model', '?')}")
            else:
                problem(f"{stage}_distilbert/classes.json is MISSING")

        elif os.path.exists(tfidf):
            print(f"  {stage}: TF-IDF ({os.path.getsize(tfidf):,} bytes)")
        else:
            problem(f"{stage}: no model of any kind")


sets = sorted(d for d in os.listdir(ROOT)
              if not d.startswith("_")
              and os.path.exists(os.path.join(ROOT, d, "pipeline.json")))
if not sets:
    print(f"No model sets found under {ROOT}")
    sys.exit(1)

print(f"checking {len(sets)} model set(s) under {ROOT}")
for s in sets:
    check_set(os.path.join(ROOT, s))

print("\n" + "=" * 60)
if ok:
    print("ALL GOOD — every model set is complete and loadable.")
    try:
        sys.path.insert(0, HERE)
        from fallacy_warn import classifier
        print("default set:", classifier.default_set())
        for s in classifier.available_sets():
            print(f"  {s['id']:14s} v{s['version']}  {s['kinds']}")
    except Exception as exc:
        print("(couldn't query the app:", exc, ")")
else:
    print("PROBLEMS FOUND — see [FAIL] above.")
    sys.exit(1)

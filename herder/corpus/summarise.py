"""The stage 4 numbers, in the shape the task list asks for.

Three things, in order of how much they matter:

1. **Entry count against source tokens.** A linear relationship means the merge step is not
   working and the compaction claim has failed. This is the stop-and-fix.
2. **The verdict mix.** How candidates were disposed of, which is where a merge step that is
   technically working but choosing the wrong verdict shows up.
3. **heuristic against local**, side by side.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def correlation(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    return num / (dx * dy) if dx and dy else 0.0


def main() -> None:
    results = json.loads((HERE / "stage4-results.json").read_text(encoding="utf-8"))
    by_extractor: dict[str, list[dict]] = {}
    for r in results:
        by_extractor.setdefault(r["extractor"], []).append(r)

    for name, rows in by_extractor.items():
        rows.sort(key=lambda r: r["transcript"])
        print(f"\n=== {name} ===")
        print(
            f"  {'transcript':22s} {'source':>7s} {'cand':>5s} {'new':>4s} {'dup':>4s} "
            f"{'upd':>4s} {'sup':>4s} {'live':>5s} {'brief':>6s} {'x':>6s} {'sec':>7s}"
        )
        for r in rows:
            print(
                f"  {r['transcript']:22s} {r['source_tokens']:7,d} {r['candidates']:5d} "
                f"{r['created']:4d} {r['duplicates']:4d} {r['updated']:4d} {r['superseded']:4d} "
                f"{r['live_entries']:5d} {r['brief_tokens']:6,d} {r['compression']:6.1f} "
                f"{r['wall_seconds']:7.1f}"
            )

        src = [r["source_tokens"] for r in rows]
        live = [r["live_entries"] for r in rows]
        total_src = sum(src)
        total_brief = sum(r["brief_tokens"] for r in rows)
        if not total_brief:
            print("  no briefs recorded for this extractor")
            continue
        cand = sum(r["candidates"] for r in rows)

        print()
        print(f"  totals            {total_src:,} source tokens, {cand} candidates, {sum(live)} live entries")
        print(f"  compression       {total_src / total_brief:.1f}x overall "
              f"(range {min(r['compression'] for r in rows):.1f}-{max(r['compression'] for r in rows):.1f})")
        print(f"  wall clock        {sum(r['wall_seconds'] for r in rows):.0f}s total, "
              f"{sum(r['wall_seconds'] for r in rows[1:]) / max(len(rows) - 1, 1):.1f}s per transcript warm")

        # THE stop-and-fix check.
        r_value = correlation([float(x) for x in src], [float(y) for y in live])
        entries_per_1k = [1000 * y / x for x, y in zip(src, live)]
        print()
        print(f"  STOP-AND-FIX: entry count against source tokens")
        print(f"    correlation r   {r_value:+.2f}   (near +1 means linear growth, and a failed claim)")
        print(f"    entries/1k tok  {min(entries_per_1k):.2f} to {max(entries_per_1k):.2f}"
              f"  (a flat memory shows a FALLING rate as source grows)")
        verdict = "LINEAR - the merge step is not working" if r_value > 0.7 else "flat enough - merging is doing something"
        print(f"    reading         {verdict}")

        merged = sum(r["duplicates"] + r["updated"] for r in rows)
        superseded = sum(r["superseded"] for r in rows)
        print()
        print(f"  verdict mix       {sum(r['created'] for r in rows)} created, {merged} merged "
              f"(dup+upd), {superseded} superseded")
        if superseded > merged:
            print("    ** more superseded than merged. Supersede RETIRES the earlier entry and does")
            print("       not union its lineage, so this is destructive where duplicate is not. **")


if __name__ == "__main__":
    main()

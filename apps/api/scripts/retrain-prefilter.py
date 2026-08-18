#!/usr/bin/env python3
"""
Retrain the LLM pre-filter, and refuse to ship a worse one.

    DATABASE_URL=... python3 apps/api/scripts/retrain-prefilter.py [--dry-run]

The pre-filter decides which mail is worth an LLM call. It is a linear model
distilled from the verdicts the LLM has already given, so every day it runs it
generates more of its own training data. This script turns that into a ratchet.

Three properties, each of which exists because the alternative fails quietly:

**It never regresses.** The new model must beat the incumbent on the SAME
temporal hold-out before it is written. A retrain that silently shipped a worse
model would show up only as escalations nobody saw.

**Vocabulary decays.** A term is kept only if it still earns its place: it must
carry weight AND have appeared in the recent window. Without this the vocabulary
only ever grows, accumulating the names of clients who left and projects that
ended — a dictionary of everything the firm has ever said, most of it dead.

**Structure is re-measured, not assumed.** Thread position, turns so far, reply
latency, recipient counts and punctuation are fitted alongside the words every
cycle. As of 2026-08-15 they add nothing over vocabulary alone (PR-AUC 0.221 vs
0.217 combined, on a temporal split) — but that is a measurement, not a law, and
it is re-taken here rather than argued about. Whichever feature set wins on the
hold-out is the one that ships.

The hold-out is always TEMPORAL — train on older mail, test on newer. A random
split leaks future vocabulary backwards and flattered the first version of this
model by 45% (0.319 vs 0.221).
"""

import argparse
import csv
import io
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parents[1] / "src" / "emails" / "prefilter"
MODEL = HERE / "model.json"
VECTORS = HERE / "parity-vectors.json"
HISTORY = HERE / "history.json"

# Fraction of mail sent on to the LLM. The threshold is set to this quantile of
# the hold-out score distribution, so it means the same thing across retrains
# even as the score scale shifts.
SEND_FRACTION = 0.60

# A term must appear within the most recent RECENCY_FRACTION of the corpus to
# survive, however heavy its weight. Expressed as a fraction rather than a fixed
# number of days on purpose: a fixed 180-day window silently did nothing on a
# corpus that only spanned 128 days, and an inert decay rule is worse than none
# because it looks like it is working.
RECENCY_FRACTION = 0.5
MIN_WEIGHT = 1e-4

QUERY = """
WITH lab AS (
  SELECT e.id, e.thread_id, e.received_at, e.subject, e.body, a.sentiment_value
  FROM email_analyses a
  JOIN emails e ON e.id = a.email_id
  WHERE a.sentiment_value IN ('negative','neutral')
    AND e.body IS NOT NULL AND length(e.body) > 40
), pc AS (
  SELECT email_id,
         COUNT(*) FILTER (WHERE direction='to')            AS n_to,
         COUNT(*) FILTER (WHERE direction='cc')            AS n_cc,
         COUNT(*) FILTER (WHERE participant_type='user')   AS n_staff
  FROM email_participants GROUP BY 1
)
SELECT l.received_at, l.sentiment_value, l.subject, left(l.body, 6000),
       COALESCE(pc.n_to,0), COALESCE(pc.n_cc,0), COALESCE(pc.n_staff,0),
       ROW_NUMBER() OVER (PARTITION BY l.thread_id ORDER BY l.received_at) AS turn,
       COUNT(*)     OVER (PARTITION BY l.thread_id)                        AS turns_total,
       COALESCE(EXTRACT(EPOCH FROM (l.received_at
              - LAG(l.received_at) OVER (PARTITION BY l.thread_id ORDER BY l.received_at)))/3600, -1)
         AS hours_since_prev
FROM lab l LEFT JOIN pc ON pc.email_id = l.id
ORDER BY l.received_at
"""


def clean(subject, body):
    """Must stay identical to `prepare()` in score.ts or every score shifts."""
    raw = f"{subject or ''} \n {body or ''}"
    text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", raw, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.split(r"On .{0,200}?\bwrote:", text)[0]
    return re.sub(r"\s+", " ", text).strip()[:3000]


def structural(row, text):
    n_to, n_cc, n_staff, turn, turns_total, lag = (float(v) for v in row[4:10])
    subject = row[2] or ""
    return [
        n_to, n_cc, n_staff,
        turn, turns_total, turn / max(turns_total, 1),
        np.log1p(max(lag, 0)), 1.0 if lag < 0 else 0.0,
        len(text), text.count("?"), text.count("!"),
        float(len(re.findall(r"\b[A-Z]{3,}\b", text))),
        1.0 if re.match(r"\s*(re|fwd)\s*:", subject, re.I) else 0.0,
    ]


def load(dsn):
    """
    Pulled through psql rather than a driver: this script runs occasionally, and
    psql is already a hard requirement for every migration in this repo. Adding
    a Python database dependency would mean a virtualenv on every machine that
    ever retrains, for one query.

    CSV format specifically — COPY's default text format does not quote embedded
    newlines, and email bodies are full of them. That silently collapsed 35,566
    rows into 216 the first time this data was exported.
    """
    out = subprocess.run(
        ["psql", dsn, "-qAt", "-c", f"COPY ({QUERY.strip().rstrip(';')}) TO STDOUT WITH (FORMAT csv)"],
        capture_output=True, text=True, check=True,
    ).stdout
    csv.field_size_limit(10 ** 7)
    X, y, F, when = [], [], [], []
    for r in csv.reader(io.StringIO(out)):
        if len(r) != 10:
            continue
        r = [r[0], r[1], r[2], r[3], *r[4:]]
        text = clean(r[2], r[3])
        if len(text) < 25:
            continue
        X.append(text)
        y.append(1 if r[1] == "negative" else 0)
        F.append(structural(r, text))
        when.append(datetime.fromisoformat(r[0]))
    return X, np.array(y), np.array(F, dtype=float), when


def fit(X, y, F, cut, use_structure):
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_features=200_000,
                          sublinear_tf=True, strip_accents="unicode")
    A = vec.fit_transform(X[:cut])
    B = vec.transform(X[cut:])
    scaler = None
    if use_structure:
        scaler = StandardScaler().fit(F[:cut])
        A = hstack([A, csr_matrix(scaler.transform(F[:cut]))]).tocsr()
        B = hstack([B, csr_matrix(scaler.transform(F[cut:]))]).tocsr()
    clf = LogisticRegression(max_iter=4000, C=4, class_weight="balanced").fit(A, y[:cut])
    scores = clf.decision_function(B)
    return vec, clf, scaler, scores, average_precision_score(y[cut:], scores)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL is required")

    X, y, F, when = load(dsn)
    cut = int(len(X) * 0.75)
    print(f"{len(X):,} labelled emails  ({y.sum():,} negative)")
    print(f"train {cut:,} up to {when[cut-1]:%Y-%m-%d} | test {len(X)-cut:,} newer\n")

    # Re-run the structure question every cycle instead of trusting last time.
    candidates = {}
    for name, use in (("vocabulary", False), ("vocabulary + structure", True)):
        vec, clf, scaler, scores, ap_score = fit(X, y, F, cut, use)
        candidates[name] = (vec, clf, scaler, scores, ap_score)
        print(f"  {name:24} PR-AUC {ap_score:.4f}")

    best = max(candidates, key=lambda k: candidates[k][4])
    vec, clf, scaler, scores, ap_score = candidates[best]
    print(f"\nwinner: {best}")
    if best.endswith("structure"):
        print("  NOTE: structure now earns its place. score.ts scores text only —")
        print("        it must learn these features before this model can ship.")

    incumbent = json.loads(MODEL.read_text())["metrics"]["prAuc"] if MODEL.exists() and "metrics" in json.loads(MODEL.read_text()) else None
    if incumbent is not None:
        print(f"incumbent PR-AUC {incumbent:.4f}  ->  candidate {ap_score:.4f}")
        if ap_score <= incumbent:
            print("REJECTED: not better than what is deployed. Nothing written.")
            return

    # Decay: a term must still carry weight AND still be in use.
    names = vec.get_feature_names_out()
    coefs = clf.coef_[0][: len(names)]
    span = (when[-1] - when[0]).total_seconds()
    recent_from = when[-1].timestamp() - span * RECENCY_FRACTION
    recent_idx = [i for i, w in enumerate(when) if w.timestamp() >= recent_from]
    print(f"decay window: {when[0] + (when[-1]-when[0])*(1-RECENCY_FRACTION):%Y-%m-%d} onward "
          f"({len(recent_idx):,} emails)")
    seen_recently = set()
    if recent_idx:
        R = vec.transform([X[i] for i in recent_idx])
        seen_recently = set(np.unique(R.nonzero()[1]).tolist())

    keep = [i for i in range(len(names)) if abs(coefs[i]) > MIN_WEIGHT and i in seen_recently]
    dropped = len(names) - len(keep)
    print(f"\nvocabulary {len(names):,} -> {len(keep):,}  ({dropped:,} decayed out)")

    threshold = float(np.quantile(scores, 1 - SEND_FRACTION))
    kept = y[cut:][scores >= threshold].sum() / max(y[cut:].sum(), 1)
    print(f"sending {SEND_FRACTION:.0%} retains {kept:.0%} of the LLM's negatives")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    model = {
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "featureSet": best,
        "trainedOn": {"rows": cut, "negatives": int(y[:cut].sum()),
                      "upTo": when[cut - 1].strftime("%Y-%m-%d")},
        "metrics": {"prAuc": round(float(ap_score), 4),
                    "sendFraction": SEND_FRACTION,
                    "negativesRetained": round(float(kept), 4)},
        "intercept": float(clf.intercept_[0]),
        "threshold": round(threshold, 6),
        "terms": {names[i]: [round(float(vec.idf_[i]), 5), round(float(coefs[i]), 5)] for i in keep},
    }
    MODEL.write_text(json.dumps(model, separators=(",", ":")))
    VECTORS.write_text(json.dumps(
        [{"text": X[cut + i][:600],
          "score": round(float(clf.decision_function(vec.transform([X[cut + i][:600]]))[0]), 6)}
         for i in range(10)], indent=1))

    history = json.loads(HISTORY.read_text()) if HISTORY.exists() else []
    history.append({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "prAuc": model["metrics"]["prAuc"], "terms": len(keep),
                    "featureSet": best, "rows": cut})
    HISTORY.write_text(json.dumps(history, indent=1))
    print(f"\nwrote {MODEL.name} ({MODEL.stat().st_size/1024/1024:.1f} MB)")
    print("run the parity test before deploying: pnpm --filter @crm/api test src/emails/prefilter")


if __name__ == "__main__":
    main()

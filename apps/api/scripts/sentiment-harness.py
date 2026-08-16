#!/usr/bin/env python3
"""
A fixed test set for negative-sentiment detection, and a matrix runner over it.

    DATABASE_URL=... python3 apps/api/scripts/sentiment-harness.py build
    DATABASE_URL=... python3 apps/api/scripts/sentiment-harness.py sheet   > coding.csv
    GEMINI_KEY=...   python3 apps/api/scripts/sentiment-harness.py run [--labels coding.csv]

Why this exists: every number produced about this classifier so far moved when
the measuring instrument moved. The same 120 emails scored 14% or 72% depending
on how the audit question was phrased, and 33% or 64% depending on which model
was asked. An LLM judging an LLM inherits whatever asymmetry the judge's prompt
has, and the judge's prompt is written by whoever wants an answer.

So the labels here do not come from a model. Two sources, both external:

**BEHAVIOURAL positives.** An email where a human opened the task, worked it,
and wrote a problem and a resolution. A person read that mail and decided it was
real. 862 exist. Nobody wrote them for this purpose, which is what makes them
worth having.

**BEHAVIOURAL negatives.** Client mail on a thread that ran on for at least two
more messages with no complaint ever raised, and no task opened by anyone. The
conversation continued and nobody thought anything was wrong.

Both are proxies and both can be wrong. `sheet` exists for that: it emits the
sample as a CSV for a human to code by hand, and `run --labels` prefers the
human column wherever it is filled in. Machine labels are the floor, not the
ceiling.

The matrix then varies exactly three things and holds everything else fixed:
preprocessing, model, prompt version. Cost and latency are recorded per cell so
"cheaper" and "faster" are measured rather than asserted.
"""

import argparse
import csv
import io
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
DATA = HERE / "sentiment-testset.jsonl"

OURS = ("mystartupcfo.com", "numerafinance.com", "mytaxfiler.com")

# $/million tokens, verified at ai.google.dev/gemini-api/docs/pricing 2026-08-16.
PRICES = {
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-3.1-flash-lite": (0.25, 1.50),
    "gemini-3.5-flash-lite": (0.30, 2.50),
}

BUILD_SQL = """
WITH worked AS (
  -- A human read this, worked it, and wrote up what the problem was.
  SELECT e.id, e.subject, left(e.body, 8000) AS body, 'complaint' AS label,
         'human wrote a task resolution' AS provenance
  FROM emails e
  JOIN tasks t ON t.email_id = e.id
  WHERE t.status = 1
    AND COALESCE(t.resolution,'') <> '' AND COALESCE(t.problem,'') <> ''
    AND e.body IS NOT NULL AND length(e.body) > 150
    AND split_part(lower(e.from_email),'@',2) NOT IN ('mystartupcfo.com','numerafinance.com','mytaxfiler.com')
  ORDER BY md5(e.id::text) LIMIT %(pos)s
), quiet AS (
  -- The thread carried on for two more messages and nobody ever complained,
  -- and no task was ever opened against it.
  SELECT e.id, e.subject, left(e.body, 8000) AS body, 'not_complaint' AS label,
         'thread continued clean, no task' AS provenance
  FROM emails e
  WHERE e.body IS NOT NULL AND length(e.body) > 150
    AND split_part(lower(e.from_email),'@',2) NOT IN ('mystartupcfo.com','numerafinance.com','mytaxfiler.com')
    AND EXISTS (SELECT 1 FROM email_analyses x WHERE x.email_id = e.id AND x.analysis_type='sentiment')
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.email_id = e.id)
    AND (SELECT COUNT(*) FROM emails f WHERE f.thread_id = e.thread_id AND f.received_at > e.received_at) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM emails f WHERE f.thread_id = e.thread_id
        AND f.received_at > e.received_at AND f.signals @> ARRAY[2])
  ORDER BY md5(e.id::text) LIMIT %(neg)s
)
SELECT id, subject, body, label, provenance FROM worked
UNION ALL
SELECT id, subject, body, label, provenance FROM quiet
"""


# --------------------------------------------------------------- preprocessing
def detag(subject: str, body: str) -> str:
    t = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", f"{subject} \n {body}", flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#39;", "'")):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t)


def prep_stripped(subject, body):
    """What production does today: everything below the first attribution is cut."""
    return re.split(r"On .{0,200}?\bwrote:|From:\s", detag(subject, body))[0].strip()[:2500]


def prep_one_quote(subject, body):
    """Keep a single level of history. The grievance is often in the quote."""
    t = detag(subject, body)
    parts = re.split(r"(On .{0,200}?\bwrote:)", t)
    out = parts[0]
    if len(parts) > 2:
        out += "\n\n[previous message in this thread]\n" + parts[2]
    return out.strip()[:4000]


PREPROCESS = {"stripped": prep_stripped, "one-quote": prep_one_quote}


# ---------------------------------------------------------------------- runner
def call(model: str, prompt: str, key: str):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 1400, "temperature": 0},
    }).encode()
    for attempt in range(3):
        try:
            with urlopen(Request(url, data=payload, headers={"content-type": "application/json"}), timeout=90) as r:
                d = json.load(r)
            text = "".join(p.get("text", "")
                           for c in d.get("candidates", [])
                           for p in c.get("content", {}).get("parts", []))
            u = d.get("usageMetadata", {})
            return text, u.get("promptTokenCount", 0), u.get("candidatesTokenCount", 0)
        except Exception:
            time.sleep(2 * (attempt + 1))
    return "", 0, 0


def prompts_from_source():
    """Read the live prompts out of modules.ts so the harness cannot drift from it."""
    src = (HERE.parents[1] / "analysis" / "src" / "analyses" / "modules.ts").read_text()
    out = {}
    for m in re.finditer(r"name:\s*'([a-z-]+)',\s*\n\s*description:.*?\n\s*instructions:\s*`(.*?)`,\n", src, re.S):
        out[m.group(1)] = m.group(2)
    return out


def build(dsn, pos, neg):
    sql = BUILD_SQL % {"pos": pos, "neg": neg}
    out = subprocess.run(
        ["psql", dsn, "-qAt", "-c", f"COPY ({sql.strip()}) TO STDOUT WITH (FORMAT csv)"],
        capture_output=True, text=True, check=True).stdout
    csv.field_size_limit(10 ** 7)
    n = 0
    with DATA.open("w") as fh:
        for r in csv.reader(io.StringIO(out)):
            if len(r) != 5:
                continue
            fh.write(json.dumps({"id": r[0], "subject": r[1], "body": r[2],
                                 "label": r[3], "provenance": r[4], "human": ""}) + "\n")
            n += 1
    rows = [json.loads(l) for l in DATA.open()]
    from collections import Counter
    print(f"wrote {DATA} — {n} emails")
    for k, v in Counter(r["label"] for r in rows).items():
        print(f"  {k:16}{v:>5}")
    print("\nLabels are behavioural, not model-generated. Hand-code them with:")
    print("  python3 apps/api/scripts/sentiment-harness.py sheet > coding.csv")


def sheet():
    """Emit the sample for a human to code. Fill the `human` column with y/n."""
    rows = [json.loads(l) for l in DATA.open()]
    w = csv.writer(sys.stdout)
    w.writerow(["id", "human(y/n)", "machine_label", "provenance", "subject", "text"])
    for r in rows:
        w.writerow([r["id"], r.get("human", ""), r["label"], r["provenance"],
                    r["subject"][:100], prep_one_quote(r["subject"], r["body"])[:1500]])


def run(key, labels_csv, models, preps, prompt_keys):
    rows = [json.loads(l) for l in DATA.open()]
    if labels_csv:
        csv.field_size_limit(10 ** 7)
        human = {}
        with open(labels_csv) as fh:
            for r in csv.DictReader(fh):
                v = (r.get("human(y/n)") or "").strip().lower()
                if v in ("y", "n"):
                    human[r["id"]] = (v == "y")
        for r in rows:
            if r["id"] in human:
                r["label"] = "complaint" if human[r["id"]] else "not_complaint"
        print(f"applied {len(human)} human labels from {labels_csv}\n")
    truth = [r["label"] == "complaint" for r in rows]
    P = prompts_from_source()
    print(f"{len(rows)} emails — {sum(truth)} complaints, {len(truth)-sum(truth)} not\n")
    print(f"{'model':24}{'preprocess':>12}{'prompt':>10}{'recall':>9}{'precision':>11}{'$/1k':>9}{'sec':>7}")
    for model in models:
        for pname in preps:
            for pk in prompt_keys:
                prep = PREPROCESS[pname]
                def one(r):
                    t, i, o = call(model, f"{P[pk]}\n\n## Email\n{prep(r['subject'], r['body'])}\n\nReturn ONLY the JSON.", key)
                    m = re.search(r'"value"\s*:\s*"(\w+)"', t)
                    return (m.group(1).lower() if m else None), i, o
                t0 = time.time()
                with ThreadPoolExecutor(max_workers=8) as ex:
                    out = list(ex.map(one, rows))
                wall = time.time() - t0
                tp = sum(1 for k, r in enumerate(rows) if truth[k] and out[k][0] == "negative")
                fp = sum(1 for k, r in enumerate(rows) if not truth[k] and out[k][0] == "negative")
                pi, po = PRICES[model]
                cost = (sum(o[1] for o in out) / 1e6 * pi + sum(o[2] for o in out) / 1e6 * po) / len(rows) * 1000
                R = 100 * tp / max(sum(truth), 1)
                Pp = 100 * tp / max(tp + fp, 1)
                print(f"{model:24}{pname:>12}{pk[-4:]:>10}{R:>8.0f}%{Pp:>10.0f}%{cost:>9.2f}{wall:>7.0f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build", "sheet", "run"])
    ap.add_argument("--pos", type=int, default=150)
    ap.add_argument("--neg", type=int, default=150)
    ap.add_argument("--labels")
    ap.add_argument("--models", default="gemini-2.5-flash,gemini-3.1-flash-lite")
    ap.add_argument("--preps", default="stripped,one-quote")
    ap.add_argument("--prompts", default="sentiment")
    a = ap.parse_args()
    if a.cmd == "build":
        dsn = os.environ.get("DATABASE_URL") or sys.exit("DATABASE_URL required")
        build(dsn, a.pos, a.neg)
    elif a.cmd == "sheet":
        sheet()
    else:
        key = os.environ.get("GEMINI_KEY") or sys.exit("GEMINI_KEY required")
        run(key, a.labels, a.models.split(","), a.preps.split(","), a.prompts.split(","))

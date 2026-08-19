#!/usr/bin/env python3
"""
Recover the firm's own replies from the quoted chains in client email.

    DATABASE_URL=... python3 apps/api/scripts/recover-replies.py [--out FILE] [--limit N]

Outbound mail is dropped by the Gmail sync blacklist before it is ever stored,
so `emails` holds 128,426 client messages and only 6,461 of ours. Every model in
this codebase was therefore fitted on one side of the conversation: it can say a
client is unhappy, and has never seen what a good reply looks like.

But the replies were never actually lost. A client answering us quotes our
message below theirs, so our text is sitting inside their body — 15,531 of them,
against 15,437 emails carrying a `first_reply_at`. `stripQuotedReply` discards
exactly this at read time, which is right for analysis and wrong for training.

This pulls the pairs back out: what the client wrote, and what we replied.
Measured yield on a 40-email sample was 95%.

Read-only. Writes a JSONL file, touches no table.
"""

import argparse
import csv
import io
import json
import os
import re
import subprocess
import sys

OURS = r"(mystartupcfo|numerafinance|mytaxfiler)\.com"

# "On <date> <someone>@ours wrote:" — the attribution line Gmail-style clients
# put above a quoted message. Everything after it, to the next attribution, is
# what we sent.
ATTRIB_OURS = re.compile(r"On .{0,200}?" + OURS + r".{0,80}?wrote:\s*", re.I | re.S)
ATTRIB_ANY = re.compile(r"On .{0,200}?wrote:", re.I | re.S)

# Signature and boilerplate start here; everything below is noise for training.
CUTOFFS = [
    re.compile(r"\bThe contents of this email message and any attachments\b", re.I),
    re.compile(r"\bThis (e-?mail|message) (and any attachments )?(is|are) (confidential|intended)", re.I),
    re.compile(r"\bDisclaimer\s*:", re.I),
    re.compile(r"\bSent from my \w+", re.I),
]

QUERY = """
SELECT e.id, e.thread_id, e.received_at, e.from_email, e.subject, left(e.body, 20000)
FROM emails e
WHERE e.body IS NOT NULL
  AND length(e.body) > 400
  AND e.body ~* 'On .{0,200}(mystartupcfo|numerafinance|mytaxfiler)\\.com.{0,80}wrote:'
  AND split_part(lower(e.from_email), '@', 2)
      NOT IN ('mystartupcfo.com','numerafinance.com','mytaxfiler.com')
ORDER BY e.received_at
"""


def to_text(html: str) -> str:
    t = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"</(p|div|tr|li|h[1-6])>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#39;", "'")):
        t = t.replace(a, b)
    return re.sub(r"[ \t]+", " ", t)


def trim_boilerplate(text: str) -> str:
    cut = len(text)
    for pat in CUTOFFS:
        m = pat.search(text)
        if m:
            cut = min(cut, m.start())
    return re.sub(r"\n{3,}", "\n\n", text[:cut]).strip()


def split_pair(body: str):
    """
    One transaction, in the order it happened: (what WE sent, how they answered).

    The quoted block sits BELOW the attribution line, which means it precedes the
    reply above it. So the text under "On ... @ours ... wrote:" is our STIMULUS
    and the text above it is the client's RESPONSE — not the other way round.
    Naming these backwards inverted a transactional-analysis pass and produced
    nonsense: clients "complained" about delays in messages we had not sent yet.

    Returns (ours_first, client_response) or None.
    """
    text = to_text(body)
    m = ATTRIB_OURS.search(text)
    if not m:
        return None

    client = trim_boilerplate(text[: m.start()])
    rest = text[m.end():]

    # Stop at the next attribution: below it is an older turn, not our reply.
    nxt = ATTRIB_ANY.search(rest)
    ours = trim_boilerplate(rest[: nxt.start()] if nxt else rest)

    if len(ours) < 120 or len(client) < 40:
        return None
    return ours, client


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="replies.jsonl")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL is required")

    q = QUERY.strip()
    if args.limit:
        q += f"\nLIMIT {args.limit}"

    # psql + CSV: COPY's text format does not quote embedded newlines and email
    # bodies are full of them.
    out = subprocess.run(
        ["psql", dsn, "-qAt", "-c", f"COPY ({q}) TO STDOUT WITH (FORMAT csv)"],
        capture_output=True, text=True, check=True,
    ).stdout
    csv.field_size_limit(10 ** 7)

    seen = recovered = 0
    with open(args.out, "w") as fh:
        for row in csv.reader(io.StringIO(out)):
            if len(row) != 6:
                continue
            seen += 1
            pair = split_pair(row[5])
            if not pair:
                continue
            ours_first, client_response = pair
            recovered += 1
            fh.write(json.dumps({
                "emailId": row[0],
                "threadId": row[1],
                "receivedAt": row[2],
                "clientEmail": row[3],
                "subject": row[4],
                # Chronological: we wrote first, they answered.
                "weSent": ours_first[:6000],
                "theyReplied": client_response[:6000],
            }) + "\n")

    rate = 100 * recovered / seen if seen else 0
    print(f"scanned {seen:,} client emails that quote one of ours")
    print(f"recovered {recovered:,} (we sent -> they replied) transactions  [{rate:.0f}%]")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()

# Mode classifier gauntlet

Measures `classifyThreadMode()` against real threads from the emails database.

## Why

The five modes decide what the card renders. If the classifier collapses to one
mode the modal design is decorative, and if it fires the wrong mode the card
shows the wrong sections — a wrong `fyi` is the worst, because it tells the user
nothing is needed and stops.

None of that is visible from unit tests. It needs real mail and an independent
reference.

## Pipeline

1. **Sample** — stratified by thread length and negative-sentiment presence.
   Sentiment is useless as a stratifier on its own: the corpus is 33,373 neutral
   against 1,017 negative and 210 positive.
2. **Clean** — `apps/api/src/emails/extraction/extractor.ts` (`extractLatestReply`)
   strips signatures and quoted chains. Removes ~82% of characters, and
   signatures are the densest source of names, titles, phones and addresses.
3. **Redact** — three passes, most precise first:
   - exact multi-word entity strings from the DB (customers, contacts, domains,
     sender display names, titles);
   - single tokens from that vocabulary, but ONLY when not in
     `/usr/share/dict/words`;
   - regex for addresses, URLs, phone numbers.

   The dictionary guard exists because applying the 15,661-token vocabulary
   directly turned "Statement of Outstanding Invoices" into "NB111 of
   Outstanding N491D" — "Statement", "Will" and "Day" are all somebody's name or
   title. Redaction that shreds the sentence is as useless as none: a judge
   cannot classify what it cannot read. With the guard, 6.8% of tokens are
   replaced and the text stays readable.

   **Known residual leaks.** A first name absent from the database survives
   (observed: "Srujan"). A company named after a dictionary word survives by
   design. This reduces exposure; it does not eliminate it. Do not describe the
   output as anonymised.
4. **Label** — the local classifier, and Haiku subagents as an independent
   reference over the same threads.
5. **Compare** — `compare.py` prints agreement, a confusion matrix and per-mode
   precision/recall.

Haiku labels are a REFERENCE, NOT TRUTH. Disagreements mark threads worth
reading, not automatic classifier errors. Counting agreement alone is the same
mistake that scored phi3.5 as perfect while it returned an empty reason, the
wrong sentiment, and a schema hint echoed back as an open question.

## Results — 169 threads, Aug 2026

| prompt | agreement | complaint prec. | fyi recall |
|---|---|---|---|
| v1 flat definitions | 64% | 0.41 | 0.74 |
| v2 "working is the default" | 75% | 0.75 | **0.32** |
| v3 ordered checklist | **78%** | 0.53 | 0.71 |

v2 fixed complaint over-firing by breaking fyi and scheduling — a blanket
default ate the two modes that have crisp objective tests. v3 replaces the
default with an ordered decision procedure (fyi, then scheduling, then
complaint, then opportunity, else working) and keeps both gains.

Re-run on cleaned + redacted text: **78%**, unchanged. Redaction is free.
(The comparable set falls to 116 there, because signature-stripping empties
short threads and those skew fyi — so the headline is comparable but that run's
per-mode fyi figures are thin.)

Still weak: `complaint` precision ~0.53, and `opportunity` never fires — Haiku
found 0 opportunity threads in 169, so this corpus cannot measure it.

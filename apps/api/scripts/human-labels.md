# human-labels.json

50 emails from `sentiment-testset.jsonl`, labelled by Gaurav one at a time over a
phone session on 2026-08-16. `y` = the client is expressing dissatisfaction with
our work; `n` = they are not. 20 are `y`.

Keyed by `emails.id`. No subject or body is stored here — the text lives in
`sentiment-testset.jsonl`, and this file is only the verdicts.

**This is the only human ground truth the sentiment work has.** Every precision
and recall figure quoted for a prompt, a gate, or a judge panel is measured
against these 50 rows. Models label each other's output everywhere else in the
pipeline; this is the one place a person read the mail and decided.

Two properties to keep in mind before quoting a number from it:

- **41% prevalence, against ~3% in the corpus.** The sample was drawn to contain
  arguments, not to be representative. Precision measured here is optimistic for
  production by a wide margin; recall transfers better.
- **Fifty rows.** A single disagreement moves precision by two points. Treat gaps
  under about ten points as noise.

Some of the calls are close, and the reasoning behind them is the useful part.
Where Gaurav marked `y` on mail that reads as ordinary — a client "clarifying a
complex transaction", another "phrasing it as an argument", one "calm client but
raised stakes" — the label is recording an American business register that the
bookkeepers reading this mail do not share. That is the entire reason the
classifier exists, so those rows are the ones a model has to get right, not the
ones to drop for being borderline.

Read by `label-panel.py calibrate` and `src/emails/prefilter/idioms.eval.ts`,
which excludes these ids so the idiom lexicon is scored on mail it was not
written against.

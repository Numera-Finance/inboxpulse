"""
Label training data with a panel of local models given opposed priors.

    python3 apps/api/scripts/label-panel.py calibrate   # score the panel on hand-coded truth
    python3 apps/api/scripts/label-panel.py label FILE  # label a jsonl of {id,subject,body}

WHY A PANEL, AND WHY THESE PRIORS

The embedding gate is trained on labels a single LLM produced. A single judge's
mistakes are systematic rather than random -- it misreads the same kind of email
the same way every time -- so its errors survive into the training set as a
consistent, learnable, wrong pattern. More rows of that do not help.

The obvious fix, several models voting, does less than it looks. Measured on 49
hand-coded emails, three cloud judges given identical instructions agreed
unanimously on three emails that were not complaints: same framing, same
examples, same blind spots. And two local models turned out to be nested rather
than independent -- qwen's YES set was a strict subset of gemma's, so their
agreement carried no information their disagreement didn't.

Asking each judge a DIFFERENT question fails worse, and it is worth recording why.
A panel judging stance, consequence, and repetition separately scored 33%
precision where it agreed unanimously -- lower than any single judge. Votes only
combine when they are votes on one proposition; three answers to three questions
are three facts, and conjunction over them is an accident.

What works is holding the question fixed and opposing the PRIOR. The same model,
asked the same thing, told once that missing a quiet grievance is the unforgivable
error and once that crying wolf is, moves across the entire operating range:

    gemma3:27b  as advocate   recall 100%   precision 43%
    gemma3:27b  as defender   recall  70%   precision 88%
    qwen2.5:32b as advocate   recall  90%   precision 69%
    qwen2.5:32b as defender   recall  60%   precision 92%

That is one model spanning 43-88% precision on identical inputs, which makes the
prior a stronger lever than the model choice. It also gives a two-sided rule with
a use for each end, rather than one threshold that has to be both safe and clean:

    both DEFENDERS say yes  ->  positive label   92% clean
    both ADVOCATES say no   ->  negative label   0 complaints lost
    anything else           ->  discarded, unlabelled

Roughly a third of mail comes back unlabelled at high prevalence. That is the
point: the discarded band is where the judges disagree, and a label there would
be a guess written into the training set as a fact.

Local models on purpose. This is a one-time job over tens of thousands of emails
where the same text is judged four times, and nothing leaves the machine.
"""
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OLLAMA = 'http://127.0.0.1:11434/api/generate'
WORKERS = 4
MODELS = ('gemma3:27b', 'qwen2.5:32b')

TASK = """Read this email, sent BY A CLIENT to the finance/bookkeeping firm that works for them.
Answer ONE question: is the client expressing dissatisfaction with the firm's work or service?
American business English understates this - "not ideal", "sorry, why...", "BTW this is wrong",
"circling back again" are complaints. Annoyance at a third party is not.
Answer with ONLY one word: YES or NO."""

ADVOCATE = """You are the CLIENT'S ADVOCATE. You believe clients rarely say what they mean outright;
they soften, hint, and go quiet rather than accuse. Your failure mode you must avoid is missing a
real grievance because it was politely worded. When genuinely torn, lean YES."""

DEFENDER = """You are the FIRM'S DEFENDER. You believe most client mail is ordinary work - questions,
documents, requests, corrections - and that reading complaint into routine traffic cries wolf and
burns the team's attention. Your failure mode you must avoid is calling a working email a complaint.
When genuinely torn, lean NO."""

PRIORS = {'advocate': ADVOCATE, 'defender': DEFENDER}


def prepare(subject: str, body: str) -> str:
    """Strip markup and quoted history. Must match the analysis path or labels do not transfer."""
    t = f'{subject} \n {body}'
    t = re.sub(r'<(style|script|head)[\s\S]*?</\1>', ' ', t, flags=re.I)
    t = re.sub(r'<!--[\s\S]*?-->', ' ', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    for a, b in [('&nbsp;', ' '), ('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                 ('&quot;', '"'), ('&#39;', "'")]:
        t = t.replace(a, b)
    t = re.split(r'On .{0,200}?\bwrote:|From:\s', t)[0]
    return re.sub(r'\s+', ' ', t).strip()[:1800]


def judge(model: str, prior: str, text: str) -> bool:
    """One vote. A model that will not answer the question counts as NO.

    Silence has to fall somewhere, and NO is the safe side: it costs a positive
    label, which the panel can survive, rather than inventing one, which poisons
    the training set. nemotron-3.5-lightning is the reason this matters -- it
    returns its answer only inside a thinking block and scored 15% recall here,
    so it is excluded from MODELS rather than quietly counted as a NO on
    everything.
    """
    body = json.dumps({
        'model': model,
        'prompt': f'{prior}\n\n{TASK}\n\n## Email\n{text}\n\nAnswer (YES or NO):',
        'stream': False,
        'options': {'temperature': 0, 'num_predict': 8},
    }).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={'content-type': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                out = json.load(r)['response'].upper()
            hits = re.findall(r'\b(YES|NO)\b', out)
            return bool(hits) and hits[0] == 'YES'
        except Exception:
            time.sleep(2 * (attempt + 1))
    return False


def vote(texts: list, model: str, prior_name: str) -> list:
    prior = PRIORS[prior_name]
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        return list(ex.map(lambda t: judge(model, prior, t), texts))


def panel(texts: list, verbose: bool = True) -> dict:
    """Every model under every prior. Returns {'model/prior': [bool, ...]}."""
    votes = {}
    for model in MODELS:
        for prior_name in PRIORS:
            started = time.time()
            votes[f'{model}/{prior_name}'] = vote(texts, model, prior_name)
            if verbose:
                fired = sum(votes[f'{model}/{prior_name}'])
                print(f'  {model:14}/{prior_name:9} fired {fired:>5}/{len(texts)}  '
                      f'{(time.time() - started) / max(len(texts), 1):.2f}s/email', flush=True)
    return votes


def decide(votes: dict) -> list:
    """Fold the panel into one label per email: 1, 0, or None for 'do not use'."""
    defenders = [v for k, v in votes.items() if k.endswith('/defender')]
    advocates = [v for k, v in votes.items() if k.endswith('/advocate')]
    out = []
    for i in range(len(next(iter(votes.values())))):
        if all(d[i] for d in defenders):
            out.append(1)
        elif not any(a[i] for a in advocates):
            out.append(0)
        else:
            out.append(None)
    return out


def calibrate() -> None:
    """Score the panel against hand-coded truth. Run this before trusting any labels.

    See human-labels.md: 50 rows at 41% prevalence against ~3% in the corpus, so
    precision here is optimistic and gaps under ten points are noise.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    truth = json.load(open(os.path.join(here, 'human-labels.json')))
    rows = [json.loads(l) for l in open(os.path.join(here, 'sentiment-testset.jsonl'))]
    rows = [r for r in rows if r['id'] in truth]
    texts = [prepare(r['subject'], r['body']) for r in rows]
    y = [truth[r['id']] == 'y' for r in rows]
    print(f'{len(rows)} hand-coded emails, {sum(y)} complaints\n')

    votes = panel(texts)
    labels = decide(votes)
    pos = [i for i, l in enumerate(labels) if l == 1]
    neg = [i for i, l in enumerate(labels) if l == 0]
    clean = sum(1 for i in pos if y[i])
    lost = sum(1 for i in neg if y[i])
    print(f'\n  POSITIVE {len(pos):>4}   {100 * clean / max(len(pos), 1):.0f}% clean '
          f'({len(pos) - clean} false alarms)')
    print(f'  NEGATIVE {len(neg):>4}   {lost} complaints lost')
    print(f'  UNLABELLED {labels.count(None):>2}   ({100 * labels.count(None) / len(labels):.0f}%)')


def label(path: str) -> None:
    rows = [json.loads(l) for l in open(path)]
    texts = [prepare(r.get('subject', ''), r.get('body', '')) for r in rows]
    print(f'labelling {len(rows)} emails with {len(MODELS)} models x {len(PRIORS)} priors', flush=True)
    votes = panel(texts)
    labels = decide(votes)
    out = path.replace('.jsonl', '') + '.labelled.jsonl'
    with open(out, 'w') as f:
        for r, l, i in zip(rows, labels, range(len(rows))):
            f.write(json.dumps({
                'id': r.get('id'),
                'label': l,
                'votes': {k: v[i] for k, v in votes.items()},
            }) + '\n')
    print(f'\n  positive {labels.count(1)}   negative {labels.count(0)}   '
          f'unlabelled {labels.count(None)}')
    print(f'  wrote {out}')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'calibrate'
    if cmd == 'calibrate':
        calibrate()
    elif cmd == 'label':
        label(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)

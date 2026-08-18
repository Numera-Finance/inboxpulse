"""
Does the nearest already-judged email decide the new one?

    python3 apps/api/scripts/knn-test.py

A different question from retrieval-augmented prompting, which was measured and
does not help (ADR-026). There the neighbours were shown to a model and the model
decided. Here the neighbour's LABEL is the answer and no model is called at all.

The distinction is local versus global. Berne Whiskers is one linear boundary
over the whole corpus, so a pattern true of one client and false elsewhere is
averaged away. k-NN has no such constraint: if this client phrases displeasure a
particular way and that phrasing was tagged before, the neighbour carries it
regardless of whether it generalises.

Measured against the 49 emails a person judged, over every judged email in the
corpus. Reports both directions, because they have different costs:

  nearest is a complaint  -> call it a complaint      (precision matters)
  all k neighbours benign -> call it benign           (a miss is unrecoverable)

WHAT THIS ACTUALLY MEASURES: CLIENT MEMORY, NOT COMPLAINT DETECTION.

Excluding the client's OWN prior mail as well as self and thread — the grouped
split the leakage literature requires when items share a source — costs half the
recall and eleven points of precision:

  neighbours include the client's history   86% precision, 12/20 caught
  same sender domain also excluded          75% precision,  6/20 caught

So most of the lift is recognising "this client complaining again", not
recognising a complaint. That is legitimate in production, where the history
genuinely exists, but it sets what may be claimed: on an established client
86%/60%, on a client with no history 75%/30%. Quote the second when talking about
onboarding a new tenant.

THE EMAIL ITSELF AND ITS THREAD ARE EXCLUDED. The 49 judged emails are drawn
from this corpus, so without that the nearest neighbour is the email itself at
distance 0.000 and every "prediction" is its own stored label read back. A first
run scored 75% precision that way, which is a measurement of nothing. The
distance column is the tell: a median of 0.000 means the test is answering
itself.

Free. No model calls, one HNSW index scan per email.
"""
import json
import re
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import psycopg2
import psycopg2.extras

REPO = '/Users/gaurav/Code/numera-inboxpulse'
EMBED_URL = 'https://crm-embeddings-203731638840.us-central1.run.app'
KS = (1, 3, 5, 10, 20)


def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def db_url() -> str:
    src = open(f'{REPO}/apps/api/.env.local').read()
    return re.search(r'DATABASE_URL=(\S+)', src).group(1).replace(':5433/', ':5434/')


def prepare(subject: str, body: str) -> str:
    t = f'{subject or ""}\n{body or ""}'
    t = re.sub(r'<(style|script|head)[\s\S]*?</\1>', ' ', t, flags=re.I)
    t = re.sub(r'<!--[\s\S]*?-->', ' ', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    for a, b in [('&nbsp;', ' '), ('&amp;', '&'), ('&#39;', "'"), ('&quot;', '"')]:
        t = t.replace(a, b)
    t = re.split(r'On .{0,200}?\bwrote:|From:\s', t)[0]
    return re.sub(r'\s+', ' ', t).strip()[:2000]


# Plain ORDER BY ... LIMIT so the HNSW index is usable — a window function here
# costs 18 seconds against 35,653 vectors instead of milliseconds.
SQL = """
SELECT ea.sentiment_value, (e.embedding <=> %(v)s::halfvec) AS distance,
       split_part(e.from_email, '@', 2) AS dom
FROM emails e
JOIN email_analyses ea
  ON ea.email_id = e.id AND ea.analysis_type = 'sentiment' AND ea.tenant_id = e.tenant_id
WHERE e.embedding IS NOT NULL
  AND ea.sentiment_value IS NOT NULL
  AND length(e.body) >= 200
  AND e.body NOT LIKE %(pool)s
  AND e.id <> %(self_id)s
  AND e.thread_id <> (SELECT thread_id FROM emails WHERE id = %(self_id)s)
ORDER BY e.embedding <=> %(v)s::halfvec
LIMIT %(k)s
"""


def main() -> None:
    idtok = sh(['gcloud', 'auth', 'print-identity-token'])
    if not idtok:
        sys.exit('no identity token — run `gcloud auth login grastogi@mystartupcfo.com`')

    truth_map = json.load(open(f'{REPO}/apps/api/scripts/human-labels.json'))
    rows = [json.loads(l) for l in open(f'{REPO}/apps/api/scripts/sentiment-testset.jsonl')]
    rows = [r for r in rows if r['id'] in truth_map]
    truth = [truth_map[r['id']] == 'y' for r in rows]
    texts = [prepare(r['subject'], r['body']) for r in rows]

    def embed(text):
        body = json.dumps({'model': 'nomic-embed-text', 'prompt': text}).encode()
        req = urllib.request.Request(f'{EMBED_URL}/api/embeddings', data=body,
                                     headers={'content-type': 'application/json',
                                              'Authorization': f'Bearer {idtok}'})
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r)['embedding']

    with ThreadPoolExecutor(max_workers=4) as ex:
        vecs = list(ex.map(embed, texts))

    conn = psycopg2.connect(db_url())
    neighbours = []
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute('SELECT count(*) FROM emails WHERE embedding IS NOT NULL')
        pool = cur.fetchone()[0]
        for v, r in zip(vecs, rows):
            cur.execute(SQL, {'v': f'[{",".join(map(repr, v))}]',
                              'pool': '%poolbrain.com%', 'k': max(KS),
                              'self_id': r['id']})
            cur2 = conn.cursor()
            cur2.execute('SELECT split_part(from_email, %s, 2) FROM emails WHERE id = %s',
                         ('@', r['id']))
            own = cur2.fetchone()[0]
            cur2.close()
            neighbours.append([(x['sentiment_value'], float(x['distance']), x['dom'], own)
                               for x in cur.fetchall()])
    conn.close()

    print(f'{len(rows)} human-judged emails, {sum(truth)} complaints; '
          f'pool {pool:,} vectors\n')

    print('CALLING IT A COMPLAINT when any of the k nearest is one:')
    print(f"{'k':>4}{'flags':>7}{'caught':>8}{'false':>7}{'precision':>11}{'recall':>9}")
    for k in KS:
        pred = [any(s == 'negative' for s, _, _, _ in n[:k]) for n in neighbours]
        tp = sum(1 for i in range(len(pred)) if pred[i] and truth[i])
        fp = sum(1 for i in range(len(pred)) if pred[i] and not truth[i])
        print(f'{k:>4}{sum(pred):>7}{tp:>8}{fp:>7}'
              f'{100 * tp / max(tp + fp, 1):>10.0f}%{100 * tp / sum(truth):>8.0f}%')

    print('\nCALLING IT BENIGN when none of the k nearest is a complaint:')
    print(f"{'k':>4}{'cleared':>9}{'wrongly':>9}{'% of mail':>11}")
    for k in KS:
        clear = [not any(s == 'negative' for s, _, _, _ in n[:k]) for n in neighbours]
        missed = sum(1 for i in range(len(clear)) if clear[i] and truth[i])
        print(f'{k:>4}{sum(clear):>9}{missed:>9}{100 * sum(clear) / len(clear):>10.0f}%')

    print('\nHOW CLOSE IS THE NEAREST NEIGHBOUR? (cosine distance, 0 = identical)')
    d1 = [n[0][1] for n in neighbours if n]
    comp = [n[0][1] for n, t in zip(neighbours, truth) if n and t]
    ben = [n[0][1] for n, t in zip(neighbours, truth) if n and not t]
    print(f'  all emails      median {sorted(d1)[len(d1) // 2]:.3f}')
    if comp:
        print(f'  complaints      median {sorted(comp)[len(comp) // 2]:.3f}')
    if ben:
        print(f'  non-complaints  median {sorted(ben)[len(ben) // 2]:.3f}')
    print('\n  A neighbour at 0.0 is the same email; near 0.3 is the same topic;')
    print('  past ~0.5 "nearest" stops meaning similar.')

    # You are the average of five friends. If all five are the same unhappy
    # client, the label says more about them than about this email.
    print('\nECHO CHAMBER — how much of each neighbourhood is the SAME client:')
    share = [sum(1 for _, _, d, own in n[:5] if d == own) for n in neighbours]
    print(f'  same-client neighbours, mean {sum(share) / len(share):.1f} of 5')
    print(f'  neighbourhoods that are 3+ the same client: '
          f'{sum(1 for s in share if s >= 3)} of {len(share)}')

    print('\nREQUIRING A DIVERSE NEIGHBOURHOOD before promoting (k=5):')
    print(f"{'max same-client':>17}{'flags':>7}{'caught':>8}{'false':>7}{'precision':>11}")
    for cap in (5, 4, 3, 2):
        pred = []
        for n in neighbours:
            top = n[:5]
            same = sum(1 for _, _, d, own in top if d == own)
            pred.append(same <= cap and any(s == 'negative' for s, _, _, _ in top))
        tp = sum(1 for i in range(len(pred)) if pred[i] and truth[i])
        fp = sum(1 for i in range(len(pred)) if pred[i] and not truth[i])
        note = '  (no cap)' if cap == 5 else ''
        print(f'{cap:>17}{sum(pred):>7}{tp:>8}{fp:>7}'
              f'{100 * tp / max(tp + fp, 1):>10.0f}%{note}')


if __name__ == '__main__':
    main()

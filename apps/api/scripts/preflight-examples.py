"""
Decide whether SENTIMENT_EXAMPLES_ENABLED is safe to turn on, without turning it on.

    python3 apps/api/scripts/preflight-examples.py

Runs the DEPLOYED prompt twice over the 49 human-judged emails: once as production
runs it today, once with worked examples retrieved from the live pool by the same
query the service uses. Same model, same prompt, same emails — the only variable
is the examples, so any difference is theirs.

Scored against the human labels in human-labels.json, not against stored
verdicts. Comparing to what the old prompt decided would ask "does the new thing
agree with the old thing", which is not the question.

WHY IT IS RUN AGAIN. The first pre-flight, against a pool of 4,040 vectors,
showed no complaints gained and one extra false alarm, with verdicts changing on
7 of 49 emails. An earlier offline test against the full 35,507-row corpus had
shown retrieval matching the hand-written rulebook exactly. The most likely
explanation is pool density — 4,040 rows held only ~120 complaints, so the
"nearest already-judged email" was often not near at all. This re-runs it once
the backfill is complete.

FAILURES ARE LOUD. An earlier version of this harness reported the production
prompt catching 0 of 49 complaints, which looked like a catastrophic model result
and was an expired gcloud token: every call 403'd and the exception handler
returned "not a complaint". A dead API scored identically to a model that never
fires. Anything above a 5% error rate aborts.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError

import psycopg2
import psycopg2.extras

REPO = '/Users/gaurav/Code/numera-inboxpulse'
EMBED_URL = 'https://crm-embeddings-203731638840.us-central1.run.app'
MODEL = 'gemini-2.5-flash'
LIMIT = 10


def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def db_url() -> str:
    src = open(f'{REPO}/apps/api/.env.local').read()
    return re.search(r'DATABASE_URL=(\S+)', src).group(1).replace(':5433/', ':5434/')


def prepare(subject: str, body: str, cap: int = 380) -> str:
    t = f'{subject or ""}\n{body or ""}'
    t = re.sub(r'<(style|script|head)[\s\S]*?</\1>', ' ', t, flags=re.I)
    t = re.sub(r'<!--[\s\S]*?-->', ' ', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    for a, b in [('&nbsp;', ' '), ('&amp;', '&'), ('&#39;', "'"), ('&quot;', '"')]:
        t = t.replace(a, b)
    t = re.split(r'On .{0,200}?\bwrote:|From:\s', t)[0]
    return re.sub(r'\s+', ' ', t).strip()[:cap]


def deployed_prompt() -> str:
    """Read from modules.ts rather than restating it — a copy of a prompt is a
    second prompt, and it drifts."""
    src = open(f'{REPO}/apps/analysis/src/analyses/modules.ts').read()
    i, j = src.find('## Sentiment Analysis'), src.find('schema: sentimentSchema')
    if i < 0 or j < 0:
        sys.exit('could not locate the sentiment prompt in modules.ts')
    return src[i:j].rsplit('`', 1)[0]


# The service's query, minus the self/thread exclusion — these 49 emails are not
# in the pool, so there is nothing of their own to exclude. Class balance and the
# customer-traffic filter are kept, because they change which examples appear.
SQL = """
WITH candidates AS (
  SELECT e.subject, e.body, ea.sentiment_value,
         (e.embedding <=> %s::halfvec) AS distance,
         ROW_NUMBER() OVER (PARTITION BY (ea.sentiment_value = 'negative')
                            ORDER BY e.embedding <=> %s::halfvec) AS rank_in_class
  FROM emails e
  JOIN email_analyses ea
    ON ea.email_id = e.id AND ea.analysis_type = 'sentiment' AND ea.tenant_id = e.tenant_id
  WHERE e.embedding IS NOT NULL
    AND ea.sentiment_value IS NOT NULL
    AND length(e.body) >= 200
    AND e.body NOT LIKE '%%poolbrain.com%%'
)
SELECT subject, body, sentiment_value FROM candidates
WHERE rank_in_class <= %s ORDER BY distance LIMIT %s
"""


def main() -> None:
    key = os.environ.get('GEMINI_KEY') or sh(
        ['gcloud', 'secrets', 'versions', 'access', 'latest',
         '--secret=GOOGLE_GENERATIVE_AI_API_KEY', '--project', 'project-y-email-sentiment'])
    idtok = sh(['gcloud', 'auth', 'print-identity-token'])
    if not key or not idtok:
        sys.exit('missing credentials — run `gcloud auth login grastogi@mystartupcfo.com`')

    truth_map = json.load(open(f'{REPO}/apps/api/scripts/human-labels.json'))
    rows = [json.loads(l) for l in open(f'{REPO}/apps/api/scripts/sentiment-testset.jsonl')]
    rows = [r for r in rows if r['id'] in truth_map]
    texts = [prepare(r['subject'], r['body'], 1800) for r in rows]
    truth = [truth_map[r['id']] == 'y' for r in rows]
    base = deployed_prompt()

    conn = psycopg2.connect(db_url())
    with conn.cursor() as cur:
        cur.execute('SELECT count(*) FROM emails WHERE embedding IS NOT NULL')
        pool = cur.fetchone()[0]
    print(f'{len(rows)} human-judged emails, {sum(truth)} complaints; pool is {pool:,} vectors\n',
          flush=True)

    def embed(text):
        body = json.dumps({'model': 'nomic-embed-text', 'prompt': text[:2000]}).encode()
        req = urllib.request.Request(f'{EMBED_URL}/api/embeddings', data=body,
                                     headers={'content-type': 'application/json',
                                              'Authorization': f'Bearer {idtok}'})
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r)['embedding']

    with ThreadPoolExecutor(max_workers=4) as ex:
        vecs = list(ex.map(embed, texts))

    def examples_for(vec):
        v = f'[{",".join(map(repr, vec))}]'
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(SQL, (v, v, (LIMIT + 1) // 2, LIMIT))
            found = cur.fetchall()
        shots = [f"EMAIL: {prepare(r['subject'], r['body'])}\nVERDICT: {r['sentiment_value']}"
                 for r in found if len(prepare(r['subject'], r['body'])) >= 50]
        if len(shots) < 4:
            return ''
        return ('Emails from this same mailbox that have already been judged. '
                'Match the reasoning they imply.\n\n' + '\n\n'.join(shots))

    shots = [examples_for(v) for v in vecs]
    print(f'retrieved examples for {sum(1 for s in shots if s)}/{len(rows)} emails\n', flush=True)

    errors = []

    def judge(prompt):
        body = json.dumps({'contents': [{'parts': [{'text': prompt}]}],
                           'generationConfig': {'maxOutputTokens': 1200, 'temperature': 0}}).encode()
        url = (f'https://generativelanguage.googleapis.com/v1beta/models/'
               f'{MODEL}:generateContent?key={key}')
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(
                        url, data=body, headers={'content-type': 'application/json'}),
                        timeout=90) as r:
                    d = json.load(r)
                t = ''.join(p.get('text', '') for c in d.get('candidates', [])
                            for p in c.get('content', {}).get('parts', []))
                if re.search(r'\bnegative\b', t, re.I):
                    return True
                if re.search(r'\b(neutral|positive)\b', t, re.I):
                    return False
                errors.append(f'unparsed: {t[:100]!r}')
                return None
            except HTTPError as e:
                errors.append(f'HTTP {e.code}: {e.read()[:150]!r}')
                time.sleep(1.5 * (attempt + 1))
            except Exception as e:
                errors.append(f'{type(e).__name__}: {e}')
                time.sleep(1.5 * (attempt + 1))
        return None

    def without(i):
        return judge(f'{base}\n\n## Email\n{texts[i]}')

    def with_ex(i):
        return without(i) if not shots[i] else judge(f'{base}\n\n{shots[i]}\n\n## Email\n{texts[i]}')

    with ThreadPoolExecutor(max_workers=8) as ex:
        a = list(ex.map(without, range(len(rows))))
    with ThreadPoolExecutor(max_workers=8) as ex:
        b = list(ex.map(with_ex, range(len(rows))))

    failed = sum(1 for v in a + b if v is None)
    if failed > len(rows) * 0.1:
        print(f'ABORTING: {failed} calls failed — these are not model results.\n')
        for e in errors[:3]:
            print('  ' + e)
        sys.exit(1)

    def score(name, v):
        v = [bool(x) for x in v]
        tp = sum(1 for i in range(len(v)) if truth[i] and v[i])
        fp = sum(1 for i in range(len(v)) if not truth[i] and v[i])
        print(f'  {name:24} catches {tp}/{sum(truth)}   false alarms {fp}')
        return tp, fp

    print('scored against the human labels:')
    ta, fa = score('as production runs now', a)
    tb, fb = score('with retrieved examples', b)
    changed = sum(1 for i in range(len(a)) if bool(a[i]) != bool(b[i]))
    print(f'\n  verdicts changed on {changed} of {len(a)} emails')
    print(f'  caught {tb - ta:+d}   false alarms {fb - fa:+d}')
    conn.close()


if __name__ == '__main__':
    main()

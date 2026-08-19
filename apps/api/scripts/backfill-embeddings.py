"""
Fill emails.embedding from the crm-embeddings service.

    python3 apps/api/scripts/backfill-embeddings.py [limit]

In the repo rather than a scratch directory because the previous copy lived in
/private/tmp and a machine restart erased it mid-run, along with roughly six
hours of local model output. Scratch scripts can live in /tmp; anything you would
have to rewrite cannot.

Writes only to our own column. Nothing here touches Gmail — no label, no modify,
no read of the mailbox. The blast-radius rule covers writes INTO a mailbox; this
is a vector computed from a body we already store.

Idempotent by construction: rows that already carry an embedding are skipped, so
a re-run after an interruption resumes rather than repeats. That is what made the
restart survivable — 24,440 of 35,653 rows were already committed and simply not
re-done.

Judged mail first. An email with no sentiment verdict cannot serve as a worked
example for retrieval, so embedding it buys nothing until it is judged.

The model name is written beside the vector because a vector from a different
embedder is still 768 plausible numbers, and that has to be detectable rather
than silently wrong.
"""
import json
import re
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import psycopg2
import psycopg2.extras

URL = 'https://crm-embeddings-203731638840.us-central1.run.app'
MODEL = 'nomic-embed-text'
ENV_FILE = '/Users/gaurav/Code/numera-inboxpulse/apps/api/.env.local'
BATCH = 200
WORKERS = 8


def token() -> str:
    out = subprocess.run(['gcloud', 'auth', 'print-identity-token'],
                         capture_output=True, text=True)
    t = out.stdout.strip()
    if not t:
        sys.exit('no identity token — run `gcloud auth login grastogi@mystartupcfo.com`')
    return t


def db_url() -> str:
    """Port 5434 is production; 5433 is a colleague's clone with the same password."""
    src = open(ENV_FILE).read()
    m = re.search(r'DATABASE_URL=(\S+)', src)
    if not m:
        sys.exit(f'no DATABASE_URL in {ENV_FILE}')
    return m.group(1).replace(':5433/', ':5434/')


def strip(subject: str, body: str) -> str:
    """The preparation the corpus was embedded with. Change this and the stored
    vectors stop being comparable to the new ones."""
    t = f'{subject or ""} \n {body or ""}'
    t = re.sub(r'<(style|script|head)[\s\S]*?</\1>', ' ', t, flags=re.I)
    t = re.sub(r'<!--[\s\S]*?-->', ' ', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    for a, b in [('&nbsp;', ' '), ('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                 ('&quot;', '"'), ('&#39;', "'")]:
        t = t.replace(a, b)
    t = re.split(r'On .{0,200}?\bwrote:|From:\s', t)[0]
    return re.sub(r'\s+', ' ', t).strip()[:2000]


TOKEN = token()


def embed(text: str):
    body = json.dumps({'model': MODEL, 'prompt': text}).encode()
    req = urllib.request.Request(
        f'{URL}/api/embeddings', data=body,
        headers={'content-type': 'application/json', 'Authorization': f'Bearer {TOKEN}'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                v = json.load(r)['embedding']
            if v and len(v) == 768:
                return v
        except Exception:
            time.sleep(2 * (attempt + 1))
    return None


def main() -> None:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    conn = psycopg2.connect(db_url())
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    cur.execute("""
        SELECT e.id, e.subject, e.body
        FROM emails e
        JOIN email_analyses ea
          ON ea.email_id = e.id AND ea.analysis_type = 'sentiment'
        WHERE e.embedding IS NULL
          AND ea.sentiment_value IS NOT NULL
          AND length(e.body) >= 200
        ORDER BY e.received_at DESC
        LIMIT %s
    """, (limit,))
    rows = cur.fetchall()
    print(f'{len(rows)} judged emails still unembedded', flush=True)

    started = time.time()
    done = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        texts = [strip(r['subject'], r['body']) for r in chunk]
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            vecs = list(ex.map(embed, texts))

        payload = [(f'[{",".join(map(repr, v))}]', MODEL, r['id'])
                   for r, v in zip(chunk, vecs) if v]
        if payload:
            # Commit every batch, not at the end. A run that dies halfway should
            # leave its work behind — that is what made the restart cheap.
            psycopg2.extras.execute_batch(cur, """
                UPDATE emails
                SET embedding = %s::halfvec, embedding_model = %s, embedded_at = now()
                WHERE id = %s
            """, payload)
            conn.commit()
        done += len(payload)
        rate = (time.time() - started) / max(done, 1)
        print(f'  {done}/{len(rows)}  {rate:.2f}s/email  '
              f'~{rate * (len(rows) - done) / 60:.0f}m left', flush=True)

    cur.execute('SELECT count(*) FROM emails WHERE embedding IS NOT NULL')
    print(f'\nembedded {done} this run; {cur.fetchone()[0]} rows carry a vector '
          f'({(time.time() - started) / 60:.1f}m)')
    conn.close()


if __name__ == '__main__':
    main()

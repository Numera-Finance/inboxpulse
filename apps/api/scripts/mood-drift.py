"""
A mood vector per client, and whether its movement predicts trouble.

    python3 apps/api/scripts/mood-drift.py

The idea Gaurav proposed: hold a centroid for each client domain — the average of
everything they have written — and watch it move. A client whose centre of mass
shifts is writing about different things, or in a different way, and that is worth
noticing before any single email trips a classifier.

WHY THIS IS WORTH TESTING AFTER EGO STATE FAILED. Ego state was measured globally:
does Parent/Child predict a complaint across all mail? It added zero recall over
sentiment and was abandoned. That test could not see a client leaving THEIR OWN
baseline, because a single global boundary averages every client's habits into
one. The same blindness explains why a global linear model plateaus at 69% while
nearest-neighbour lookup reaches 85% precision — clients repeat themselves, and
repetition is local.

Drift is the unsupervised version. It needs no labels at all, which means it can
fire on a client whose mail has never been flagged.

THE TEST. Split each domain's mail into months. Compute the centroid per month.
Measure the distance a domain's centroid travels between consecutive months, then
ask whether a large move is followed by a higher complaint rate in the NEXT
month. If drift only coincides with complaints in the same month it is a
restatement of the labels; if it precedes them it is an early warning.

Reported against the base rate, because at 3% prevalence almost anything looks
predictive until compared to doing nothing.
"""
import json
import re
from collections import defaultdict

import numpy as np
import psycopg2

REPO = '/Users/gaurav/Code/numera-inboxpulse'
MIN_PER_MONTH = 8       # below this a centroid is one loud email
MIN_MONTHS = 3


def db_url() -> str:
    src = open(f'{REPO}/apps/api/.env.local').read()
    return re.search(r'DATABASE_URL=(\S+)', src).group(1).replace(':5433/', ':5434/')


def main() -> None:
    conn = psycopg2.connect(db_url())
    cur = conn.cursor()
    cur.execute("""
        SELECT split_part(e.from_email,'@',2) AS dom,
               date_trunc('month', e.received_at) AS mon,
               e.embedding::text,
               (ea.sentiment_value = 'negative') AS is_neg
        FROM emails e
        JOIN email_analyses ea
          ON ea.email_id = e.id AND ea.analysis_type = 'sentiment'
        WHERE e.embedding IS NOT NULL
          AND ea.sentiment_value IS NOT NULL
          AND length(e.body) >= 200
          AND e.body NOT LIKE '%poolbrain.com%'
          AND split_part(e.from_email,'@',2) NOT IN
              ('mystartupcfo.com','gmail.com','google.com','yahoo.com','outlook.com')
    """)

    by = defaultdict(lambda: {'v': [], 'neg': 0})
    for dom, mon, vec, neg in cur:
        cell = by[(dom, mon.strftime('%Y-%m'))]
        cell['v'].append(np.fromstring(vec.strip('[]'), sep=',', dtype=np.float32))
        cell['neg'] += 1 if neg else 0
    conn.close()

    months = defaultdict(dict)
    for (dom, mon), cell in by.items():
        if len(cell['v']) < MIN_PER_MONTH:
            continue
        m = np.mean(cell['v'], axis=0)
        m /= max(np.linalg.norm(m), 1e-9)
        months[dom][mon] = {'centroid': m, 'n': len(cell['v']), 'neg': cell['neg']}

    domains = {d: v for d, v in months.items() if len(v) >= MIN_MONTHS}
    print(f'{len(domains)} client domains with {MIN_MONTHS}+ months of '
          f'{MIN_PER_MONTH}+ judged emails\n')

    # Each observation: how far the centroid moved INTO this month, and whether
    # the NEXT month carried complaints.
    obs = []
    for dom, series in domains.items():
        keys = sorted(series)
        for i in range(1, len(keys) - 1):
            prev, cur_m, nxt = series[keys[i - 1]], series[keys[i]], series[keys[i + 1]]
            drift = float(1 - np.dot(prev['centroid'], cur_m['centroid']))
            obs.append({
                'dom': dom, 'month': keys[i], 'drift': drift,
                'next_rate': nxt['neg'] / nxt['n'],
                'this_rate': cur_m['neg'] / cur_m['n'],
                'next_n': nxt['n'],
            })

    if not obs:
        print('not enough consecutive months')
        return

    base_next = sum(o['next_rate'] * o['next_n'] for o in obs) / sum(o['next_n'] for o in obs)
    print(f'{len(obs)} domain-months observed; base complaint rate next month '
          f'{100 * base_next:.1f}%\n')

    obs.sort(key=lambda o: -o['drift'])
    q = max(len(obs) // 4, 1)
    print(f"{'centroid movement':>19}{'domain-months':>15}{'complaints next month':>23}{'vs base':>9}")
    for name, group in (('biggest quarter', obs[:q]),
                        ('middle half', obs[q:-q] or obs[q:]),
                        ('smallest quarter', obs[-q:])):
        if not group:
            continue
        rate = sum(o['next_rate'] * o['next_n'] for o in group) / sum(o['next_n'] for o in group)
        print(f'{name:>19}{len(group):>15}{100 * rate:>22.1f}%{rate / base_next:>8.2f}x')

    # Same-month comparison. If drift only tracks complaints already present, it
    # is describing the labels rather than anticipating them.
    print()
    same = sum(o['this_rate'] * o['next_n'] for o in obs[:q]) / sum(o['next_n'] for o in obs[:q])
    base_same = sum(o['this_rate'] * o['next_n'] for o in obs) / sum(o['next_n'] for o in obs)
    print(f'  biggest quarter, complaints in the SAME month: {100 * same:.1f}% '
          f'against {100 * base_same:.1f}% base ({same / max(base_same, 1e-9):.2f}x)')
    print('\n  Predictive only if the next-month lift is real and larger than the')
    print('  same-month one. Otherwise drift is a description, not a warning.')

    print('\nBIGGEST MOVERS')
    for o in obs[:8]:
        print(f"  {o['dom']:<26} {o['month']}  moved {o['drift']:.3f}  "
              f"next month {100 * o['next_rate']:.0f}% of {o['next_n']}")


if __name__ == '__main__':
    main()

"""
Propose which orphaned email domains belong to which allocated client.

    python3 apps/api/scripts/propose-domain-links.py            # review list
    python3 apps/api/scripts/propose-domain-links.py --sql      # emit the INSERTs

THE PROBLEM. Mail arrives from a domain no customer record claims, so ingest
creates a NEW customer for it and the allocation stays on the original record.
Hammerhead AI, Inc has six allocated people and holds hammerhead.io; the client
writes from hammerheadco.ai, which sits alone on "Hammerheadco (Auto)" with
nobody. The panel then reports a fire with no owner while six people are assigned.

WHAT DOES NOT WORK, measured rather than assumed:

  name prefix, 8 chars     119 pairs, and among them "Americanexpress" ->
                           "AMERICAN NUTRITION ALLIANCE INC." and "Productiv" ->
                           "Productiva Group USA Limited"
  domain-base prefix        60 pairs, and among them "Prismahealth" -> "Prisma
                           Data, Inc." and "Ascentautism" -> "AscentHealth, Inc."
  shared threads          3,164 pairs - vendors and cc'd third parties share
                           threads as readily as the client does

WHAT DOES WORK is a convention the firm already keeps: a per-client team alias at
our own domain, `hammerheadai@mystartupcfo.com`, sitting on that client's threads.
The local part identifies the client in the allocation sheet, and the external
domain that dominates the alias's threads is the client's real mail domain.

Validated against links already known to be correct: of 146 aliases whose local
part identifies a sheet client, 93 propose a domain that client ALREADY owns. The
method agrees with the firm's own data where that data exists.

STILL A REVIEW QUEUE, NOT A RULE. Spot-checking the new proposals, roughly eight
in ten are right - clinch -> clinchit.io, flourish -> flourishfi.com, livai ->
livai.ai - and the rest are recognisably wrong: our sister company mytaxfiler.com,
or a vendor like stanfordalumni.org. A wrong owner sends somebody to call the
wrong person, which is worse than an empty field, so nothing is written without a
human saying yes.
"""
import argparse
import re
import subprocess
import sys

REPO = '/Users/gaurav/Code/numera-inboxpulse'
TENANT = '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a'

# Never propose these: our own estate, mail providers, and the sister company
# that shows up as the top domain for aliases whose client is quiet.
NEVER = ('mystartupcfo.com', 'mytaxfiler.com', 'gmail.com', 'google.com',
         'yahoo.com', 'outlook.com', 'hotmail.com', 'stanfordalumni.org')

SQL = """
WITH alias AS (
  -- EVERY address at our own domain, not just the ones named "... Team ...".
  -- Hammerhead's alias is a user row called "Hammerheadai (Auto)", so a name
  -- filter dropped the very case this script was written for. The name is not
  -- load-bearing anyway: a real person's local part does not prefix a client key
  -- in the allocation sheet, so staff addresses fall out on their own. 642
  -- team-named users against 1,401 addresses in contacts is the size of what a
  -- name filter was hiding.
  SELECT DISTINCT lower(email) AS a FROM (
    SELECT email FROM users    WHERE tenant_id = %(t)s AND lower(email) LIKE '%%@mystartupcfo.com'
    UNION
    SELECT email FROM contacts WHERE tenant_id = %(t)s AND lower(email) LIKE '%%@mystartupcfo.com'
  ) x
), th AS (
  SELECT DISTINCT p.email_id, lower(p.email) AS addr
  FROM email_participants p JOIN emails e ON e.id = p.email_id
  WHERE e.tenant_id = %(t)s AND p.email LIKE '%%@%%'
), link AS (
  SELECT al.a, lower(split_part(t2.addr, '@', 2)) AS ext,
         count(DISTINCT t1.email_id) AS n
  FROM alias al
  JOIN th t1 ON t1.addr = al.a
  JOIN th t2 ON t2.email_id = t1.email_id
  WHERE lower(split_part(t2.addr, '@', 2)) NOT IN %(never)s
  GROUP BY 1, 2
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY a ORDER BY n DESC) rk,
         sum(n) OVER (PARTITION BY a) tot
  FROM link
), top AS (
  SELECT split_part(a, '@', 1) AS al, ext, n, round(100.0 * n / tot) AS pct
  FROM ranked WHERE rk = 1 AND n >= %(minthreads)s
), truth AS (
  SELECT DISTINCT ca.client_key, ca.client_name, ca.customer_id, lower(cd.domain) AS dom
  FROM customer_allocations ca
  JOIN customer_domains cd ON cd.customer_id = ca.customer_id
  WHERE ca.tenant_id = %(t)s AND ca.customer_id IS NOT NULL
)
SELECT t.al, t.ext, t.n, t.pct,
       (SELECT client_name FROM truth WHERE client_key LIKE t.al || '%%' LIMIT 1),
       (SELECT customer_id::text FROM truth WHERE client_key LIKE t.al || '%%' LIMIT 1),
       (SELECT c.name FROM customer_domains cd2 JOIN customers c ON c.id = cd2.customer_id
         WHERE lower(cd2.domain) = t.ext AND cd2.tenant_id = %(t)s LIMIT 1)
FROM top t
WHERE t.pct >= %(minpct)s
  AND EXISTS (SELECT 1 FROM truth WHERE client_key LIKE t.al || '%%')
  -- only propose what the client does not already own
  AND NOT EXISTS (SELECT 1 FROM truth WHERE client_key LIKE t.al || '%%' AND dom = t.ext)
ORDER BY t.pct DESC, t.n DESC
"""


def db_url() -> str:
    src = open(f'{REPO}/apps/api/.env.local').read()
    return re.search(r'DATABASE_URL=(\S+)', src).group(1).replace(':5433/', ':5434/')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--sql', action='store_true', help='emit INSERTs instead of the review list')
    ap.add_argument('--min-pct', type=int, default=80, help='minimum share of the alias threads')
    ap.add_argument('--min-threads', type=int, default=5)
    args = ap.parse_args()

    try:
        import psycopg2
    except ImportError:
        sys.exit('pip install psycopg2-binary')

    conn = psycopg2.connect(db_url())
    cur = conn.cursor()
    cur.execute(SQL, {'t': TENANT, 'never': NEVER,
                      'minpct': args.min_pct, 'minthreads': args.min_threads})
    rows = cur.fetchall()
    conn.close()

    if args.sql:
        print('-- Review each line before running. A wrong domain sends somebody')
        print('-- to call the wrong client, which is worse than an empty field.')
        for al, ext, n, pct, client, cust_id, currently in rows:
            if not cust_id:
                continue
            print(f"-- {al}@ -> {ext}  ({n} threads, {pct}% of that alias)"
                  f"{'  [currently on: ' + currently + ']' if currently else ''}")
            print(f"INSERT INTO customer_domains (customer_id, tenant_id, domain) "
                  f"VALUES ('{cust_id}', '{TENANT}', '{ext}') ON CONFLICT DO NOTHING;  -- {client}")
        return

    print(f'{len(rows)} proposed links (>= {args.min_pct}% of an alias\'s threads, '
          f'>= {args.min_threads} threads)\n')
    print(f"{'alias':<22}{'proposed domain':<32}{'thr':>5}{'%':>5}  client on the sheet")
    print('-' * 108)
    for al, ext, n, pct, client, _cust, currently in rows:
        note = f'   [sits on: {currently}]' if currently else ''
        print(f'{al:<22}{ext:<32}{n:>5}{pct:>5}  {str(client)[:38]}{note}')
    print('\nEach line says: this alias belongs to that client, and this domain '
          'dominates the alias\'s mail.')
    print('Confirm the ones you recognise; --sql emits INSERTs for those.')


if __name__ == '__main__':
    main()

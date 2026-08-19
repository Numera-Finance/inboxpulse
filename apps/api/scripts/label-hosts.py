"""
Spread panel labelling across every ollama on the tailnet.

One laptop labels ~1.2 emails/second per model. The corpus is 35,507 messages and
the unanalysed backlog is another 92,700, each needing four judgements, so a
single machine measures the job in days. Three machines measure it in hours, and
the work is embarrassingly parallel — every email is independent.

HOSTS

Filled in by `discover()`, which probes each candidate and keeps only the ones
that answer AND carry the exact models the panel was calibrated on. A host with a
smaller model is not a slower worker, it is a different judge: `qwen2.5:7b` and
`qwen2.5:32b` disagree, so mixing them silently changes what the labels mean.
Wrong labels arrive faster, which is the worst possible outcome.

REACHING A HOST

ollama binds to 127.0.0.1 by default, so a machine can be up, running, idle and
still invisible on the tailnet. The fix is an SSH tunnel from here, not
`OLLAMA_HOST=0.0.0.0` on the remote box:

    ssh -N -L 11500:127.0.0.1:11434 <tailscale-ip>

The tunnel needs no change to the remote machine, exposes the model server to
nobody else, and dies when the SSH session does. Rebinding ollama to all
interfaces would leave an unauthenticated model server listening on a shared
network long after the job finished.

NEVER USE THE CLOUD MODELS

Several of these machines have `*-cloud` models installed — `kimi-k2:1t-cloud`,
`minimax-m2:cloud`, `gemini-3-flash-preview:cloud`. They look like local models in
`ollama list` and they are not: the prompt goes to Moonshot, MiniMax or Google.
Client email must not leave the tailnet, which is the entire reason this pipeline
runs on local models at all. `discover()` refuses any model name containing
'cloud'.
"""
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# Models the panel was calibrated against. A host without these is not used.
REQUIRED = ('gemma3:27b', 'qwen2.5:32b')

# (label, base url). Tunnelled hosts appear as a local port.
CANDIDATES = [
    ('macbook', 'http://127.0.0.1:11434'),
    ('mini', 'http://100.83.59.41:11434'),
    ('studio', 'http://127.0.0.1:11500'),  # ssh -N -L 11500:127.0.0.1:11434 100.119.37.29
]


def _get(url: str, timeout: int = 6):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def discover(required: tuple = REQUIRED, verbose: bool = True) -> list:
    """Hosts that answer and hold every required model. Cloud models disqualify."""
    live = []
    for name, base in CANDIDATES:
        try:
            names = {m['name'] for m in _get(f'{base}/api/tags').get('models', [])}
        except Exception as e:
            if verbose:
                print(f'  {name:8} unreachable ({type(e).__name__})')
            continue
        cloud = {n for n in names if 'cloud' in n}
        missing = [m for m in required if m not in names]
        if missing:
            if verbose:
                print(f'  {name:8} skipped — missing {", ".join(missing)}'
                      + (f'  [also has {len(cloud)} cloud models, never used]' if cloud else ''))
            continue
        live.append((name, base))
        if verbose:
            print(f'  {name:8} ready'
                  + (f'  [has {len(cloud)} cloud models, never used]' if cloud else ''))
    return live


def judge(base: str, model: str, prior: str, task: str, text: str) -> bool:
    """One vote on one host. Unanswerable counts as NO — see label-panel.py."""
    body = json.dumps({
        'model': model,
        'prompt': f'{prior}\n\n{task}\n\n## Email\n{text}\n\nAnswer (YES or NO):',
        'stream': False,
        'options': {'temperature': 0, 'num_predict': 8},
    }).encode()
    req = urllib.request.Request(f'{base}/api/generate', data=body,
                                 headers={'content-type': 'application/json'})
    import re
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                out = json.load(r)['response'].upper()
            hits = re.findall(r'\b(YES|NO)\b', out)
            return bool(hits) and hits[0] == 'YES'
        except Exception:
            time.sleep(2 * (attempt + 1))
    return False


def vote_distributed(texts: list, model: str, prior: str, task: str,
                     hosts: list, per_host: int = 4, verbose: bool = True,
                     label: str = '') -> list:
    """One prior, one model, every host.

    Work is dealt round-robin rather than in contiguous blocks, so a slow machine
    delays a scattering of emails instead of owning the last third of the corpus.

    `label` names the prior in the log. Without it the progress line prints the
    entire prior text, which is several sentences long and makes the log
    unreadable at exactly the moment it is being read.
    """
    if not hosts:
        raise RuntimeError('no hosts hold the calibrated models — refusing to '
                           'substitute a smaller one, which would change the labels')
    started = time.time()
    out = [False] * len(texts)

    # A shared queue, not round-robin. Dealing work evenly is the obvious design
    # and it is slower than one machine: the slowest box sets the pace while the
    # fastest sits idle waiting for its turn to matter. Measured on this corpus,
    # even dealing across three machines ran 2.75s/email against 1.25s/email on
    # the laptop alone. Pulling from a queue needs no speed measurement and no
    # tuning — a machine twice as fast simply takes twice as many.
    from queue import Queue
    work = Queue()
    for i in range(len(texts)):
        work.put(i)
    done = [0]
    lock = __import__('threading').Lock()

    def worker(base):
        while True:
            try:
                i = work.get_nowait()
            except Exception:
                return
            v = judge(base, model, prior, task, texts[i])
            with lock:
                out[i] = v
                done[0] += 1
                n = done[0]
            if verbose and n % 500 == 0:
                rate = (time.time() - started) / n
                print(f'    {n}/{len(texts)}  {rate:.2f}s/email  '
                      f'~{rate * (len(texts) - n) / 60:.0f}m left', flush=True)

    threads = [(name, base) for name, base in hosts for _ in range(per_host)]
    with ThreadPoolExecutor(max_workers=len(threads)) as ex:
        list(ex.map(lambda hb: worker(hb[1]), threads))
    if verbose:
        print(f'  {model}/{label or "prior"}: {sum(out)} of {len(texts)} fired, '
              f'{(time.time() - started) / 60:.1f}m on {len(hosts)} hosts', flush=True)
    return out


if __name__ == '__main__':
    print('probing hosts:')
    live = discover()
    print(f'\n{len(live)} usable host(s): {", ".join(n for n, _ in live)}')

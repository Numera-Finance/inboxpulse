import json, glob, os, collections
S=os.path.dirname(os.path.abspath(__file__))
local={r['id']:r['mode'] for r in json.load(open(f'{S}/local_modes.json'))}
judge={}; conf={}
for f in sorted(glob.glob(f'{S}/judge_*.json')):
    try: rows=json.load(open(f))
    except Exception as e: print('skip',os.path.basename(f),e); continue
    for r in rows:
        judge[r['id']]=r['mode']; conf[r['id']]=r.get('confidence','high')
both=[i for i in local if i in judge]
print(f"judged {len(judge)} of {len(local)}   comparable {len(both)}")
if not both: raise SystemExit
agree=[i for i in both if local[i]==judge[i]]
print(f"AGREEMENT {len(agree)}/{len(both)} = {100*len(agree)/len(both):.0f}%")
hi=[i for i in both if conf[i]=='high']
if hi:
    ah=[i for i in hi if local[i]==judge[i]]
    print(f"  on high-confidence judgements only: {len(ah)}/{len(hi)} = {100*len(ah)/len(hi):.0f}%")
MODES=['complaint','scheduling','opportunity','working','fyi']
print("\nCONFUSION  rows=local (predicted)  cols=haiku (reference)")
print("            "+"".join(m[:9].rjust(11) for m in MODES)+"    total")
for lm in MODES:
    row=[sum(1 for i in both if local[i]==lm and judge[i]==jm) for jm in MODES]
    print(f"  {lm:<10}"+"".join(str(v).rjust(11) for v in row)+str(sum(row)).rjust(9))
print("  "+"-"*68)
print(f"  {'haiku tot':<10}"+"".join(str(sum(1 for i in both if judge[i]==jm)).rjust(11) for jm in MODES))
print("\nPER-MODE (local as predictor)")
for m in MODES:
    tp=sum(1 for i in both if local[i]==m and judge[i]==m)
    fp=sum(1 for i in both if local[i]==m and judge[i]!=m)
    fn=sum(1 for i in both if local[i]!=m and judge[i]==m)
    p=tp/(tp+fp) if tp+fp else float('nan'); r=tp/(tp+fn) if tp+fn else float('nan')
    print(f"  {m:<12} precision {p:5.2f}  recall {r:5.2f}   (predicted {tp+fp}, actual {tp+fn})")
print("\nTOP CONFUSIONS")
c=collections.Counter((local[i],judge[i]) for i in both if local[i]!=judge[i])
for (l,j),n in c.most_common(6):
    print(f"  local said {l:<11} haiku said {j:<11} {n}")
json.dump({'both':both,'local':local,'judge':judge,'conf':conf}, open(f'{S}/compare.json','w'))

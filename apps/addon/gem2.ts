import 'dotenv/config';
import { readThreadLive, writeReplyOptions, classifyThreadMode } from './src/services/live-analysis';
const T = `From: Sean Barrett <sean@callrevu.com>  (Aug 6)
This is the third time I've raised the webhook delay and it still hasn't moved. I'll send over the reconciliation log by Friday so you can see the scale of it. Can you confirm whether the fix is landing this sprint?

From: Dolly Gupta <dgupta@mystartupcfo.com>  (Aug 7)
Thanks Sean. I'll get you a firm date by Tuesday and will loop in our engineering lead.`;
const H = 'Customer: CallRevu\nJul 14 raised webhook delay\nJul 28 raised again, still open';
async function main(){
  for (let i=0;i<3;i++){
    let t=Date.now();
    const m = await classifyThreadMode({ subject:'Webhook delays still not resolved', thread:T });
    const ct=((Date.now()-t)/1000).toFixed(2);
    t=Date.now();
    const [r, opts]: any = await Promise.all([
      readThreadLive({ subject:'Webhook delays still not resolved', thread:T, history:H } as any),
      writeReplyOptions({ subject:'Webhook delays still not resolved', thread:T, history:H }),
    ]);
    const wh=(r?.commitments??[]).some((c:any)=>c.when);
    console.log(`run${i+1}: classify ${ct}s -> ${m} | read+opts ${((Date.now()-t)/1000).toFixed(2)}s | sent=${r?.sentiment} commit=${r?.commitments?.length} when=${wh} qs=${r?.openQuestions?.length} opts=${opts.length}`);
    if(i===0) for(const o of opts) console.log(`   [${o.stance}] ${(o.text||'(on demand)').slice(0,86)}`);
  }
}
main();

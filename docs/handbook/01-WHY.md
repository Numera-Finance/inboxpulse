# Why InboxPulse exists

*Read this first. Everything else in this handbook assumes you accept, or at
least understand, the argument here.*

## The business it serves

Numera (trading as myStartUpCFO) is an outsourced finance firm. Clients hand over
their bookkeeping, controllership and CFO work. The firm currently carries **790
allocated clients**, staffed by roughly **1,400 people**, most of them in India,
serving companies almost entirely in the United States.

The product of that firm is not a spreadsheet. It is confidence. A client who
believes their books are in order does not think about their accountant at all. A
client who has begun to doubt it thinks about very little else.

That doubt arrives by email, and it arrives quietly.

## The problem, stated precisely

**A client rarely announces that they are unhappy.**

We measured this. Of 20 emails that a person read and judged to be genuine
complaints, **only 5 used explicit failure wording** — "unacceptable", "still
waiting", "this is the third time". The other 15 read like this:

> "Could you provide an update on the expected timeline?"

That sentence is courteous, blameless, and contains no complaint word at all. To
an American business reader it is unmistakably a chase, and probably a second or
third one. To a bookkeeper in Pune working through 100 emails before lunch, it is
a routine request for a status update, and it goes to the bottom of the pile.

**That gap is the entire product.**

It is not a language problem in the sense of vocabulary. Everyone involved reads
and writes English well. It is a register problem: American professional English
expresses displeasure by *withdrawing warmth* rather than adding heat. The signal
is in what is missing — no greeting, no thanks, a shorter sentence than last time
— and absence is exactly what a busy reader does not notice.

## Why this cannot be solved by trying harder

Three reasons, each measured rather than assumed.

**Volume.** The corpus holds **136,083 client emails over twelve months**, of
which roughly **3% are complaints**. Finding 3% by reading 100% is not a plan; it
is the current situation, and it is why complaints get missed.

**The complaints do not look like complaints.** See above. A rule that flags
angry words catches a quarter of them. We built exactly that rule and measured
it: a hand-written lexicon of 18 register patterns achieved **13% recall**, and
11 of the 18 patterns never fired once against real mail.

**Nobody is ignoring angry clients on purpose.** The firm answers negative mail
*faster* than routine mail — **53% of complaints get a reply against 36% of
ordinary mail**, at a shorter median. The failure is not sloth. It is that
nobody realised a particular message was a complaint.

## What InboxPulse actually claims to do

It reads a firm's own mailbox and answers one question a manager cannot otherwise
answer: **which client should someone talk to today?**

It does this in a Gmail sidebar, because that is where the work already happens,
and because a tool that requires opening a second application is a tool that gets
opened on Mondays.

Three claims, in descending order of confidence:

1. **A model reads every client email and judges its sentiment.** Measured
   against 49 human-judged emails, the production prompt catches **19 of 20
   complaints**, with 9 false alarms in 49. It costs about **$7 per month** for
   full coverage of this mailbox.

2. **Counting, not inference, says which client is in trouble.** Given what is
   visible about a client this week, the chance they complain next week rises
   from a **5.7% base rate** to **24.7%** when two conditions hold: they
   complained within the last four weeks, and we are in a live back-and-forth
   with them. That is a 4.4x lift, and it needs no model at all.

3. **The panel names a person to call.** Where the firm's allocation sheet has an
   owner, it uses it. Where it does not — which is most of the time, for reasons
   documented in `04-DATA-MODEL.md` — it names whoever has actually been in the
   correspondence, marked as such.

## What it deliberately does not do

**It does not write to the mailbox**, with one exception: labels, applied by a
cron job, namespaced `InboxPulse/` so the entire set can be removed in one
operation. The remover ships with the writer. This constraint is not squeamish;
it is the reason the firm's partners were willing to install it.

**It does not send data anywhere it does not already go.** Analysis runs on a
paid Gemini tier, which contractually excludes training on submitted content.

**It does not tell a reader how someone feels.** Every row on the panel states a
countable fact — three unanswered complaints, twelve messages this week against a
usual two — and lets the reader draw the conclusion. A tool that asserts moods
and is wrong twice stops being consulted.

## The standard everything is held to

> **Would seeing this change what someone does?**

Not "is it true". Not "is it available". A label that only describes a message
has no claim on anyone's attention. `Churn risk` means call them. `Negative`
means read this now. A count of emails ingested means nothing to anybody and was
removed from the panel for that reason.

The same bar killed most of what was built. See `09-DEAD-ENDS.md` — that document
exists so nobody spends another week rediscovering that per-client mood vectors
are flat, or that politeness theory does not separate B2B mail.

## The two things that define success

From the person who commissioned it:

1. **Raise the floor for the average user.** Not the ceiling for the best one.
   The bookkeeper who misses the quiet chase is the user this exists for.
2. **Cut time-to-respond.**

The second one carries a caveat the measurements forced on us, and it is
important enough to state here rather than bury: **reply speed does not predict
escalation.** Within weeks where a real exchange is under way, the chance of a
complaint next week moves from 15.3% to 18.7% across a *twentyfold* range of
response time. That spread is inside the noise.

Answering everyone faster is expensive and buys no measurable reduction in
escalation. Answering *the right client* starts from a 24.7% chance they escalate
again, four times the base rate.

So the lever this product actually pulls is **which client, not how fast**. Speed
still matters for reasons this corpus cannot see — satisfaction, renewal, what a
client tells their peers — it just cannot be sold as escalation prevention.

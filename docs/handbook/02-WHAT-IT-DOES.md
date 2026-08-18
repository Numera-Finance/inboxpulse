# What a user actually sees

*The product surface, section by section, with what each number means and where
it comes from. If you are supporting users, this is the document you will reach
for most.*

## The Gmail sidebar

InboxPulse is a **Google Workspace Add-on**. It renders in the right-hand panel
of Gmail using CardService (Cards v2), which is a JSON format Google turns into
UI. This choice is load-bearing and constrains everything visual:

- **Three fixed text sizes** per row, and no others: `topLabel` (small grey),
  `text` (medium), `bottomLabel` (small grey). No CSS.
- **A tiny HTML subset**: `<b> <i> <u> <s> <font color> <a>`. Nothing else.
- **About 250 pixels wide.** Client names like "Ctruh Technologies Private
  Limited" fill a line on their own.

Most of the visual design decisions in `apps/addon/src/cards/homepage.ts` are
responses to those three facts. A row that spends all three slots reads as a
warren; the fix is usually to spend fewer.

The panel has two states: the **homepage card** (opened without a message) and
the **thread card** (opened on a specific email).

## Homepage sections, in render order

### Where the fires are

Clients with negative mail in the last 90 days, six rows.

```
Berolzheimer (Auto)    3 unanswered
In conversation · Entrenched 22%→25% · 31d · Neeraja Suryadevara · most in touch
```

| element | meaning |
|---|---|
| **3 unanswered** | negative threads with no reply. Red, because it is the part the firm controls. |
| **In conversation** | we are in a live back-and-forth: 4+ messages from them this week, 3+ replies from us. Only shown when true. |
| **Entrenched 22%→25%** | their monthly complaint rate, first to last. See "the arc" below. |
| **31d** | age of the oldest unanswered complaint. |
| **Neeraja Suryadevara** | who to call. |
| **most in touch** | this name came from the correspondence, not the allocation sheet. An assignment is a commitment; this is an observation. |

**Sorted by unanswered, then engagement, then total.** Clicking a row opens the
escalations view filtered to exactly that population.

### The arc: Rising, Cooling, Entrenched

Three words, not two, and the third exists because two mislabelled the clients
who need the most care.

A client steady at 15% for six months rendered as "Cooling 16%→15%", which reads
as improving. Measured across 693 client-months: a client under 10% in a month
behaves exactly like one at zero (2.0% complaints the following month either
way). A client who crosses 10% runs 7.9% the next month and is **still at 5.9%
three months later**, against 1.6% for clients who never crossed.

So `Entrenched` means every month is at or above 10%: a relationship already in
the state, where early contact is months ago and the answer is senior
involvement. `Rising` is someone newly slipping, where early contact is the whole
point. The two lists barely overlap.

### Unhappy clients left waiting

```
of 501 answered messages
27 clients waited more than 5 days to hear back      [See them]

median over 501 replies, last 90 days
12.9h to first reply, against 15.1h for routine mail  [See them]

first reply, monthly median
16.8h in 06 → 7.4h in 08 (improving)
```

**The count of clients leads, not the median**, because the median is the part
that is already fine. Half of unhappy clients hear back the same working day; a
lead reading only that concluded things were acceptable, which was true and
useless. The damage is entirely in the tail.

**Why 12.9h and 7.4h can both be true:** 12.9h is the pooled median of all
individual reply times across 90 days; 7.4h is August alone. June and July hold
383 of those 508 replies and both sit above 13h, so they pull the pooled figure
up. It is not the median of the monthly medians — that would be 13.2h.

**Months need 20+ replies to appear on the trend.** The trend inherits the 90-day
window, so its first bucket is whatever fragment of a month the window clips. On
this tenant that was nine replies spanning two days, presented as "May", and the
whole improving claim rested on it.

### Slowest to answer unhappy clients

Named individuals, with a queue link.

```
Ganesh Shankar
8.9× slower than the firm · 4.8d vs 0.5d · 13 answered   [Their queue]
```

Two guards on this section, both ethical rather than technical:

**Only people genuinely slower than the firm appear.** There was no floor, so the
top N by median showed whoever happened to be slowest even if they were fast.
Piyush Garg answers unhappy clients in 54 minutes, a tenth of the firm median,
and was named under a heading whose whole force is that the people on it are
failing. If nobody clears the bar the section renders empty, which is correct.

**Answered mail only.** A duration exists only where there was a reply, so
someone who never replies cannot appear here and looks better than someone who
replies slowly. That case lives in the fires list. The two sections are only
correct read together, and the caveat is printed on the card.

### Talking more than usual

Clients whose volume has doubled **and who have not complained**. The only
section that fires before anyone writes a complaint.

Worth **2.4x** the base rate — real, and much smaller than the 68% it was first
reported as. It earns its slot because it is the only thing that can flag a
client nobody has looked at yet.

The `we replied 3+ times` condition is not hygiene. Volume with nobody replying
runs **4.4%, below the base rate**, because an unattended spike is a notification
stream.

## The thread card

Opened on a specific email. Leads with the answer rather than the envelope:
Gmail already shows the subject and sender inches away, so repeating them wastes
the fold.

It shows the account, the signals on the thread, any escalation and its assignee,
commitments and unanswered questions extracted from the conversation, and — last
— the message envelope for reference.

**It will not show a quotation the sender did not write.** The model is asked to
quote, and quotes are verified against the source text before rendering. 83% of
stored reasonings quote something; only 53% quote verbatim. A paraphrase
presented inside quotation marks, attributed to a client, is a serious enough
error that the check demotes any unverified quote to a plain claim.

## The teaching layer

Where an email contains a recognised register device, the panel names it: a
litotes ("not ideal"), a counterfactual ("this should have been done last week"),
a chased timeline. Only patterns that name something **literally present in the
text** are shown.

It fires on about **1 in 10** complaints and is silent on the rest, which is the
honest ceiling: explicit register devices are simply rare. The largest single
contributor is the one class *mined from the corpus* rather than invented; every
hand-written "Silicon Valley" pattern fires **zero** times across 1,015 real
complaints.

## What it writes to the mailbox

Labels, namespaced `InboxPulse/`, applied by a cron job. Nothing else. Four rules
govern them, each derived from measurement:

1. **A label firing on more than 5% of mail carries no information.** Checked at
   run time against the actual mailbox. `Automated` was 51.7%.
2. **Never duplicate what Gmail already does.** Automated, Marketing,
   Transactional and Spam are Gmail's own categories.
3. **A label that has never fired is not a label.** Kudos and Escalation were 0
   rows in 125,685.
4. **One label per message.** Three coloured tags is decoration, not triage.

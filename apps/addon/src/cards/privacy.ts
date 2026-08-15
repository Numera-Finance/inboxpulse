import { type Widget, text, deco, buttons, actionButton } from './widgets';

/**
 * What this add-on does with your mail, said before it does it.
 *
 * Written for a reader who has said he is sensitive about his email being
 * read — which is the right reader to write for, because a promise that
 * satisfies him is one the rest can trust.
 *
 * Three rules held to while writing it:
 *
 * SAY THE UNCOMFORTABLE PART. The thread goes to Google's Gemini API. That is
 * the sentence a reader is looking for, so it appears in the block rather than
 * below a fold, in the same weight as the reassuring lines. A privacy notice
 * that omits the third party is worse than none, because it teaches the reader
 * that the rest was drafted to soothe.
 *
 * NO LEGAL VOICE. No "we may", no "in accordance with", no "your privacy is
 * important to us". Every line is a concrete fact about what the software does,
 * in the second person, short enough to finish.
 *
 * CLAIM ONLY WHAT THE CODE ENFORCES. "Nothing is stored" is true because the
 * cache is in memory and its disk backing is unset in production. "Only you see
 * it" is true because the card is rendered per request for the authenticated
 * viewer and logs carry a salted hash instead of an address. Neither is a
 * policy; both are properties. See services/consent.ts for the mapping.
 */
export function privacyBlock(opts: { on: boolean; baseUrl?: string }): Widget[] {
  const lines: Widget[] = [
    deco({
      startIcon: { knownIcon: 'DESCRIPTION' },
      text: opts.on
        ? '<b>Reading is on</b> — only for you, only while you have a thread open'
        : '<b>Your mail is not being read</b>',
      wrapText: true,
    }),
    text(
      '<font color="#5f6368">' +
        '<b>Only if you turn it on.</b> Nothing is read until you press the button below, and only the thread you have open.<br>' +
        '<b>Nothing is kept.</b> The summary lives in memory for a few minutes and is gone. No message text is written to any database.<br>' +
        '<b>Only you see it.</b> This panel is rendered for your account alone. Logs record a one-way hash, not your address.<br>' +
        '<b>It uses Google Gemini.</b> The thread text is sent there to be summarized, and not used to train it.' +
        '</font>',
    ),
  ];

  if (opts.baseUrl) {
    lines.push(
      buttons(
        opts.on
          ? actionButton('Stop reading my mail', `${opts.baseUrl}/consent/revoke`, {})
          : actionButton('Turn on reading', `${opts.baseUrl}/consent/grant`, {}),
      ),
    );
  }
  return lines;
}

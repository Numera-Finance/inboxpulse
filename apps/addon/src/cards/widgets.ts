/**
 * Minimal typed builders for the Google Workspace Add-on "Cards v2" JSON and the
 * HTTP alternate-runtime response envelope.
 *
 * https://developers.google.com/workspace/add-ons/guides/alternate-runtimes
 * A trigger endpoint returns a bare RenderActions message:
 *   { action: { navigations: [ { pushCard: Card } ] } }
 * There is NO outer "renderActions" key — Google parses the response body
 * directly as google.apps.card.v1.RenderActions. (Confirmed the hard way by the
 * runtime error: "Cannot find field: renderActions in message ...RenderActions".)
 */

export interface TextParagraph {
  text: string;
}

export interface Icon {
  knownIcon?: string;
  iconUrl?: string;
}

export interface OpenLink {
  url: string;
  /**
   * How the host opens the link. FULL_SIZE (the default) is a new window/tab and
   * is supported by every client; OVERLAY is a pop-up layered over the host, which
   * keeps the user in place. Per Google's docs OVERLAY "may be ignored if the
   * client does not support it", so it degrades to a tab rather than failing.
   *
   * Deliberately paired with NO `onClose`: when a client can't support both, the
   * docs say onClose takes precedence — which would cost us the overlay.
   */
  openAs?: 'FULL_SIZE' | 'OVERLAY';
  onClose?: 'NOTHING' | 'RELOAD';
}

export interface OnClick {
  action?: { function: string; parameters?: { key: string; value: string }[] };
  openLink?: OpenLink;
}

export interface DecoratedText {
  topLabel?: string;
  text: string;
  bottomLabel?: string;
  wrapText?: boolean;
  startIcon?: Icon;
  /** Makes the whole row clickable (e.g. deep-link into the Gmail message). */
  onClick?: OnClick;
}

export interface Button {
  text: string;
  onClick: OnClick;
}

export interface ButtonList {
  buttons: Button[];
}

export interface Image {
  imageUrl: string;
  altText?: string;
}

export type Widget =
  | { textParagraph: TextParagraph }
  | { decoratedText: DecoratedText }
  | { buttonList: ButtonList }
  | { image: Image }
  | { divider: Record<string, never> };

export interface CardSection {
  header?: string;
  collapsible?: boolean;
  widgets: Widget[];
}

export interface CardHeader {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  imageType?: 'SQUARE' | 'CIRCLE';
}

export interface Card {
  header?: CardHeader;
  sections: CardSection[];
}

export const text = (t: string): Widget => ({ textParagraph: { text: t } });
export const deco = (d: DecoratedText): Widget => ({ decoratedText: d });

/**
 * A blank line.
 *
 * Cards v2 exposes no padding, margin or spacing property on widgets or sections,
 * so the only way to open up space is to emit a widget that renders as
 * whitespace. The text is a NON-BREAKING space, not an empty string: the renderer
 * collapses an empty paragraph to nothing.
 */
export const spacer = (): Widget => ({ textParagraph: { text: '\u00A0' } });

/**
 * A section heading. Card text supports only `<b> <i> <u> <s> <font color> <a>
 * <br>` — there is NO font-size control anywhere in Cards v2 — so bold is the
 * full extent of the emphasis available, and every heading uses it so the card
 * reads as one consistent hierarchy.
 */
export const heading = (label: string): string => `<b>${label}</b>`;

/**
 * Add a blank line below a section, giving the hairline Gmail draws after it room
 * to read as a deliberate break instead of a crowded line. Cards v2 has no
 * divider styling (weight, colour, inset are all fixed), so whitespace is the
 * only lever on how strongly sections separate.
 */
export const spaced = (section: CardSection): CardSection => ({
  ...section,
  widgets: [...section.widgets, spacer()],
});

/** Space every section but the last — nothing follows the last one to separate from. */
export const separated = (sections: CardSection[]): CardSection[] =>
  sections.map((s, i) => (i === sections.length - 1 ? s : spaced(s)));
export const image = (imageUrl: string, altText?: string): Widget => ({ image: { imageUrl, altText } });
export const divider = (): Widget => ({ divider: {} });

export const linkButton = (label: string, url: string): Button => ({
  text: label,
  onClick: { openLink: { url } },
});

export const actionButton = (
  label: string,
  functionUrl: string,
  params?: Record<string, string>,
): Button => ({
  text: label,
  onClick: {
    action: {
      function: functionUrl,
      parameters: params ? Object.entries(params).map(([key, value]) => ({ key, value })) : undefined,
    },
  },
});

export const buttons = (...b: Button[]): Widget => ({ buttonList: { buttons: b } });

/** Wrap a Card in the trigger-response envelope Google expects (a RenderActions). */
export function pushCard(card: Card) {
  return { action: { navigations: [{ pushCard: card }] } };
}

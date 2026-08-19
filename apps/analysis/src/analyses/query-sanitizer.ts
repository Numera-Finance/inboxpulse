/**
 * Repair the two ways a generated Gmail query comes back unrunnable.
 *
 * Both failures look identical from the outside — Gmail returns nothing, no
 * error — so neither is distinguishable downstream from "no context exists".
 * That is why they are fixed here, before the query is ever stored.
 *
 * The first is invented addresses; the second is conjunctions that pin both
 * ends of a conversation and so describe the current message instead of
 * searching around it. See `dropPinnedRecipients`.
 *
 * The model is shown the From / To / Cc lines and still invents addresses that
 * look right — `sandeep@mystartupcfo.com` for a thread whose actual participant
 * is `sshroff@mystartupcfo.com`. Gmail does not error on those; it silently
 * matches nothing, so a single invented address turns the whole query into a
 * quiet zero-result. Nothing downstream can tell that apart from "no context
 * exists", which is why this runs before the result is ever stored.
 *
 * The rule is deliberately narrow: an address in the query that is not a
 * participant of the email is removed ALONG WITH the term carrying it, because
 * a bare `from:` with its value deleted is not a weaker query, it is a syntax
 * error. Everything else the model wrote is left exactly as written — names are
 * not checked (Gmail partial-matches display names, so "Gaurav" is a legitimate
 * term that no participant list can confirm).
 */

/** Matches anything address-shaped, including inside quotes or parentheses. */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Gmail's boolean keywords. Bare `-` negation rides along on the term text. */
const BOOLEAN_KEYWORDS = new Set(['OR', 'AND']);

/** `from:(a OR b)` — an operator whose value is a parenthesised sub-expression. */
const OPERATOR_GROUP_PATTERN = /^(-?)([A-Za-z]+):\((.*)\)$/s;

/**
 * Sender and recipient operators, unnegated. A leading `-` excludes rather than
 * pins, so `-to:x` is not a constraint these rules care about.
 */
const PINS_SENDER = /^from:/i;
const PINS_RECIPIENT = /^to:/i;

type Node =
  | { kind: 'boolean'; text: string }
  | { kind: 'term'; text: string }
  | { kind: 'group'; children: Node[] };

export interface SanitizedQuery {
  /** The query with unverifiable terms removed. Empty if nothing survived. */
  query: string;
  /** Terms that were dropped, verbatim, for logging. */
  removed: string[];
}

/**
 * Collect the addresses a query is allowed to mention: exactly the ones the
 * prompt was shown. Bcc is excluded on purpose — the model never sees it, so an
 * address from it appearing in a query would be a leak, not a match.
 */
export function participantAddresses(email: {
  from?: { email?: string } | null;
  tos?: Array<{ email?: string }> | null;
  ccs?: Array<{ email?: string }> | null;
}): Set<string> {
  const addresses = new Set<string>();
  const add = (value?: string): void => {
    const trimmed = value?.trim().toLowerCase();
    if (trimmed) addresses.add(trimmed);
  };

  add(email.from?.email);
  for (const to of email.tos ?? []) add(to?.email);
  for (const cc of email.ccs ?? []) add(cc?.email);

  return addresses;
}

/** Consume a balanced `(...)` starting at `input[start] === '('`. */
function readBalanced(input: string, start: number): { text: string; next: number } {
  let depth = 0;
  let i = start;
  let quoted = false;

  while (i < input.length) {
    const ch = input[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') {
      depth--;
      if (depth === 0) return { text: input.slice(start, i + 1), next: i + 1 };
    }
    i++;
  }
  // Unbalanced — take the rest verbatim rather than dropping the reader's text.
  return { text: input.slice(start), next: input.length };
}

/** Read one whitespace-delimited term, keeping quoted phrases and `op:(...)` whole. */
function readTerm(input: string, start: number): { text: string; next: number } {
  let buffer = '';
  let i = start;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch) || ch === ')') break;

    if (ch === '"') {
      const close = input.indexOf('"', i + 1);
      if (close === -1) {
        buffer += input.slice(i);
        i = input.length;
        break;
      }
      buffer += input.slice(i, close + 1);
      i = close + 1;
      continue;
    }

    if (ch === '(' && buffer.endsWith(':')) {
      const balanced = readBalanced(input, i);
      buffer += balanced.text;
      i = balanced.next;
      break;
    }

    buffer += ch;
    i++;
  }

  return { text: buffer, next: i };
}

function parseNodes(input: string, start: number, depth: number): { nodes: Node[]; next: number } {
  const nodes: Node[] = [];
  let i = start;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === ')') {
      i++;
      if (depth > 0) break;
      continue; // stray close paren at top level — ignore it
    }

    if (ch === '(') {
      const inner = parseNodes(input, i + 1, depth + 1);
      nodes.push({ kind: 'group', children: inner.nodes });
      i = inner.next;
      continue;
    }

    const term = readTerm(input, i);
    i = term.next;
    if (!term.text) continue;

    nodes.push(
      BOOLEAN_KEYWORDS.has(term.text.toUpperCase())
        ? { kind: 'boolean', text: term.text.toUpperCase() }
        : { kind: 'term', text: term.text }
    );
  }

  return { nodes, next: i };
}

/** Reconstruct a node's source text, for reporting what was dropped. */
function nodeToText(node: Node): string {
  if (node.kind === 'group') return `(${node.children.map(nodeToText).join(' ')})`;
  return node.text;
}

/**
 * Does this operand constrain one end of the conversation?
 *
 * A group counts only when EVERY operand constrains the same end:
 * `(from:a OR from:b)` still guarantees the sender is one of two people, but
 * `(from:a OR to:b)` guarantees nothing about either end.
 */
function pins(node: Node, operator: RegExp): boolean {
  if (node.kind === 'boolean') return false;
  if (node.kind === 'term') return operator.test(node.text);

  const operands = node.children.filter((child) => child.kind !== 'boolean');
  return operands.length > 0 && operands.every((child) => pins(child, operator));
}

/**
 * Drop recipient constraints from any conjunction that already pins the sender.
 *
 * `from:X to:Y` names both ends of a single message — which is a description of
 * the email being read, not a search for context around it. It matches that one
 * message and nothing else. Dropping the `to:` leaves `from:X`, the sender's
 * history, which is the slice actually worth showing.
 *
 * Scoped to conjunctions on purpose. `from:X OR to:Y` is a union, not an
 * intersection: it widens the search rather than collapsing it, and is left
 * alone. `cc:` is also left alone — `from:X cc:me` is a genuinely useful slice,
 * not a restatement of one message.
 */
function dropPinnedRecipients(nodes: Node[], removed: string[]): Node[] {
  // Resolve inner conjunctions first so a group's own from/to pair is gone
  // before this level asks what the group constrains.
  const resolved: Node[] = nodes.map((node) =>
    node.kind === 'group'
      ? { kind: 'group', children: dropPinnedRecipients(node.children, removed) }
      : node
  );

  // OR separates conjunctions; everything else accumulates into the current one.
  const conjunctions: Node[][] = [[]];
  const separators: Node[] = [];
  for (const node of resolved) {
    if (node.kind === 'boolean' && node.text === 'OR') {
      separators.push(node);
      conjunctions.push([]);
      continue;
    }
    conjunctions[conjunctions.length - 1].push(node);
  }

  const kept = conjunctions.map((conjunction) => {
    if (!conjunction.some((node) => pins(node, PINS_SENDER))) return conjunction;

    return conjunction.filter((node) => {
      if (!pins(node, PINS_RECIPIENT)) return true;
      removed.push(nodeToText(node));
      return false;
    });
  });

  // Re-interleave. Booleans left dangling by a removal are cleaned up in render.
  const output: Node[] = [];
  kept.forEach((conjunction, index) => {
    output.push(...conjunction);
    if (index < separators.length) output.push(separators[index]);
  });

  return output;
}

/** Sanitize one term. Returns null when the term must be dropped entirely. */
function sanitizeTerm(text: string, allowed: Set<string>, removed: string[]): string | null {
  const operatorGroup = text.match(OPERATOR_GROUP_PATTERN);
  if (operatorGroup) {
    const [, negation, operator, inner] = operatorGroup;
    const kept = renderNodes(parseNodes(inner, 0, 0).nodes, allowed, removed);
    if (!kept) {
      removed.push(text);
      return null;
    }
    return `${negation}${operator}:(${kept})`;
  }

  const found = text.match(EMAIL_PATTERN) ?? [];
  const unverifiable = found.filter((address) => !allowed.has(address.toLowerCase()));
  if (unverifiable.length > 0) {
    removed.push(text);
    return null;
  }

  return text;
}

/** Render surviving nodes, dropping booleans left dangling by a removal. */
function renderNodes(nodes: Node[], allowed: Set<string>, removed: string[]): string {
  // Groups are rendered to text as they survive, so only flat nodes land here.
  const kept: Array<{ kind: 'boolean' | 'term'; text: string }> = [];

  for (const node of nodes) {
    if (node.kind === 'boolean') {
      kept.push(node);
      continue;
    }

    if (node.kind === 'term') {
      const text = sanitizeTerm(node.text, allowed, removed);
      if (text) kept.push({ kind: 'term', text });
      continue;
    }

    const inner = renderNodes(node.children, allowed, removed);
    // A group emptied by removals contributes nothing; `()` is not valid Gmail.
    if (inner) kept.push({ kind: 'term', text: inner.includes(' ') ? `(${inner})` : inner });
  }

  // Collapse booleans that no longer join two operands.
  const parts: string[] = [];
  for (const node of kept) {
    const isBoolean = node.kind === 'boolean';
    if (isBoolean && parts.length === 0) continue;
    if (isBoolean && BOOLEAN_KEYWORDS.has(parts[parts.length - 1])) continue;
    parts.push(node.text);
  }
  while (parts.length > 0 && BOOLEAN_KEYWORDS.has(parts[parts.length - 1])) parts.pop();

  return parts.join(' ');
}

/**
 * Make a generated query runnable: strip unverifiable addresses, then undo any
 * conjunction that pins both ends of the conversation.
 *
 * A query that loses all of its terms comes back empty rather than being
 * repaired — an invented replacement would be a guess presented as retrieval.
 */
export function sanitizeGmailQuery(query: string, allowed: Set<string>): SanitizedQuery {
  if (!query?.trim()) return { query: '', removed: [] };

  const removed: string[] = [];
  const { nodes } = parseNodes(query, 0, 0);
  // Order matters: widen the shape first, then validate what addresses remain,
  // so an address is never reported as unverifiable in a term already dropped.
  const widened = dropPinnedRecipients(nodes, removed);
  return { query: renderNodes(widened, allowed, removed), removed };
}

/**
 * App-local message shape for passing chat-style prompts to the Vercel AI SDK.
 *
 * We intentionally avoid importing deprecated message types from `ai` (e.g. `CoreMessage`).
 * This type matches the subset we construct today: simple `{ role, content }` messages.
 */
export type PromptMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface PromptMessage {
  role: PromptMessageRole;
  content: string;
}


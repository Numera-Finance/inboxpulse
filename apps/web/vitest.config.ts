import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Default to 'node' for pure-logic tests (no jsdom dependency pulled in).
    // Component tests that touch the DOM must opt in per-file with a docblock:
    //   // @vitest-environment jsdom
    // (and add the `jsdom` devDependency) — otherwise they'll fail with
    // "document is not defined".
    environment: 'node',
  },
});

// Side-effect polyfills that MUST run before any midnight-js provider module
// is evaluated. Imported as the very first line of main.tsx so its effects
// are applied before the imports that pull in the provider packages.
import { Buffer } from 'buffer';

// midnight-js's browser packages assume a global Buffer (Node convention).
if (!('Buffer' in globalThis)) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

// Some midnight-js providers capture a bare `fetch` reference (e.g. the
// indexer GraphQL client) and later call it detached from `window`, which
// throws "Failed to execute 'fetch' on 'Window': Illegal invocation".
// Rebinding the global to `window` makes even a detached reference safe.
if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const boundFetch = window.fetch.bind(window);
  globalThis.fetch = boundFetch;
  window.fetch = boundFetch;
}

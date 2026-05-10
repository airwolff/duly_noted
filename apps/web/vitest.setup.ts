import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auto-cleanup is normally driven by RTL detecting afterEach, but it
// only fires when test globals are exposed; we keep imports explicit
// here and wire cleanup ourselves so each test starts with a fresh DOM.
afterEach(() => {
  cleanup();
});

/**
 * Vitest global setup. Auto-mocks the logger so every test file doesn't have
 * to. Without this, the logger's lazy `require('../env')` call fires on first
 * use and resolution fails inside the vitest runner (no env vars set).
 */
import { vi } from 'vitest';

vi.mock('./src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

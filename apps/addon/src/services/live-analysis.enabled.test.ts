import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Regression: switching LIVE_ANALYSIS_PROVIDER to 'gemini' silently disabled
 * live analysis, because the enable check looked at LIVE_ANALYSIS_URL — which
 * is blank on the gemini path, since that provider carries its own base URL.
 *
 * Every thread then rendered "Not a tracked client thread", including threads
 * with an external customer participant. No error and no log: a config change
 * that reads as empty data.
 */
describe('isLiveAnalysisEnabled', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) if (k.startsWith('LIVE_ANALYSIS')) delete process.env[k];
  });
  afterEach(() => { process.env = { ...saved }; });

  const load = async () => {
    const envMod = await import('../env');
    // getEnv memoises, so each case needs a fresh module registry.
    return envMod;
  };

  it('is enabled on gemini when a key is present, with no LIVE_ANALYSIS_URL', async () => {
    process.env.LIVE_ANALYSIS_PROVIDER = 'gemini';
    process.env.LIVE_ANALYSIS_KEY = 'test-key';
    delete process.env.LIVE_ANALYSIS_URL;
    await load();
    const { isLiveAnalysisEnabled } = await import('./live-analysis');
    expect(isLiveAnalysisEnabled()).toBe(true);
  });
});

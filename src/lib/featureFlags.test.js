import {
  isAssistantEnabled,
  isSiliconExperimentalEnabled,
  setAssistantEnabled,
  setSiliconExperimentalEnabled,
} from './featureFlags';

describe('feature flags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('default to enabled and can be switched independently', () => {
    expect(isAssistantEnabled()).toBe(true);
    expect(isSiliconExperimentalEnabled()).toBe(true);
    setAssistantEnabled(false);
    expect(isAssistantEnabled()).toBe(false);
    expect(isSiliconExperimentalEnabled()).toBe(true);
    setSiliconExperimentalEnabled(false);
    expect(isSiliconExperimentalEnabled()).toBe(false);
    expect(isAssistantEnabled()).toBe(false);
  });
});

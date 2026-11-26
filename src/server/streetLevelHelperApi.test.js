const { projectIdFromKey } = require('./agentPlatformExtrasApi');

test('the street-level helper may only touch local/<projectId>/ keys', () => {
  expect(projectIdFromKey('local/proj_1/streets/a.jpg')).toBe('proj_1');
  expect(projectIdFromKey('local/proj_1/')).toBe('proj_1');
  expect(projectIdFromKey('local/proj_1/../proj_2/a.jpg')).toBeNull();
  expect(projectIdFromKey('templates/x/a.jpg')).toBeNull();
  expect(projectIdFromKey('other/proj_1/a.jpg')).toBeNull();
  expect(projectIdFromKey('local/proj_1')).toBeNull();
  expect(projectIdFromKey('')).toBeNull();
});

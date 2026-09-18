import { handleSurveyMediaError } from './mediaRecovery';

test('media retry is localized and does not select the surrounding survey choice', () => {
  const label = document.createElement('label');
  const img = document.createElement('img');
  img.src = '/missing.jpg'; label.appendChild(img); document.body.appendChild(label);
  const select = jest.fn(); label.addEventListener('click', select);
  handleSurveyMediaError({target: img}, 'zh');
  handleSurveyMediaError({target: img}, 'zh');
  expect(label.querySelectorAll('button')).toHaveLength(1);
  const button = label.querySelector('button');
  expect(button.textContent).toContain('重试');
  button.click();
  expect(select).not.toHaveBeenCalled();
  expect(img.getAttribute('src')).toBe('/missing.jpg');
  expect(label.querySelector('button')).toBeNull();
  label.remove();
});

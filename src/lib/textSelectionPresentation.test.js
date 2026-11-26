import { readSelectedTextFormat, selectedTextRange } from './textSelectionPresentation';
import { FONT_FAMILIES } from './viewportTypography';

const target = { kind: 'question', name: 'q', field: 'title', text: 'First question', start: 0, end: 14 };
let canvas;
beforeEach(() => {
  canvas = document.createElement('div');
  canvas.innerHTML = '<div data-sp-question-name="q"><span data-sp-edit="question-title"><span>First </span><span>question</span></span></div>';
  document.body.appendChild(canvas);
});
afterEach(() => canvas.remove());

test('reads effective styles and distinguishes mixed selections', () => {
  const [first, second] = canvas.querySelectorAll('[data-sp-edit] > span');
  first.style.fontSize = '24px'; second.style.fontSize = '30px';
  first.style.fontFamily = FONT_FAMILIES.serif; second.style.fontFamily = FONT_FAMILIES.mono;
  expect(readSelectedTextFormat(canvas, target)).toMatchObject({ fontFamily: '__mixed', mixedSize: true, fontSize: '' });
  expect(readSelectedTextFormat(canvas, { ...target, start: 6 })).toMatchObject({ fontFamily: 'mono', fontSize: 30, mixedSize: false });
});

test('rebuilds selection ranges after text spans are replaced and rejects stale text', () => {
  const partial = { ...target, start: 6 };
  expect(selectedTextRange(canvas, partial).toString()).toBe('question');
  canvas.querySelector('[data-sp-edit]').innerHTML = '<span>First q</span><span>uestion</span>';
  expect(selectedTextRange(canvas, partial).toString()).toBe('question');
  canvas.querySelector('[data-sp-edit]').textContent = 'Another question';
  expect(selectedTextRange(canvas, partial)).toBeNull();
});

test('reads rich text toggle states, colors, and mixed selections', () => {
  const spans = canvas.querySelectorAll('[data-sp-edit] > span');
  for (const span of spans) {
    span.style.fontWeight = '700'; span.style.fontStyle = 'italic'; span.style.textDecoration = 'underline';
    span.style.color = '#aabbcc'; span.style.backgroundColor = '#fff59d';
  }
  expect(readSelectedTextFormat(canvas, target)).toMatchObject({ bold: true, italic: true, underline: true, color: '#aabbcc', highlight: '#fff59d' });
  spans[1].style.fontWeight = '400'; spans[1].style.backgroundColor = 'transparent';
  expect(readSelectedTextFormat(canvas, target)).toMatchObject({ bold: null, highlight: null });
});

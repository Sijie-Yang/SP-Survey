import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatMarkdown from './ChatMarkdown';

test('renders real markdown emphasis and headings', () => {
  render(<ChatMarkdown>{'**已完成**\n\n## 问卷已生成'}</ChatMarkdown>);
  expect(screen.getByText('已完成').closest('strong, b')).toBeTruthy();
  expect(screen.getByText('问卷已生成')).toBeInTheDocument();
});

test('does not crash on an incomplete fence and keeps the source readable', () => {
  render(<ChatMarkdown>{'```js\nconst x ='}</ChatMarkdown>);
  expect(screen.getByText(/const x =/)).toBeInTheDocument();
});

test('does not render empty assistant text', () => {
  const { container } = render(<ChatMarkdown>{'   '}</ChatMarkdown>);
  expect(container).toBeEmptyDOMElement();
});

import React, { useState } from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { SkillStringListEditor, SkillDimensionsEditor } from './SkillConfigFieldEditors';

test('new empty list entry remains editable until the user fills it', () => {
  function Editor() { const [value, setValue] = useState([]); return <SkillStringListEditor value={value} onChange={setValue} />; }
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Add items' }));
  const item = screen.getByLabelText('Items 1');
  fireEvent.change(item, { target: { value: 'Visible option' } });
  expect(item.value).toBe('Visible option');
});
test('adding a dimension after deletion allocates a unique stable ID', () => {
  const onChange = jest.fn();
  render(<SkillDimensionsEditor value={[{ id: 'dim1' }, { id: 'dim3' }]} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add dimension' }));
  expect(onChange.mock.calls[0][0].map((d) => d.id)).toEqual(['dim1', 'dim3', 'dim4']);
});

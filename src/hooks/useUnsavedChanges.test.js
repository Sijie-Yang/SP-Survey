import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import useUnsavedChanges from './useUnsavedChanges';
function Editor({ dirty, action }) {
  const guard = useUnsavedChanges(dirty);
  return <><button onClick={() => guard.request(action)}>Leave</button>{guard.open && <><button onClick={guard.cancel}>Keep</button><button onClick={guard.discard}>Discard</button></>}</>;
}
test('dirty drafts block reload and require explicit discard for editor actions', () => {
  const action = jest.fn();
  const { rerender, unmount } = render(<Editor dirty action={action} />);
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByText('Leave')); expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Keep')); expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Leave')); fireEvent.click(screen.getByText('Discard')); expect(action).toHaveBeenCalledTimes(1);
  rerender(<Editor dirty={false} action={action} />);
  fireEvent.click(screen.getByText('Leave')); expect(action).toHaveBeenCalledTimes(2);
  unmount();
  const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
});

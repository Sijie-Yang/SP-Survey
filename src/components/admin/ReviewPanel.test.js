import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReviewCard, ReviewComposerOptions } from './ReviewPanel';
import { DEFAULT_REVIEW_OPTIONS, normalizeClientReviewOptions } from '../../lib/reviewMode';

const t = {
  aiReviewApplyRound: 'Apply round {round}',
  aiReviewApplyAll: 'Apply all proposed revisions',
  aiReviewRole_scientist: 'Scientist',
  aiReviewRole_participant: 'Participant',
  aiReviewStatus_max_rounds: 'Maximum rounds reached',
};

function review(overrides = {}) {
  return {
    runId: 'run-1',
    options: { method: 'linear', applyMode: 'review', threshold: 8, roles: ['scientist', 'participant'] },
    status: 'max_rounds',
    rounds: [
      {
        round: 1,
        averageRating: 6,
        decision: 'revise',
        reviews: [
          { role: 'scientist', status: 'completed', rating: 6, comments: 'Sampling unclear', concerns: [{ issue: 'No sampling', severity: 'high', questions: ['q1'] }] },
          { role: 'participant', status: 'failed', error: 'provider 500' },
        ],
        revision: { status: 'proposed', summary: 'Clarify sampling', plan: [{ step: 'Add intro' }], operations: [{ op: 'updateSurvey' }] },
      },
      {
        round: 2,
        averageRating: 7,
        decision: 'revise',
        reviews: [{ role: 'scientist', status: 'completed', rating: 7, comments: 'Better' }],
        revision: { status: 'proposed', summary: 'Polish', plan: [], operations: [{ op: 'updateSurvey' }] },
      },
    ],
    ...overrides,
  };
}

describe('Review mode UI', () => {
  it('normalizes options with all five roles on by default', () => {
    expect(normalizeClientReviewOptions(null)).toEqual({ ...DEFAULT_REVIEW_OPTIONS, roles: [...DEFAULT_REVIEW_OPTIONS.roles] });
    expect(normalizeClientReviewOptions({ roles: ['analyst', 'scientist'], maxRoles: 1 }).roles).toEqual(['scientist']);
  });

  it('toggles reviewers and respects the cap', () => {
    const onChange = jest.fn();
    render(
      <ReviewComposerOptions
        t={t}
        options={normalizeClientReviewOptions({ roles: ['scientist'], maxRoles: 1 })}
        estimate={{ tokens: { min: 1000, max: 9000 }, modelCalls: { min: 2, max: 9 }, costUsd: { min: 0.001, max: 0.2 } }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(/Participant/));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('review-estimate').textContent).toMatch(/9k/);
  });

  it('shows per-role ratings and lets the user apply proposals in order', () => {
    const onApply = jest.fn();
    render(<ReviewCard review={review()} runId="run-1" t={t} onApply={onApply} />);
    expect(screen.getByText('Sampling unclear')).toBeInTheDocument();
    expect(screen.getByText('provider 500')).toBeInTheDocument();
    expect(screen.queryByText('Apply round 2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Apply round 1'));
    expect(onApply).toHaveBeenCalledWith('run-1', [1]);
    fireEvent.click(screen.getByText('Apply all proposed revisions'));
    expect(onApply).toHaveBeenCalledWith('run-1', [1, 2]);
  });

  it('hides apply buttons for apply-each-round runs and while a run is active', () => {
    const { rerender } = render(
      <ReviewCard review={review({ options: { ...review().options, applyMode: 'apply' } })} runId="run-1" t={t} />,
    );
    expect(screen.queryByText('Apply round 1')).not.toBeInTheDocument();
    rerender(<ReviewCard review={review({ status: 'running' })} runId="run-1" t={t} />);
    expect(screen.queryByText('Apply round 1')).not.toBeInTheDocument();
  });
});

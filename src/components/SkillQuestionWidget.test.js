import React from 'react';
import { act, render, screen } from '@testing-library/react';
import SkillQuestionFrame, { skillAnswerPresent } from './SkillQuestionWidget';
import {
  captureSkillPreviewAnswers,
  isSkillAnswerReviewMode,
  resolveSkillQuestionValue,
} from './SurveyCustomComponents';

describe('skillAnswerPresent', () => {
  it('rejects empty / context-only answers', () => {
    expect(skillAnswerPresent(null)).toBe(false);
    expect(skillAnswerPresent('')).toBe(false);
    expect(skillAnswerPresent({})).toBe(false);
    expect(skillAnswerPresent({ imageUrl: 'https://x/a.jpg' })).toBe(false);
    expect(skillAnswerPresent({ shown_images: ['a.jpg'] })).toBe(false);
  });

  it('accepts real answer payloads', () => {
    expect(skillAnswerPresent(42)).toBe(true);
    expect(skillAnswerPresent({ score: 1 })).toBe(true);
    expect(skillAnswerPresent({ marks: [{ x: 0.1, y: 0.2 }], imageUrl: 'https://x/a.jpg' })).toBe(true);
    expect(skillAnswerPresent(['a', 'b'])).toBe(true);
  });
});

describe('skill preview answer snapshot', () => {
  function makeSurvey(value, dataValue = undefined) {
    const question = {
      name: 'custom_skill',
      value,
      skillAnswerSnapshot: null,
      getType: () => 'skillquestion',
    };
    const survey = {
      data: dataValue === undefined ? {} : { custom_skill: dataValue },
      getAllQuestions: () => [question],
    };
    question.survey = survey;
    return { survey, question };
  }

  it('captures a real object answer before SurveyJS enters preview', () => {
    const original = { score: 4, choice: 'A' };
    const { survey, question } = makeSurvey(original);
    const snapshot = captureSkillPreviewAnswers(survey);

    expect(snapshot).toEqual({ custom_skill: original });
    expect(question.skillAnswerSnapshot).toEqual(original);
    expect(question.skillAnswerSnapshot).not.toBe(original);

    // Preview clones can lose the live field value; the frozen answer still wins.
    question.value = null;
    expect(resolveSkillQuestionValue(question, null, true)).toEqual(original);
  });

  it('falls back to SurveyJS data and ignores context-only payloads', () => {
    const recorded = { selected: ['x'] };
    const { survey, question } = makeSurvey({ imageUrl: 'stimulus.jpg' }, recorded);
    expect(captureSkillPreviewAnswers(survey)).toEqual({ custom_skill: recorded });

    question.value = null;
    question.skillAnswerSnapshot = { imageUrl: 'stimulus.jpg' };
    survey.__skillPreviewAnswers = {};
    survey.data = {};
    expect(resolveSkillQuestionValue(question, null, true)).toBeNull();
  });

  it('does not confuse Admin display mode with participant answer review', () => {
    expect(isSkillAnswerReviewMode({
      isReadOnly: true,
      survey: { mode: 'display', state: 'running' },
    })).toBe(false);
    expect(isSkillAnswerReviewMode({
      isReadOnly: true,
      survey: { mode: 'display', state: 'preview' },
    })).toBe(true);
  });

  it('renders the frozen answer in preview without requiring executable Skill HTML', () => {
    render(
      <SkillQuestionFrame
        skillHtml=""
        skillId="private-skill"
        value={{ score: 5 }}
        readOnly
        resultSchema={[{ key: 'score', label: 'Score', type: 'number' }]}
      />,
    );

    expect(screen.queryByText('Skill HTML not configured.')).toBeNull();
    expect(screen.getByText(/score: 5/i)).toBeTruthy();
    expect(screen.queryByTitle('skill-question')).toBeNull();
  });
});


describe('custom result contract at the iframe boundary', () => {
  it('rejects out-of-range answers, clears previous validity and permits correction', () => {
    const onChange = jest.fn();
    render(<SkillQuestionFrame skillId="custom" skillHtml="<button>Test</button>"
      resultSchema={[{ key: 'score', type: 'rating', min: 0, max: 5 }]}
      value={null} onChange={onChange} />);
    const iframe = screen.getByTitle('skill-question');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    const send = (score, source = iframe.contentWindow) => act(() => {
      window.dispatchEvent(new MessageEvent('message', { source,
        data: { source: 'sp-survey-skill', type: 'answer', value: { score } } }));
    });
    send(3, window);
    expect(onChange).not.toHaveBeenCalled();
    send(0);
    expect(onChange).toHaveBeenLastCalledWith({ score: 0 });
    send(99);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('alert').textContent).toContain('invalid answer');
    send(5);
    expect(onChange).toHaveBeenLastCalledWith({ score: 5 });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not regard incomplete Best–Worst output as an answer', () => {
    expect(skillAnswerPresent({ bestIndex: 0, worstIndex: null, complete: false })).toBe(false);
  });
});

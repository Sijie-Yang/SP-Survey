import { isNoPreference } from './choiceTie.js';
import { answerToSelectedKeys, filenameKey } from './trueskill.js';

/** A/B identify the first/second stimulus in the recorded shown_images order. */
export function choiceOutcome(answer, shownImages = []) {
  if (isNoPreference(answer)) return 'tie';
  const shown = shownImages.length ? shownImages : [answer?.imageA, answer?.imageB].filter(Boolean);
  if (shown.length !== 2) return '';
  if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
    if (answer.choice === 'A' || answer.choice === 'B') return answer.choice;
    if (answer.chosenIndex === 0 || answer.chosenIndex === 1) return answer.chosenIndex === 0 ? 'A' : 'B';
  }
  const selected = answerToSelectedKeys(answer, shown);
  if (selected.length !== 1) return '';
  const keys = shown.map((s) => filenameKey(typeof s === 'string' ? s : s?.url || s?.name));
  return selected[0] === keys[0] ? 'A' : selected[0] === keys[1] ? 'B' : '';
}

export function summarizeChoiceOutcomes(units = []) {
  const counts = { A: 0, B: 0, tie: 0, total: 0 };
  units.forEach(({ answer, shown_images }) => {
    const outcome = choiceOutcome(answer, shown_images);
    if (outcome) { counts[outcome] += 1; counts.total += 1; }
  });
  return counts;
}

import { sliderScale } from './sliderScale';
import { skillFieldNativeQuestion } from './skillNativeAdapter.mjs';
import { checkAnswerAgainstResultSchema } from './skillResultTypes';

const key = (v) => v && typeof v === 'object' ? v.value ?? v.id ?? v.key : v;
export const displayOnly = (q) => ['html', 'expression', 'image', 'mediadisplay'].includes(q.type);

/** A structural example, never a predicted participant answer. Undefined requires manual testing. */
export function questionExample(q, media = []) {
  const choices = (q.choices || []).map(key);
  const urls = media.map((m) => m.url);
  const type = String(q.type || '').replace(/^(image|media)(?=rating|boolean|checkbox|matrix|slidergroup|pointallocation)/, '');
  if (displayOnly(q)) return undefined;
  if (type === 'skillquestion') {
    const context = { shownUrls: urls, ...(urls[0] ? { imageUrl: urls[0] } : {}) };
    switch (q.skillId) {
      case 'preset_image_preference_forced': return { ...context, choice: 'A', chosenIndex: 0 };
      case 'preset_image_preference_slider': return { ...context, preference: 0, interpretation: 'neutral', hardToDecide: true };
      case 'preset_best_worst_choice': return { ...context, bestIndex: 0, worstIndex: Math.max(1, urls.length - 1), complete: true };
      case 'preset_video_moment_tag': return { videoUrl: urls[0], segments: [{ start: 0, end: 1 }], duration: 1 };
      case 'preset_video_continuous_rating': return { videoUrl: urls[0], samples: [{ t: 0, value: q.skillConfig?.scaleMin ?? 1 }], duration: 1 };
      case 'preset_emotion_color_picker': return { ...context, color: { hex: '#336699', hue: 210, intensity: 50 } };
      case 'preset_composite_blocks': return { ...context, ratings: (q.skillConfig?.dimensions || []).map((d) => ({ id: d.id, value: sliderScale(d, q.skillConfig).midpoint })), words: [], text: 'TEST', choice: null };
      default: break;
    }
    const fields = q.skillResultSchema || [];
    if (fields.length !== 1) return undefined;
    const f = fields[0];
    const native = skillFieldNativeQuestion(q, f);
    if (!native || native.type === 'skillquestion') return undefined;
    let value;
    if (['points', 'path', 'polygon', 'bbox', 'box'].includes(f.type)) {
      value = [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.8 }].slice(0, f.type === 'points' ? 1 : ['bbox', 'box', 'path'].includes(f.type) ? 2 : 3);
    } else if (f.type === 'mediaChoice') value = urls[0];
    else if (f.type === 'mediaRankedList') value = urls;
    else value = questionExample(native, media);
    if (value === undefined) return undefined;
    const answer = { ...context, [f.key]: value };
    return checkAnswerAgainstResultSchema(answer, fields, q.skillConfig).fields.every((r) => r.ok) ? answer : undefined;
  }
  if (type === 'number' || (type === 'text' && q.inputType === 'number')) return q.min ?? Math.min(0, q.max ?? 0);
  if (type === 'text' || type === 'comment') return q.maxLength > 0 ? 'TEST'.slice(0, q.maxLength) : 'TEST';
  if (type === 'rating') return q.rateMin ?? 1;
  if (type === 'boolean' || type === 'consent') return true;
  if (['radiogroup', 'dropdown'].includes(type)) return choices[0];
  if (type === 'checkbox') return choices.slice(0, Math.max(1, q.minSelectedChoices || 1));
  if (type === 'ranking') return choices;
  if (['imagepicker', 'mediapicker'].includes(type)) return q.multiSelect ? choices.slice(0, 1) : choices[0];
  if (['imageranking', 'mediaranking'].includes(type)) return choices;
  if (type === 'matrix') return Object.fromEntries((q.rows || []).map((r) => [key(r), key(q.columns?.[0])]));
  if (type === 'slidergroup') return Object.fromEntries((q.dimensions || []).map((d) => [d.id, sliderScale(d, q).midpoint]));
  if (type === 'pointallocation') return Object.fromEntries(choices.map((c, i) => [c, i === 0 ? (q.budget ?? 100) : 0]));
  if (type === 'imageannotation') {
    const tool = q.allowedTools?.[0] || 'point';
    const points = [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.8 }];
    return { shapes: Array.from({ length: Math.max(1, q.minAnnotations || 1) }, (_, i) => ({ id: `test_${i}`, tool, label: key(q.annotationLabels?.[0]) || 'TEST', points: points.slice(0, tool === 'point' ? 1 : tool === 'polygon' ? 3 : 2) })) };
  }
  return undefined;
}

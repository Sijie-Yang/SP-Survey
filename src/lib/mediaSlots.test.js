import {
  resolveMediaSlots,
  hasMediaSlots,
  legacyAssignmentToSlots,
  slotsToShownMedia,
  MEDIA_SLOT_PRESETS,
} from './mediaSlots';
import { enrichSurveyResponses } from './enrichSurveyResponses';
import { buildResponsesWideCsv } from './responsesWideExport';

const pool = [
  { name: 'clip01.mp4', url: 'https://r2.test/v/clip01.mp4', type: 'video', key: 'v/clip01.mp4', media_id: 'v/clip01.mp4' },
  { name: 'clip01.mp3', url: 'https://r2.test/a/clip01.mp3', type: 'audio', key: 'a/clip01.mp3', media_id: 'a/clip01.mp3' },
  { name: 'clip02.mp4', url: 'https://r2.test/v/clip02.mp4', type: 'video', key: 'v/clip02.mp4', media_id: 'v/clip02.mp4' },
  { name: 'clip02.mp3', url: 'https://r2.test/a/clip02.mp3', type: 'audio', key: 'a/clip02.mp3', media_id: 'a/clip02.mp3' },
  { name: 'still.jpg', url: 'https://r2.test/i/still.jpg', type: 'image', key: 'i/still.jpg', media_id: 'i/still.jpg', folder: 'sets/thermal' },
  { name: 'amb.mp4', url: 'https://r2.test/sets/thermal/amb.mp4', type: 'video', key: 'sets/thermal/amb.mp4', media_id: 'sets/thermal/amb.mp4', folder: 'sets/thermal' },
  { name: 'amb.mp3', url: 'https://r2.test/sets/thermal/amb.mp3', type: 'audio', key: 'sets/thermal/amb.mp3', media_id: 'sets/thermal/amb.mp3', folder: 'sets/thermal' },
];

describe('resolveMediaSlots', () => {
  test('hasMediaSlots detects non-empty array', () => {
    expect(hasMediaSlots({ mediaSlots: [{ id: 'a' }] })).toBe(true);
    expect(hasMediaSlots({ mediaSlots: [] })).toBe(false);
    expect(hasMediaSlots({})).toBe(false);
  });

  test('fixed video + random audio', () => {
    const used = new Set();
    const usedSets = new Set();
    const result = resolveMediaSlots(pool, {
      mediaSlots: MEDIA_SLOT_PRESETS.fixedVideoRandomAudio.map((s) => (
        s.id === 'stimulus_video'
          ? { ...s, mediaRef: { key: 'v/clip01.mp4' } }
          : s
      )),
      excludePreviouslyUsedImages: true,
    }, used, usedSets);

    expect(result.slots).toHaveLength(2);
    const video = result.slots.find((s) => s.slotId === 'stimulus_video');
    const audio = result.slots.find((s) => s.slotId === 'stimulus_audio');
    expect(video.name).toBe('clip01.mp4');
    expect(video.type).toBe('video');
    expect(audio.type).toBe('audio');
    expect(result.warnings).toEqual([]);
  });

  test('basename pairing aligns audio to video stem', () => {
    const result = resolveMediaSlots(pool, {
      mediaSlots: MEDIA_SLOT_PRESETS.basenamePair,
      excludePreviouslyUsedImages: false,
    }, new Set(), new Set());

    expect(result.slots).toHaveLength(2);
    const video = result.slots.find((s) => s.slotId === 'stimulus_video');
    const audio = result.slots.find((s) => s.slotId === 'stimulus_audio');
    const stem = (n) => n.replace(/\.[^.]+$/, '');
    expect(stem(audio.name)).toBe(stem(video.name));
  });

  test('missing fixed media warns and leaves slot empty', () => {
    const result = resolveMediaSlots(pool, {
      mediaSlots: [{
        id: 'stimulus_video', role: 'stimulus', mediaType: 'video',
        selection: 'fixed', mediaRef: { key: 'missing.mp4' }, order: 0,
      }],
    }, new Set(), new Set());
    expect(result.slots).toHaveLength(0);
    expect(result.warnings.some((w) => /not found/i.test(w))).toBe(true);
  });

  test('legacyAssignmentToSlots wraps flat images', () => {
    const wrapped = legacyAssignmentToSlots({
      images: [pool[0], pool[1]],
      setId: 'sets/thermal',
    });
    expect(wrapped.slots).toHaveLength(2);
    expect(wrapped.slots[0].slotId).toBe('legacy_0');
    expect(wrapped.setId).toBe('sets/thermal');
  });
});

describe('shown_media enrich + CSV slots', () => {
  test('fixed+random slots land in enrich and wide CSV columns', () => {
    const slots = [
      {
        slotId: 'stimulus_video', role: 'stimulus', type: 'video',
        name: 'clip01.mp4', media_id: 'v/clip01.mp4', url: 'https://r2.test/v/clip01.mp4',
      },
      {
        slotId: 'stimulus_audio', role: 'stimulus', type: 'audio',
        name: 'clip01.mp3', media_id: 'a/clip01.mp3', url: 'https://r2.test/a/clip01.mp3',
      },
    ];
    const enriched = enrichSurveyResponses({
      responses: { q_rate: 4 },
      questionTypeMap: { q_rate: 'mediarating' },
      displayedImages: {
        q_rate: ['https://r2.test/v/clip01.mp4', 'https://r2.test/a/clip01.mp3'],
      },
      displayedMediaSlots: { q_rate: slots },
      preloadedImages: pool,
    });

    expect(enriched.enrichedResponses.q_rate.answer).toBe(4);
    expect(enriched.enrichedResponses.q_rate.shown_media).toEqual(slotsToShownMedia(slots));

    const csv = buildResponsesWideCsv(
      [{
        id: 'r1',
        created_at: '2026-01-01T00:00:00Z',
        responses: enriched.enrichedResponses,
      }],
      [
        {
          name: 'q_rate', type: 'mediarating', title: 'Rate',
          mediaSlots: [
            { id: 'stimulus_video' },
            { id: 'stimulus_audio' },
          ],
        },
      ],
      null,
    );
    expect(csv).toContain('q_rate__slot_stimulus_video_name');
    expect(csv).toContain('clip01.mp4');
    expect(csv).toContain('clip01.mp3');
    expect(csv).toContain('stimulus_video');
    // answer column value
    expect(csv).toMatch(/,4,/);
  });

  test('mediapicker media_N maps to shown file names', () => {
    const enriched = enrichSurveyResponses({
      responses: { q_pick: 'media_1' },
      questionTypeMap: { q_pick: 'mediapicker' },
      displayedImages: {
        q_pick: ['https://r2.test/v/clip01.mp4', 'https://r2.test/v/clip02.mp4'],
      },
      displayedMediaSlots: {
        q_pick: [
          { slotId: 'c0', role: 'choice', type: 'video', name: 'clip01.mp4', media_id: 'v/clip01.mp4', url: 'https://r2.test/v/clip01.mp4' },
          { slotId: 'c1', role: 'choice', type: 'video', name: 'clip02.mp4', media_id: 'v/clip02.mp4', url: 'https://r2.test/v/clip02.mp4' },
        ],
      },
      preloadedImages: pool,
    });
    expect(enriched.enrichedResponses.q_pick.answer).toBe('https://r2.test/v/clip02.mp4');
  });
});

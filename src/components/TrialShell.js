import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Typography, Tooltip, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  applyMediaToElement,
  getRememberedInjectedMedia,
  rememberInjectedMedia,
  resolveQuestionMediaItems,
} from '../lib/surveyMediaInjection';
import { resolveQuestionImageChoices } from '../lib/questionImageChoices';
import { useSurveyTrialNav } from '../contexts/SurveyTrialNavContext';
import {
  SP_TRIALS_ANSWER_KEY,
  TRIAL_DOT_GROUP_SIZE,
  allTrialsAnswered,
  getTrialCount,
  getTrialsAnswer,
  isTrialsAnswer,
  mediaSetToShownIds,
  mediaSetToShownImages,
  normalizeTrialsAnswer,
  persistTrialsAnswer,
  trialHasAnswer,
} from '../lib/trialNavigation';

/** Prefer pre-sampled trialMediaSets; synthesize from image/media stimulus for preview. */
function resolveTrialMediaSets(question, trialCount) {
  const remembered = getRememberedInjectedMedia(question?.name);
  if (remembered?.trialMediaSets?.some((s) => s?.length)) {
    return remembered.trialMediaSets;
  }
  const existing = question?.trialMediaSets || question?.jsonObj?.trialMediaSets;
  if (Array.isArray(existing) && existing.some((s) => s?.length)) {
    return existing;
  }
  let images = resolveQuestionImageChoices(question).map((c) => ({
    url: c.imageLink,
    name: c.imageName || c.value,
  }));
  // media* types store stimulus on mediaUrls / mediaItems, not imageLinks / choices
  if (!images.length) {
    images = resolveQuestionMediaItems(question).map((m) => ({
      url: m.url,
      name: m.name,
      type: m.type,
    }));
  }
  if (!images.length) return [];
  return Array.from({ length: Math.max(1, trialCount) }, () => (
    images.map((img) => ({ ...img }))
  ));
}

function writeQuestionProp(question, key, value) {
  if (value === undefined) return;
  try {
    if (typeof question.setPropertyValue === 'function') {
      question.setPropertyValue(key, value);
    }
  } catch { /* ignore */ }
  // Always mirror onto the instance — SurveyJS ignores setPropertyValue for
  // unregistered props (e.g. imagerating.imageHtml), which left stale stimulus.
  try {
    question[key] = value;
  } catch { /* ignore */ }
}

function applyTrialMedia(question, mediaSet) {
  if (!question || !mediaSet?.length) return;
  const type = question.getType?.() || question.type;
  const element = { type, name: question.name };
  applyMediaToElement(element, mediaSet);
  [
    'choices', 'imageLinks', 'imageNames', 'imageHtml', 'imageUrls',
    'mediaItems', 'mediaUrls', 'mediaNames', 'mediaTypes', 'mediaUrl', 'mediaName',
    'annotationImageUrl', 'imageLink', 'imageName',
    'assignedMediaSetId', 'assignedMediaGroupId', 'assignedMediaCategories',
  ].forEach((key) => {
    writeQuestionProp(question, key, element[key]);
  });
  const prev = getRememberedInjectedMedia(question.name);
  rememberInjectedMedia(question.name, {
    items: mediaSet,
    trialMediaSets: prev?.trialMediaSets || question.trialMediaSets || null,
  });
  // SurveyJS ItemValue arrays sometimes ignore plain-object assignment; force choices
  // for widgets that render from choices[].imageLink / imagepicker.
  if ([
    'imagerating', 'imageboolean', 'imagematrix',
    'imagepicker', 'imageranking', 'mediaranking', 'mediapicker',
  ].includes(type)) {
    const choiceObjs = (element.choices?.length
      ? element.choices
      : mediaSet.map((image, index) => ({
        value: `image_${index}`,
        imageLink: image.url,
        imageName: image.name,
      })));
    // Clear first so ItemValues with the same value keys (image_0) cannot keep old imageLinks.
    writeQuestionProp(question, 'choices', []);
    writeQuestionProp(question, 'choices', choiceObjs);
  }
}

function emptyTrialDisplayValue(question) {
  const type = question?.getType?.() || question?.type;
  if (type === 'imageranking' || type === 'mediaranking') {
    return [];
  }
  if (
    type === 'imagematrix'
    || type === 'mediamatrix'
    || type === 'imageslidergroup'
    || type === 'mediaslidergroup'
    || type === 'imagepointallocation'
    || type === 'mediapointallocation'
  ) {
    return {};
  }
  return null;
}

/**
 * Wraps a media question React component with multi-trial navigation.
 * When trialCount <= 1, renders Inner unchanged (still reports progress unit).
 *
 * Important: SurveyJS widgets (esp. imagepicker) read selection via methods bound
 * to the real question model. Keep question.value as the *current trial* answer
 * and store the full { trials: [...] } payload on question.spTrialsAnswer.
 */
export default function TrialShell({ question, Inner, ...rest }) {
  const trialCount = getTrialCount(question);
  const nav = useSurveyTrialNav();

  if (trialCount <= 1 || !Inner) {
    return <Inner question={question} {...rest} />;
  }

  return (
    <TrialShellInner
      question={question}
      Inner={Inner}
      trialCount={trialCount}
      nav={nav}
      {...rest}
    />
  );
}

function seedAnswersFor(question, trialCount) {
  const fromSide = getTrialsAnswer(question);
  if (isTrialsAnswer(fromSide)) return normalizeTrialsAnswer(fromSide, trialCount);
  return normalizeTrialsAnswer(question.value, trialCount);
}

function resolveInitialTrialIndex(question, trialCount, nav, answers) {
  const last = Math.max(0, trialCount - 1);
  if (nav?.isQuestionTrialsFinished?.(question.name)) return last;
  const stored = nav?.getQuestionTrialIndex?.(question.name);
  if (typeof stored === 'number' && !Number.isNaN(stored)) {
    return Math.min(Math.max(0, stored), last);
  }
  let maxAnswered = 0;
  (answers?.trials || []).forEach((t, i) => {
    if (trialHasAnswer(t, question)) maxAnswered = Math.max(maxAnswered, i);
  });
  return maxAnswered;
}

function TrialShellInner({ question, Inner, trialCount, nav, ...rest }) {
  const theme = useTheme();
  // Align with SurveyJS --sd-mobile-width (600px)
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Stable across renders — resolveTrialMediaSets fallback builds a new array each call.
  const trialMediaSets = useMemo(
    () => resolveTrialMediaSets(question, trialCount),
    // Re-resolve only when the question identity / trial count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question?.name, trialCount],
  );
  const initialAnswers = seedAnswersFor(question, trialCount);
  const initialIndex = resolveInitialTrialIndex(question, trialCount, nav, initialAnswers);
  const initiallyDone = !!nav?.isQuestionTrialsFinished?.(question.name);

  const [index, setIndex] = useState(initialIndex);
  const [furthest, setFurthest] = useState(() => (
    initiallyDone ? Math.max(0, trialCount - 1) : initialIndex
  ));
  const [answers, setAnswers] = useState(initialAnswers);
  const [groupIdx, setGroupIdx] = useState(() => Math.floor(initialIndex / TRIAL_DOT_GROUP_SIZE));
  const [mediaEpoch, setMediaEpoch] = useState(0);
  /** True after "Done with trials" (or restored finished question). */
  const [shellDone, setShellDone] = useState(initiallyDone);
  const applyingRef = useRef(false);
  const answersRef = useRef(answers);
  const indexRef = useRef(index);
  answersRef.current = answers;
  indexRef.current = index;

  const persistAnswers = useCallback((next, trialIndex = indexRef.current) => {
    const normalized = normalizeTrialsAnswer(next, trialCount);
    setAnswers(normalized);
    answersRef.current = normalized;
    persistTrialsAnswer(question, normalized, trialIndex);
  }, [question, trialCount]);

  const writeFlatValue = useCallback((trialIndex, answersObj) => {
    const flat = answersObj?.trials?.[trialIndex]?.value;
    const nextVal = (flat === undefined) ? emptyTrialDisplayValue(question) : flat;
    try {
      question.value = nextVal;
    } catch (e) {
      console.warn('TrialShell: failed to set flat question.value', e);
    }
  }, [question]);

  // If survey/draft restored a trials object onto .value, move it to the side-channel.
  useEffect(() => {
    applyingRef.current = true;
    const startIndex = indexRef.current;
    if (isTrialsAnswer(question.value)) {
      const normalized = normalizeTrialsAnswer(question.value, trialCount);
      persistAnswers(normalized, startIndex);
      writeFlatValue(startIndex, normalized);
    } else if (!question[SP_TRIALS_ANSWER_KEY]) {
      persistAnswers(answers, startIndex);
      writeFlatValue(startIndex, answers);
    }
    const t = setTimeout(() => { applyingRef.current = false; }, 50);
    return () => clearTimeout(t);
    // once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  // Apply media + restore flat value whenever the active trial changes (before paint).
  useLayoutEffect(() => {
    applyingRef.current = true;
    const set = trialMediaSets[index];
    if (set?.length) {
      applyTrialMedia(question, set);
    }
    let next = normalizeTrialsAnswer(answersRef.current, trialCount);
    const trial = next.trials?.[index];
    const shown = mediaSetToShownImages(set || []);
    if (trial && (!trial.shown_images?.length) && shown.length) {
      next = {
        ...next,
        trials: next.trials.map((t, i) => (
          i === index
            ? {
              ...t,
              shown_images: shown,
              shown_media_ids: mediaSetToShownIds(set || []),
            }
            : t
        )),
      };
      persistAnswers(next);
    }
    // Update active trial index *before* writeFlatValue — otherwise SurveyJS
    // onValueChanged still sees the previous trial and can fight the top blue ring.
    nav?.setQuestionTrialIndex?.(question.name, index);
    writeFlatValue(index, next);
    setMediaEpoch((n) => n + 1);
    const t = setTimeout(() => { applyingRef.current = false; }, 50);
    return () => clearTimeout(t);
  }, [index, trialMediaSets, question.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture SurveyJS / widget value changes into the active trial slot
  useEffect(() => {
    const capture = () => {
      if (applyingRef.current) return;
      const raw = question.value;
      if (isTrialsAnswer(raw)) return;
      const set = trialMediaSets[indexRef.current] || [];
      const next = normalizeTrialsAnswer(answersRef.current, trialCount);
      next.trials[indexRef.current] = {
        value: raw,
        shown_images: mediaSetToShownImages(set),
        shown_media_ids: mediaSetToShownIds(set),
      };
      persistAnswers(next, indexRef.current);
    };

    const survey = question.survey;
    const onSurveyValue = (_sender, options) => {
      if (options?.name && options.name !== question.name) return;
      capture();
    };
    survey?.onValueChanged?.add(onSurveyValue);

    // Backup: some widgets update value without a survey-level event in edge cases
    let unregisterProp = null;
    try {
      if (typeof question.registerPropertyChangedHandlers === 'function') {
        question.registerPropertyChangedHandlers(['value'], capture);
        unregisterProp = () => {
          try {
            question.unregisterPropertyChangedHandlers?.(['value'], capture);
          } catch { /* ignore */ }
        };
      }
    } catch { /* ignore */ }

    return () => {
      survey?.onValueChanged?.remove(onSurveyValue);
      unregisterProp?.();
    };
  }, [question, trialCount, trialMediaSets, persistAnswers]);

  const markUnitReached = useCallback((trialIndex) => {
    if (!nav?.units?.length) return;
    const unitIndex = nav.units.findIndex(
      (u) => u.questionName === question.name && u.trialIndex === trialIndex,
    );
    if (unitIndex >= 0) nav.markReached(unitIndex);
  }, [nav, question.name]);

  const finishTrials = useCallback(() => {
    const last = Math.max(0, trialCount - 1);
    persistAnswers(normalizeTrialsAnswer(answersRef.current, trialCount), indexRef.current);
    setFurthest(last);
    setShellDone(true);
    let lastUnitIndex = -1;
    for (let t = 0; t <= last; t += 1) {
      const unitIndex = nav?.units?.findIndex?.(
        (u) => u.questionName === question.name && u.trialIndex === t,
      ) ?? -1;
      if (unitIndex >= 0) {
        nav.markFurthest?.(unitIndex);
        lastUnitIndex = unitIndex;
      }
    }
    nav?.setQuestionTrialIndex?.(question.name, last);
    nav?.markQuestionTrialsFinished?.(question.name);
    // Top blue ring moves to the next question / trial unit
    if (lastUnitIndex >= 0) nav?.advanceViewingPast?.(lastUnitIndex);
  }, [trialCount, persistAnswers, nav, question.name]);

  // Block page Next until every trial has an answer; leaving forward = finished.
  // Skip in admin preview (survey.mode === 'display') — preview is browse-only.
  useEffect(() => {
    const survey = question.survey;
    if (!survey?.onCurrentPageChanging) return undefined;
    const handler = (_sender, options) => {
      if (options?.isPrevPage) return;
      if (survey.currentPage !== question.page) return;
      if (survey.mode === 'display' || survey.isDisplayMode) return;
      if (!allTrialsAnswered(answersRef.current, trialCount, question)) {
        options.allow = false;
        try {
          question.addError?.('Please complete all trials before continuing.');
        } catch { /* ignore */ }
        return;
      }
      if (!shellDone) finishTrials();
    };
    survey.onCurrentPageChanging.add(handler);
    return () => survey.onCurrentPageChanging.remove(handler);
  }, [question, trialCount, shellDone, finishTrials]);

  // Respond to ProgressChrome jump requests + page-restore bumps
  useEffect(() => {
    if (!nav) return;
    const req = nav.consumeJumpRequest?.(question.name);
    if (req && typeof req.trialIndex === 'number') {
      const next = Math.min(Math.max(0, req.trialIndex), trialCount - 1);
      setIndex(next);
      setFurthest((f) => Math.max(f, next));
      setGroupIdx(Math.floor(next / TRIAL_DOT_GROUP_SIZE));
      return;
    }
    // Returning to a finished page: show last trial, keep Done state
    if (nav.isQuestionTrialsFinished?.(question.name)) {
      const last = Math.max(0, trialCount - 1);
      setShellDone(true);
      setFurthest(last);
      setIndex(last);
      setGroupIdx(Math.floor(last / TRIAL_DOT_GROUP_SIZE));
    }
  }, [nav?.jumpNonce, question.name, trialCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Make SurveyJS required-validation see the full trial set (live only)
  useEffect(() => {
    const survey = question.survey;
    if (survey?.mode === 'display' || survey?.isDisplayMode) return undefined;
    const original = question.isEmpty?.bind(question);
    question.isEmpty = () => !allTrialsAnswered(answersRef.current, trialCount, question);
    return () => {
      if (original) question.isEmpty = original;
    };
  }, [question, trialCount]);

  const goTo = (nextIndex) => {
    if (nextIndex < 0 || nextIndex >= trialCount) return;
    if (nextIndex > furthest + 1) return;
    if (nextIndex > furthest && !trialHasAnswer(answers.trials?.[index], question)) return;
    // Snapshot current answers into the store before leaving this trial
    persistAnswers(answersRef.current, indexRef.current);
    // Sync nav trial index immediately (before React effect / writeFlatValue)
    nav?.setQuestionTrialIndex?.(question.name, nextIndex);
    markUnitReached(nextIndex);
    setIndex(nextIndex);
    setFurthest((f) => Math.max(f, nextIndex));
    setGroupIdx(Math.floor(nextIndex / TRIAL_DOT_GROUP_SIZE));
  };

  // Last trial: no "Done" button — turn green as soon as every trial has an answer.
  useEffect(() => {
    if (shellDone) return;
    if (index !== trialCount - 1) return;
    if (!allTrialsAnswered(answers, trialCount, question)) return;
    finishTrials();
  }, [answers, index, trialCount, shellDone, finishTrials, question]);

  const handleNext = () => {
    if (index >= trialCount - 1) return;
    if (!trialHasAnswer(answers.trials?.[index], question)) return;
    goTo(index + 1);
  };

  const handleBack = () => {
    if (index > 0) goTo(index - 1);
  };

  const complete = allTrialsAnswered(answers, trialCount, question);
  const onLastTrial = index >= trialCount - 1;
  const groups = Math.ceil(trialCount / TRIAL_DOT_GROUP_SIZE);
  const groupStart = groupIdx * TRIAL_DOT_GROUP_SIZE;
  const groupEnd = Math.min(trialCount, groupStart + TRIAL_DOT_GROUP_SIZE);
  // Subscribe so local blue ring clears when top cursor moves to another question
  const viewingUnit = nav?.units?.[nav.currentUnitIndex];
  void (nav?.answerEpoch);

  return (
    <Box className="sp-trial-shell" sx={{ width: '100%' }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
        Trial {index + 1} of {trialCount}
        {complete && (
          <Typography component="span" variant="caption" color="success.main" sx={{ ml: 1 }}>
            All trials answered
          </Typography>
        )}
      </Typography>

      {groups > 1 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {Array.from({ length: groups }, (_, gi) => (
            <Box
              key={gi}
              component="button"
              type="button"
              onClick={() => setGroupIdx(gi)}
              sx={{
                border: '1px solid',
                borderColor: gi === groupIdx ? 'primary.main' : 'divider',
                borderRadius: 1,
                px: { xs: 1, sm: 1 },
                py: { xs: 0.5, sm: 0.25 },
                minHeight: { xs: 28, sm: 'auto' },
                fontSize: { xs: '0.75rem', sm: '0.7rem' },
                cursor: 'pointer',
                bgcolor: gi === groupIdx ? 'primary.50' : 'transparent',
                fontFamily: 'inherit',
              }}
            >
              {gi * TRIAL_DOT_GROUP_SIZE + 1}–{Math.min(trialCount, (gi + 1) * TRIAL_DOT_GROUP_SIZE)}
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 0.75, sm: 0.5 }, mb: 1.5 }}>
        {Array.from({ length: groupEnd - groupStart }, (_, j) => {
          const i = groupStart + j;
          const reached = i <= furthest;
          const answered = trialHasAnswer(answers.trials?.[i], question);
          // Synced with top ProgressChrome — only the global current unit gets a local ring.
          const isViewing = viewingUnit?.questionName === question.name
            && viewingUnit?.trialIndex === i;
          return (
            <Tooltip key={i} title={reached ? `Trial ${i + 1}` : 'Not reached'}>
              <Box
                component="button"
                type="button"
                disabled={!reached}
                onClick={() => reached && goTo(i)}
                sx={{
                  width: { xs: 22, sm: 16 },
                  height: { xs: 22, sm: 16 },
                  borderRadius: '50%',
                  border: '2px solid',
                  borderColor: answered ? 'success.main' : 'grey.400',
                  bgcolor: answered ? 'success.light' : 'transparent',
                  boxShadow: isViewing
                    ? (t) => `0 0 0 1px ${t.palette.background.paper}, 0 0 0 ${isMobile ? 2 : 4}px ${t.palette.primary.main}`
                    : 'none',
                  p: 0,
                  cursor: reached ? 'pointer' : 'not-allowed',
                  opacity: reached ? 1 : 0.35,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>

      <Box
        key={`trial-media-${index}-${mediaEpoch}-${mediaSetToShownImages(trialMediaSets[index] || []).join('|')}`}
        sx={{ mb: 1.5 }}
      >
        <Inner
          question={question}
          trialStimulusMedia={trialMediaSets[index] || []}
          {...rest}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1 }}>
        <Button
          size={isMobile ? 'medium' : 'small'}
          variant="outlined"
          disabled={index === 0}
          onClick={handleBack}
        >
          Back
        </Button>
        {!onLastTrial && (
          <Button
            size={isMobile ? 'medium' : 'small'}
            variant="contained"
            disabled={!trialHasAnswer(answers.trials?.[index], question)}
            onClick={handleNext}
          >
            Next trial
          </Button>
        )}
      </Box>
    </Box>
  );
}

/** Factory helper: wrap a SurveyJS React question component with TrialShell. */
export function withTrialShell(Inner) {
  function Wrapped(props) {
    return <TrialShell {...props} Inner={Inner} />;
  }
  Wrapped.displayName = `WithTrialShell(${Inner.displayName || Inner.name || 'Question'})`;
  return Wrapped;
}

import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import ProgressChrome from './ProgressChrome';
import { useSurveyTrialNav } from '../contexts/SurveyTrialNavContext';
import {
  applyProgressQuestionNumbering,
  buildProgressUnits,
  flattenSurveyQuestions,
  getAnswerablePageQuestions,
  getTrialCount,
  questionUnitHasAnswer,
} from '../lib/trialNavigation';
import { buildProgressChromeCssVars } from '../lib/surveyStorage';

/**
 * Registers trial-aware progress units and navigates SurveyJS on ProgressChrome jumps.
 */
export default function SurveyProgressBridge({
  surveyModel,
  progressEnabled = true,
  theme = null,
}) {
  const nav = useSurveyTrialNav();
  const navRef = useRef(nav);
  navRef.current = nav;
  const registerUnits = nav?.registerUnits;
  const lastPageNameRef = useRef(null);
  const unitsLen = nav?.units?.length ?? 0;

  // Register units once per model — do NOT depend on whole `nav` (it changes every answer
  // and was re-syncing the blue ring back to question 1).
  useEffect(() => {
    if (!surveyModel || !registerUnits) return undefined;
    applyProgressQuestionNumbering(surveyModel);
    const questions = flattenSurveyQuestions(surveyModel);
    registerUnits(buildProgressUnits(questions));
    if (progressEnabled) {
      try {
        surveyModel.showProgressBar = 'off';
      } catch { /* ignore */ }
    }
    return undefined;
  }, [surveyModel, progressEnabled, registerUnits]);

  // Only change SurveyJS page on explicit ProgressChrome clicks (jumpNonce).
  useEffect(() => {
    const n = navRef.current;
    if (!surveyModel || !n?.units?.length) return;
    const unit = n.units[n.currentUnitIndex];
    if (!unit) return;
    try {
      const q = surveyModel.getQuestionByName?.(unit.questionName);
      if (q?.page && surveyModel.currentPage !== q.page) {
        surveyModel.currentPage = q.page;
      }
    } catch (e) {
      console.warn('SurveyProgressBridge: failed to jump page', e);
    }
  }, [nav?.jumpNonce, surveyModel]);

  useEffect(() => {
    if (!surveyModel || !unitsLen) return undefined;

    const unitIndexFor = (questionName, trialIndex = 0) => {
      const units = navRef.current?.units || [];
      return units.findIndex(
        (u) => u.questionName === questionName && u.trialIndex === trialIndex,
      );
    };

    const pageUnitRange = (pageQuestions) => {
      let min = Infinity;
      let max = -1;
      pageQuestions.forEach((q) => {
        if (!q?.name) return;
        const n = Math.max(1, getTrialCount(q));
        for (let t = 0; t < n; t += 1) {
          const ui = unitIndexFor(q.name, t);
          if (ui >= 0) {
            min = Math.min(min, ui);
            max = Math.max(max, ui);
          }
        }
      });
      return min === Infinity ? null : { min, max };
    };

    const syncFromCurrentPage = () => {
      const n = navRef.current;
      if (!n) return;
      const page = surveyModel.currentPage;
      const pageQuestions = getAnswerablePageQuestions(page);
      if (!pageQuestions.length) return;

      const pageName = page?.name || '';
      const pageChanged = lastPageNameRef.current !== pageName;
      lastPageNameRef.current = pageName;

      const range = pageUnitRange(pageQuestions);
      if (!range) return;
      const cur = n.currentUnitIndex ?? 0;
      const curInPage = cur >= range.min && cur <= range.max;

      // ProgressChrome jump already set currentUnitIndex to a unit on this page.
      // Do not override to "first unfinished" or "last finished" on the page.
      if (pageChanged && curInPage) {
        const unit = n.units?.[cur];
        if (unit?.questionName) {
          n.setQuestionTrialIndex?.(unit.questionName, unit.trialIndex ?? 0);
        }
        n.markFurthest?.(cur);
        n.notifyPageRestore?.();
        return;
      }

      // Already answering something on this page — never yank the ring back to Q1
      if (!pageChanged && curInPage) {
        n.markFurthest?.(range.min);
        return;
      }

      const allFinished = pageQuestions.every(
        (q) => q?.name && n.isQuestionTrialsFinished?.(q.name),
      );

      if (allFinished) {
        let focusUnitIndex = -1;
        pageQuestions.forEach((q) => {
          if (!q?.name) return;
          const tc = Math.max(1, getTrialCount(q));
          const trialIndex = tc - 1;
          n.setQuestionTrialIndex?.(q.name, trialIndex);
          const unitIndex = unitIndexFor(q.name, trialIndex);
          if (unitIndex >= 0) {
            n.markFurthest?.(unitIndex);
            focusUnitIndex = unitIndex;
          }
        });
        if (focusUnitIndex >= 0) n.setCurrentUnitIndex?.(focusUnitIndex);
        n.notifyPageRestore?.();
        return;
      }

      // Entered this page via Next/Prev (not a chrome jump): focus first unfinished
      let focus = range.min;
      for (const q of pageQuestions) {
        if (!q?.name) continue;
        const tc = Math.max(1, getTrialCount(q));
        if (n.isQuestionTrialsFinished?.(q.name)) {
          const ui = unitIndexFor(q.name, tc - 1);
          if (ui >= 0) focus = ui;
          continue;
        }
        for (let t = 0; t < tc; t += 1) {
          const ui = unitIndexFor(q.name, t);
          if (ui < 0) continue;
          focus = ui;
          if (!questionUnitHasAnswer(q, t)) {
            n.setQuestionTrialIndex?.(q.name, t);
            n.markFurthest?.(ui);
            n.setCurrentUnitIndex?.(ui);
            return;
          }
        }
      }
      n.markFurthest?.(focus);
      n.setCurrentUnitIndex?.(focus);
    };

    const onValueChanged = (_sender, options) => {
      const n = navRef.current;
      if (!n) return;
      const name = options?.name;
      if (!name) return;
      const q = surveyModel.getQuestionByName?.(name);
      if (!q) return;
      const trialIndex = n.getQuestionTrialIndex?.(name) || 0;
      if (!questionUnitHasAnswer(q, trialIndex)) return;
      const unitIndex = unitIndexFor(name, trialIndex);
      if (unitIndex < 0) return;

      const tc = getTrialCount(q);
      if (tc <= 1) {
        n.markFurthest?.(unitIndex);
        n.advanceViewingPast?.(unitIndex);
        return;
      }
      if (n.isQuestionTrialsFinished?.(name)) return;
      // Multi-trial: only unlock/green this unit. Viewing ring is owned by TrialShell
      // (Next/Back/dots) — never markReached here or writeFlatValue races pull it back.
      n.markFurthest?.(unitIndex);
      n.setQuestionTrialIndex?.(name, trialIndex);
    };

    surveyModel.onCurrentPageChanged?.add(syncFromCurrentPage);
    surveyModel.onValueChanged?.add(onValueChanged);
    syncFromCurrentPage();
    return () => {
      surveyModel.onCurrentPageChanged?.remove(syncFromCurrentPage);
      surveyModel.onValueChanged?.remove(onValueChanged);
    };
  }, [surveyModel, unitsLen]);

  if (!progressEnabled) return null;
  return (
    <Box
      className="sp-progress-chrome-host"
      style={buildProgressChromeCssVars(theme)}
      sx={{ mb: 1 }}
    >
      <ProgressChrome enabled surveyModel={surveyModel} />
    </Box>
  );
}

export function isProgressEnabled(surveyJsonOrModel) {
  const v = surveyJsonOrModel?.showProgressBar;
  if (v === false || v === 'off' || v === 'Off') return false;
  return true;
}

export function normalizeShowProgressBar(value) {
  if (value === false || value === 'off' || value === 'Off') return 'off';
  if (value === true || value === 'aboveheader' || value === 'belowheader') return 'top';
  if (value === 'bottom' || value === 'top') return value;
  return 'top';
}

/** Sum of trialCounts for debugging / labels */
export function totalTrialUnitsInModel(surveyModel) {
  return flattenSurveyQuestions(surveyModel).reduce((s, q) => s + getTrialCount(q), 0);
}

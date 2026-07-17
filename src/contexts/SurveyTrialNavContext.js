import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const SurveyTrialNavContext = createContext(null);

/**
 * Shared furthest-reached cursor + jump requests for ProgressChrome ↔ TrialShell.
 */
export function SurveyTrialNavProvider({ children }) {
  const [furthestUnitIndex, setFurthestUnitIndex] = useState(0);
  const [currentUnitIndex, setCurrentUnitIndex] = useState(0);
  const [units, setUnits] = useState([]);
  const jumpRequestRef = useRef(null); // { questionName, trialIndex, nonce }
  const [jumpNonce, setJumpNonce] = useState(0);
  const trialIndexByQuestionRef = useRef({}); // name -> trialIndex
  const [finishedQuestions, setFinishedQuestions] = useState(() => new Set());
  /** Forces consumers to re-read answered state after value changes. */
  const [answerEpoch, setAnswerEpoch] = useState(0);

  const registerUnits = useCallback((nextUnits) => {
    const list = Array.isArray(nextUnits) ? nextUnits : [];
    setUnits((prev) => {
      if (
        prev.length === list.length
        && prev.every((u, i) => u.id === list[i]?.id && u.questionName === list[i]?.questionName)
      ) {
        return prev;
      }
      return list;
    });
  }, []);

  const markReached = useCallback((unitIndex) => {
    setFurthestUnitIndex((prev) => Math.max(prev, unitIndex));
    setCurrentUnitIndex(unitIndex);
    setAnswerEpoch((n) => n + 1);
  }, []);

  /** Advance furthest without moving the "viewing" cursor (page restore). */
  const markFurthest = useCallback((unitIndex) => {
    setFurthestUnitIndex((prev) => Math.max(prev, unitIndex));
  }, []);

  /**
   * After a question / trial-group is complete: move the blue viewing ring
   * to the next progress unit (does not change SurveyJS page by itself).
   */
  const advanceViewingPast = useCallback((unitIndex) => {
    if (unitIndex == null || unitIndex < 0) return;
    const next = unitIndex + 1;
    setFurthestUnitIndex((prev) => Math.max(prev, unitIndex, next < units.length ? next : unitIndex));
    if (next < units.length) {
      setCurrentUnitIndex(next);
      const nextUnit = units[next];
      if (nextUnit?.questionName) {
        trialIndexByQuestionRef.current[nextUnit.questionName] = nextUnit.trialIndex ?? 0;
      }
    } else {
      setCurrentUnitIndex(unitIndex);
    }
    setAnswerEpoch((n) => n + 1);
  }, [units]);

  /** After all trials answered — used for page-return restore to last trial. */
  const markQuestionTrialsFinished = useCallback((questionName) => {
    if (!questionName) return;
    setFinishedQuestions((prev) => {
      if (prev.has(questionName)) return prev;
      const next = new Set(prev);
      next.add(questionName);
      return next;
    });
  }, []);

  const isQuestionTrialsFinished = useCallback((questionName) => (
    finishedQuestions.has(questionName)
  ), [finishedQuestions]);

  const setQuestionTrialIndex = useCallback((questionName, trialIndex) => {
    trialIndexByQuestionRef.current[questionName] = trialIndex;
    setAnswerEpoch((n) => n + 1);
  }, []);

  /** Bump so TrialShells on a page re-sync (e.g. after returning to a finished page). */
  const notifyPageRestore = useCallback(() => {
    setJumpNonce((n) => n + 1);
  }, []);

  const getQuestionTrialIndex = useCallback((questionName) => (
    trialIndexByQuestionRef.current[questionName] ?? 0
  ), [jumpNonce, answerEpoch]);

  const requestJump = useCallback((unitIndex) => {
    const unit = units[unitIndex];
    if (!unit || unitIndex > furthestUnitIndex) return;
    jumpRequestRef.current = {
      questionName: unit.questionName,
      trialIndex: unit.trialIndex,
      unitIndex,
      nonce: Date.now(),
    };
    setCurrentUnitIndex(unitIndex);
    setJumpNonce((n) => n + 1);
  }, [units, furthestUnitIndex]);

  const consumeJumpRequest = useCallback((questionName) => {
    const req = jumpRequestRef.current;
    if (!req || req.questionName !== questionName) return null;
    jumpRequestRef.current = null;
    return req;
  }, [jumpNonce]);

  const setViewingUnitIndex = useCallback((unitIndex) => {
    if (typeof unitIndex !== 'number' || unitIndex < 0) return;
    setCurrentUnitIndex(unitIndex);
    setAnswerEpoch((n) => n + 1);
  }, []);

  const value = useMemo(() => ({
    units,
    furthestUnitIndex,
    currentUnitIndex,
    jumpNonce,
    answerEpoch,
    finishedQuestions,
    registerUnits,
    markReached,
    markFurthest,
    advanceViewingPast,
    markQuestionTrialsFinished,
    isQuestionTrialsFinished,
    requestJump,
    consumeJumpRequest,
    setQuestionTrialIndex,
    getQuestionTrialIndex,
    setCurrentUnitIndex: setViewingUnitIndex,
    notifyPageRestore,
  }), [
    units, furthestUnitIndex, currentUnitIndex, jumpNonce, answerEpoch, finishedQuestions,
    registerUnits, markReached, markFurthest, advanceViewingPast, markQuestionTrialsFinished,
    isQuestionTrialsFinished, requestJump, consumeJumpRequest,
    setQuestionTrialIndex, getQuestionTrialIndex, setViewingUnitIndex, notifyPageRestore,
  ]);

  return (
    <SurveyTrialNavContext.Provider value={value}>
      {children}
    </SurveyTrialNavContext.Provider>
  );
}

export function useSurveyTrialNav() {
  return useContext(SurveyTrialNavContext);
}

import { useWorkflowText } from '../../contexts/workflowI18n';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/defaultV2.min.css';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Radio,
  RadioGroup,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { PlayArrow, Stop, SkipNext, Replay, Settings } from '@mui/icons-material';
import registerImageRankingWidget, {
  registerImageRatingWidget,
  registerImageBooleanWidget,
  registerAllExtendedWidgets,
} from '../SurveyCustomComponents';
import { buildSingleQuestionSurvey } from '../../lib/singleQuestionSurvey';
import { applyAdminThemeToSurveyModel } from '../../lib/surveyStorage';
import { saveSurveyResponse, supabase } from '../../lib/supabase';
import { createPracticeSubmission } from '../../lib/practiceSubmission';
import { surveyRevision } from '../../lib/surveyRevision';
// Self-hosted edition has no login; practice rows stay anonymous.
import { buildResponseMediaUrlMap } from '../../lib/skillMediaUtils';
import { ImageResolverContext } from './imageResolverContext';
import {
  buildQuestionCardProps,
  QuestionCard,
} from './ResultsAnalysis';
import QuestionEditor from './QuestionEditor';
import { SurveyTrialNavProvider } from '../../contexts/SurveyTrialNavContext';
import {
  clearTrialsAnswerStore,
  collectSurveyDataWithTrials,
} from '../../lib/trialNavigation';
import { enrichSurveyResponses } from '../../lib/enrichSurveyResponses';
import { resolveSkillQuestions, syncInjectedMediaOntoSurveyModel } from '../../lib/surveyMediaInjection';
import { resolveMediaPoolForPreview } from '../../lib/previewMediaLibrary';
import { applySurveyLocale } from '../../lib/surveyLocale';
import { AdminPageHeader } from './AdminPageLayout';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

let widgetsRegistered = false;
function ensureWidgets() {
  if (widgetsRegistered) return;
  registerImageRankingWidget();
  registerImageRatingWidget();
  registerImageBooleanWidget();
  registerAllExtendedWidgets();
  widgetsRegistered = true;
}

function flattenQuestions(surveyConfig) {
  if (!surveyConfig?.pages) return [];
  return surveyConfig.pages.flatMap((page) =>
    (page.elements || []).map((el) => ({ ...el, _pageName: page.name, _pageTitle: page.title })),
  );
}

function isPracticeable(q) {
  if (!q?.type || !q?.name) return false;
  if (q.type === 'image' || q.type === 'expression' || q.type === 'html' || q.type === 'mediadisplay') {
    return false;
  }
  return true;
}

/** Drop Practice-only bookkeeping fields before writing back to surveyConfig. */
function stripPracticeMeta(question) {
  if (!question || typeof question !== 'object') return question;
  const {
    _pageName,
    _pageTitle,
    _pageIndex,
    _allResponses,
    ...rest
  } = question;
  return rest;
}

function replaceQuestionInConfig(surveyConfig, originalName, updatedQuestion) {
  const clean = stripPracticeMeta(updatedQuestion);
  const pages = (surveyConfig?.pages || []).map((page) => ({
    ...page,
    elements: (page.elements || []).map((el) => (
      el?.name === originalName ? { ...clean } : el
    )),
  }));
  return { ...surveyConfig, pages };
}

function newSessionId() {
  return `prac_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const PRACTICE_SESSION_KEY = 'researcher_practice_sessions';
const PRACTICE_UI_KEY = 'researcher_practice_ui';

function readPracticeStore() {
  try {
    return JSON.parse(sessionStorage.getItem(PRACTICE_SESSION_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function loadPersistedSession(projectId) {
  if (!projectId) return null;
  const row = readPracticeStore()[projectId];
  if (!row?.active || !row?.sessionId || !Array.isArray(row.questionNames) || !row.questionNames.length) {
    return null;
  }
  return row;
}

function persistSession(projectId, payload) {
  if (!projectId) return;
  try {
    const all = readPracticeStore();
    if (!payload) delete all[projectId];
    else all[projectId] = payload;
    sessionStorage.setItem(PRACTICE_SESSION_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('Failed to persist practice session:', err);
  }
}

function readPracticeUiStore() {
  try {
    return JSON.parse(sessionStorage.getItem(PRACTICE_UI_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function loadPracticeUi(projectId) {
  if (!projectId) return null;
  return readPracticeUiStore()[projectId] || null;
}

function persistPracticeUi(projectId, patch) {
  if (!projectId) return;
  try {
    const all = readPracticeUiStore();
    all[projectId] = { ...(all[projectId] || {}), ...patch, updatedAt: Date.now() };
    sessionStorage.setItem(PRACTICE_UI_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('Failed to persist practice UI:', err);
  }
}

/**
 * Free practice: pick any question and answer anytime.
 * Optional session: multi-question queue with fixed/unlimited repeats; stays alive until Stop.
 */
export default function ResearcherPractice({
  currentProject,
  surveyConfig,
  onSurveyConfigChange,
  onSessionActiveChange,
}) {
  const tx = useWorkflowText();
  const user = null;
  const { t, language } = useRegion();
  const projectId = currentProject?.id || null;
  const questions = useMemo(
    () => flattenQuestions(surveyConfig).filter(isPracticeable),
    [surveyConfig],
  );

  const questionsByPage = useMemo(() => {
    const pages = surveyConfig?.pages || [];
    const groups = [];
    pages.forEach((page, pageIndex) => {
      const pageQuestions = (page.elements || [])
        .filter(isPracticeable)
        .map((el) => ({
          ...el,
          _pageName: page.name,
          _pageTitle: page.title || `Page ${pageIndex + 1}`,
          _pageIndex: pageIndex,
        }));
      if (!pageQuestions.length) return;
      groups.push({
        pageName: page.name || `page_${pageIndex}`,
        pageTitle: page.title || `Page ${pageIndex + 1}`,
        pageIndex,
        questions: pageQuestions,
      });
    });
    // Fallback: any practiceable questions not found via pages (shouldn't happen)
    if (!groups.length && questions.length) {
      groups.push({
        pageName: 'all',
        pageTitle: 'Questions',
        pageIndex: 0,
        questions,
      });
    }
    return groups;
  }, [surveyConfig, questions]);

  // Free-practice selection (also used as current question while answering)
  const [selectedName, setSelectedName] = useState(null);

  // Optional multi-question session
  const [session, setSession] = useState(null);
  // session: {
  //   sessionId, participantId, questionNames[],
  //   paceMode: 'block' | 'round',
  //   unlimited, repeats,  // repeats = per-question (block) or rounds (round)
  //   queueIndex, attemptInQuestion, roundIndex, totalSaved,
  // }

  const [model, setModel] = useState(null);
  const [roundMeta, setRoundMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retrySubmission, setRetrySubmission] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null); // durable messages only (session start/stop)
  const [toast, setToast] = useState(null); // brief overlay — no layout shift
  const [reloadToken, setReloadToken] = useState(0);
  /** Bumps every loadRound so TrialShell nav state cannot leak across attempts. */
  const [practiceNavKey, setPracticeNavKey] = useState(0);
  const [practiceCounts, setPracticeCounts] = useState({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [analysisResponses, setAnalysisResponses] = useState([]);

  // Session setup dialog
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupSelected, setSetupSelected] = useState([]);
  const [setupPaceMode, setSetupPaceMode] = useState('block'); // block | round
  const [setupUnlimited, setSetupUnlimited] = useState(false);
  const [setupRepeats, setSetupRepeats] = useState(10);

  // Inline question settings (same QuestionEditor as Survey Builder)
  const [editingQuestion, setEditingQuestion] = useState(null); // { originalName, question }

  const usedImageKeysRef = useRef(new Set());
  const usedGroupKeysRef = useRef(new Set());
  const roundMetaRef = useRef(null);
  const sessionRef = useRef(null);
  const hydratedRef = useRef(null);
  const questionListRef = useRef(null);
  const selectedItemRef = useRef(null);
  const restoreScrollRef = useRef(null);

  const selectedQuestion = useMemo(
    () => questions.find((q) => q.name === selectedName) || null,
    [questions, selectedName],
  );

  const questionNumberByName = useMemo(() => {
    const map = new Map();
    let n = 0;
    questions.forEach((q) => {
      n += 1;
      map.set(q.name, n);
    });
    return map;
  }, [questions]);

  const sessionActive = !!session?.sessionId;

  useEffect(() => {
    onSessionActiveChange?.(sessionActive);
  }, [sessionActive, onSessionActiveChange]);

  const refreshAnalysisData = useCallback(async () => {
    if (!projectId || !supabase) {
      setPracticeCounts({});
      setAnalysisResponses([]);
      return;
    }
    setCountsLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('survey_responses')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (qErr) throw qErr;
      const rows = data || [];
      setAnalysisResponses(rows);
      const counts = {};
      rows.forEach((row) => {
        const meta = row.survey_metadata || {};
        if (!meta.practice_mode || !meta.practice_question) return;
        const name = meta.practice_question;
        counts[name] = (counts[name] || 0) + 1;
      });
      setPracticeCounts(counts);
    } catch (err) {
      console.warn('Failed to load practice analysis data:', err);
    } finally {
      setCountsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refreshAnalysisData();
  }, [refreshAnalysisData]);

  const imageNameToUrl = useMemo(() => {
    const map = new Map();
    const imgs = currentProject?.preloadedImages || [];
    for (const img of imgs) {
      if (img.name && img.url) map.set(img.name, img.url);
    }
    for (const [key, url] of buildResponseMediaUrlMap(analysisResponses)) {
      if (!map.has(key)) map.set(key, url);
    }
    return map;
  }, [currentProject?.preloadedImages, analysisResponses]);

  const analysisPropsForQuestion = useCallback((question) => {
    if (!question?.name) return null;
    // This panel reports researcher practice attempts only. Formal participant
    // submissions remain available in Results Analysis and must not distort the
    // immediate practice feedback.
    const practiceResponses = analysisResponses.filter((row) => (
      row.survey_metadata?.practice_mode
      && row.survey_metadata?.practice_question === question.name
    ));
    return buildQuestionCardProps(question, practiceResponses, {
      questionNumber: questionNumberByName.get(question.name) ?? null,
      surveyConfig,
      exportResponses: practiceResponses,
    });
  }, [analysisResponses, questionNumberByName, surveyConfig]);

  const writeSessionPersist = useCallback((nextSession) => {
    if (!projectId) return;
    if (!nextSession?.sessionId) {
      persistSession(projectId, null);
      return;
    }
    persistSession(projectId, {
      active: true,
      sessionId: nextSession.sessionId,
      participantId: nextSession.participantId,
      questionNames: nextSession.questionNames,
      paceMode: nextSession.paceMode || 'block',
      unlimited: !!nextSession.unlimited,
      repeats: nextSession.repeats,
      repeatsPerQuestion: nextSession.repeats, // legacy alias
      queueIndex: nextSession.queueIndex,
      attemptInQuestion: nextSession.attemptInQuestion,
      roundIndex: nextSession.roundIndex || 1,
      totalSaved: nextSession.totalSaved,
      usedImageKeys: [...usedImageKeysRef.current],
      usedGroupKeys: [...usedGroupKeysRef.current],
    });
  }, [projectId]);

  const applySession = useCallback((next, { persist = true, reload = true } = {}) => {
    sessionRef.current = next;
    setSession(next);
    if (next?.questionNames?.length) {
      const qName = next.questionNames[next.queueIndex] || next.questionNames[0];
      setSelectedName(qName);
    }
    if (persist) writeSessionPersist(next);
    if (reload) setReloadToken((t) => t + 1);
  }, [writeSessionPersist]);

  // Restore session when project changes
  useEffect(() => {
    if (!projectId) {
      setSelectedName(null);
      setSession(null);
      sessionRef.current = null;
      setModel(null);
      setRoundMeta(null);
      usedImageKeysRef.current = new Set();
      usedGroupKeysRef.current = new Set();
      hydratedRef.current = null;
      return;
    }
    if (hydratedRef.current === projectId) return;
    hydratedRef.current = projectId;

    const saved = loadPersistedSession(projectId);
    if (saved) {
      usedImageKeysRef.current = new Set(saved.usedImageKeys || []);
      usedGroupKeysRef.current = new Set(saved.usedGroupKeys || []);
      const restored = {
        sessionId: saved.sessionId,
        participantId: saved.participantId,
        questionNames: saved.questionNames,
        paceMode: saved.paceMode === 'round' ? 'round' : 'block',
        unlimited: !!saved.unlimited,
        repeats: saved.repeats || saved.repeatsPerQuestion || 1,
        queueIndex: saved.queueIndex || 0,
        attemptInQuestion: saved.attemptInQuestion || 1,
        roundIndex: saved.roundIndex || 1,
        totalSaved: saved.totalSaved || 0,
      };
      applySession(restored, { persist: false, reload: true });
      setToast(tx("Practice session restored"));
    } else {
      setSession(null);
      sessionRef.current = null;
      setModel(null);
      setRoundMeta(null);
      usedImageKeysRef.current = new Set();
      usedGroupKeysRef.current = new Set();
      const ui = loadPracticeUi(projectId);
      if (ui?.selectedName) {
        setSelectedName(ui.selectedName);
        restoreScrollRef.current = typeof ui.listScrollTop === 'number' ? ui.listScrollTop : null;
        setReloadToken((t) => t + 1);
      } else {
        setSelectedName(null);
      }
    }
  }, [projectId, applySession]);

  // Drop restored selection if that question no longer exists in the survey.
  useEffect(() => {
    if (!selectedName || !questions.length) return;
    if (!questions.some((q) => q.name === selectedName)) setSelectedName(null);
  }, [questions, selectedName]);

  // Remember free-pick (and session) selection across tab switches / remounts.
  useEffect(() => {
    if (!projectId || !selectedName) return;
    persistPracticeUi(projectId, { selectedName });
  }, [projectId, selectedName]);

  // Restore question-list scroll, then ensure the selected row is visible.
  useEffect(() => {
    const listEl = questionListRef.current;
    if (!listEl) return undefined;
    const savedTop = restoreScrollRef.current;
    if (typeof savedTop === 'number') {
      listEl.scrollTop = savedTop;
      restoreScrollRef.current = null;
    }
    const t = window.setTimeout(() => {
      selectedItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [selectedName, projectId, questionsByPage.length]);

  // Drop session questions that no longer exist; keep survey order
  useEffect(() => {
    if (!sessionActive || !session) return;
    const valid = questions
      .map((q) => q.name)
      .filter((n) => session.questionNames.includes(n));
    if (valid.length === session.questionNames.length
      && valid.every((n, i) => n === session.questionNames[i])) return;
    if (!valid.length) {
      applySession(null);
      setToast(tx("Session questions were removed — session ended"));
      return;
    }
    const currentName = session.questionNames[session.queueIndex];
    const queueIndex = Math.max(0, valid.indexOf(currentName));
    applySession({
      ...session,
      questionNames: valid,
      queueIndex: queueIndex >= 0 ? queueIndex : 0,
    });
  }, [questions, session, sessionActive, applySession]);

  const selectFreeQuestion = (questionName) => {
    if (sessionActive) return; // locked to session queue
    setSelectedName(questionName);
    setError(null);
    setStatusMsg(null);
    usedImageKeysRef.current = new Set();
    usedGroupKeysRef.current = new Set();
    setReloadToken((t) => t + 1);
  };

  const openQuestionSettings = useCallback((question) => {
    if (!question?.name) return;
    if (!surveyConfig || typeof onSurveyConfigChange !== 'function') {
      setError(t.practiceSettingsUnavailable);
      return;
    }
    setEditingQuestion({
      originalName: question.name,
      question: stripPracticeMeta(question),
    });
  }, [surveyConfig, onSurveyConfigChange, t.practiceSettingsUnavailable]);

  const saveQuestionSettings = useCallback((updatedQuestion) => {
    if (!editingQuestion || !surveyConfig || typeof onSurveyConfigChange !== 'function') {
      setEditingQuestion(null);
      return;
    }
    const originalName = editingQuestion.originalName;
    const nextName = updatedQuestion?.name || originalName;
    const nextConfig = replaceQuestionInConfig(surveyConfig, originalName, updatedQuestion);
    onSurveyConfigChange(nextConfig);

    if (selectedName === originalName && nextName !== originalName) {
      setSelectedName(nextName);
      persistPracticeUi(projectId, { selectedName: nextName });
    }

    if (sessionRef.current?.questionNames?.includes(originalName)) {
      const cur = sessionRef.current;
      const questionNames = cur.questionNames.map((n) => (n === originalName ? nextName : n));
      applySession({ ...cur, questionNames }, { persist: true, reload: false });
    }

    setEditingQuestion(null);
    setToast(t.practiceSettingsSaved);
    // Reload practice widget with the updated question definition.
    setReloadToken((token) => token + 1);
  }, [
    editingQuestion,
    surveyConfig,
    onSurveyConfigChange,
    selectedName,
    projectId,
    applySession,
    t.practiceSettingsSaved,
  ]);

  /** Always order selected names by survey appearance, not click order. */
  const sortBySurveyOrder = useCallback((names) => {
    const set = new Set(names);
    return questions.filter((q) => set.has(q.name)).map((q) => q.name);
  }, [questions]);

  const openSetup = () => {
    setSetupSelected(selectedName ? [selectedName] : []);
    setSetupPaceMode('block');
    setSetupUnlimited(false);
    setSetupRepeats(10);
    setSetupOpen(true);
  };

  const toggleSetupQuestion = (name) => {
    setSetupSelected((prev) => sortBySurveyOrder(
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    ));
  };

  const toggleSetupPage = (pageQuestions) => {
    const names = pageQuestions.map((q) => q.name);
    setSetupSelected((prev) => {
      const allSelected = names.every((n) => prev.includes(n));
      if (allSelected) return prev.filter((n) => !names.includes(n));
      return sortBySurveyOrder([...prev, ...names]);
    });
  };

  const startSessionFromSetup = () => {
    // Survey order — never selection/click order
    const names = sortBySurveyOrder(
      setupSelected.filter((n) => questions.some((q) => q.name === n)),
    );
    if (!names.length) {
      setError(tx("Select at least one question for the session."));
      return;
    }
    const repeats = setupUnlimited ? 1 : Math.max(1, parseInt(setupRepeats, 10) || 1);
    usedImageKeysRef.current = new Set();
    usedGroupKeysRef.current = new Set();
    const paceMode = setupPaceMode === 'round' ? 'round' : 'block';
    const next = {
      sessionId: newSessionId(),
      participantId: `researcher_${user?.id || 'anon'}_${Date.now().toString(36)}`,
      questionNames: names,
      paceMode,
      unlimited: !!setupUnlimited,
      repeats,
      queueIndex: 0,
      attemptInQuestion: 1,
      roundIndex: 1,
      totalSaved: 0,
    };
    setSetupOpen(false);
    setError(null);
    const paceLabel = paceMode === 'round'
      ? 'one of each question per round'
      : 'finish one question before the next';
    setToast(
      language === 'zh' ? `已开始连续练习，共 ${names.length} 道题${setupUnlimited ? '，不限次数' : '，每题 ' + repeats + ' 次'}` : setupUnlimited
        ? `Session started · ${names.length} Q · ${paceLabel} · unlimited`
        : `Session started · ${names.length} Q · ${paceLabel} · ${repeats}×`,
    );
    applySession(next);
  };

  const stopSession = () => {
    applySession(null, { persist: true, reload: false });
    setModel(null);
    setRoundMeta(null);
    setToast(tx("Session stopped. Free practice is available again."));
  };

  const loadRound = useCallback(async () => {
    if (!selectedQuestion) {
      setModel(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      ensureWidgets();
      clearTrialsAnswerStore();
      const mediaPool = await resolveMediaPoolForPreview(currentProject?.preloadedImages || []);
      const questionConfig = {
        pages: [{ elements: [JSON.parse(JSON.stringify(selectedQuestion))] }],
      };
      await resolveSkillQuestions(questionConfig);
      const resolvedQuestion = questionConfig.pages[0].elements[0];
      const built = buildSingleQuestionSurvey({
        question: resolvedQuestion,
        projectImages: mediaPool,
        usedImageKeys: usedImageKeysRef.current,
        usedGroupKeys: usedGroupKeysRef.current,
        randomMedia: true,
        showNavigationButtons: false,
        trackUsed: selectedQuestion.excludePreviouslyUsedImages !== false,
        folderTags: currentProject?.imageDatasetConfig?.mediaFolderTags || {},
      });
      if (built.surveyJson?.pages) {
        for (const page of built.surveyJson.pages) {
          for (const el of page.elements || []) {
            if (el.type === 'imageannotation') el.enableSamAssist = false;
          }
        }
      }
      const m = new Model(built.surveyJson);
      applySurveyLocale(m, surveyConfig);
      m.showPreviewBeforeComplete = false;
      m.showCompletedPage = false;
      applyAdminThemeToSurveyModel(m, surveyConfig);
      syncInjectedMediaOntoSurveyModel(m, built.surveyJson);
      const meta = {
        shownImages: built.shownImages,
        shownImagesByTrial: built.shownImagesByTrial || null,
        shownMediaGroup: built.shownMediaGroup,
        shownMediaCategories: built.shownMediaCategories,
        questionName: selectedQuestion.name,
        questionType: selectedQuestion.type,
      };
      setRoundMeta(meta);
      roundMetaRef.current = meta;
      setRetrySubmission(false);
      setPracticeNavKey((k) => k + 1);
      setModel(m);
    } catch (err) {
      console.error('Practice round failed:', err);
      setError(err.message || tx("Failed to load question"));
      setModel(null);
    } finally {
      setLoading(false);
      if (sessionRef.current?.sessionId) {
        writeSessionPersist(sessionRef.current);
      }
    }
  }, [selectedQuestion, currentProject?.preloadedImages, currentProject?.id, currentProject?.imageDatasetConfig, surveyConfig, reloadToken, writeSessionPersist]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadRound();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadRound]);

  const enrichAndSave = async (surveyModel) => {
    const meta = roundMetaRef.current;
    if (!meta?.questionName) throw new Error('No active question');

    // A failed response may already have reached the database. Resend the exact request.
    if (meta.pendingSubmission) {
      const result = await saveSurveyResponse(meta.pendingSubmission);
      if (!result.success) throw new Error(result.error?.message || result.error || 'Save failed');
      return result;
    }

    const questionName = meta.questionName;
    // Multi-trial answers live in trialsAnswerStore / spTrialsAnswer — not model.data alone.
    const responses = collectSurveyDataWithTrials(surveyModel);
    const shownImages = meta.shownImages || [];
    const displayedImages = { [questionName]: shownImages };
    if (Array.isArray(meta.shownImagesByTrial) && meta.shownImagesByTrial.length) {
      displayedImages[`${questionName}__trials`] = meta.shownImagesByTrial;
    }

    const {
      enrichedResponses,
      displayed_images,
      displayed_media_groups,
      displayed_media_categories,
    } = enrichSurveyResponses({
      responses,
      questionTypeMap: { [questionName]: meta.questionType },
      displayedImages,
      displayedMediaGroups: { [questionName]: meta.shownMediaGroup || null },
      displayedMediaCategories: { [questionName]: meta.shownMediaCategories || null },
      preloadedImages: currentProject?.preloadedImages || [],
    });

    const sess = sessionRef.current;
    const participantId = sess?.participantId
      || `researcher_${user?.id || 'anon'}_free_${Date.now().toString(36)}`;
    const revision = await surveyRevision(surveyConfig);

    const completeData = {
      project_id: currentProject?.id || null,
      participant_id: participantId,
      responses: enrichedResponses,
      displayed_images,
      displayed_media_groups,
      displayed_media_categories,
      raw_responses: responses,
      survey_metadata: {
        completion_time: new Date().toISOString(),
        researcher_mode: true,
        practice_mode: true,
        practice_question: questionName,
        practice_style: sess?.sessionId ? 'session' : 'free',
        session_id: sess?.sessionId || null,
        attempt_index: sess
          ? sess.totalSaved + 1
          : (practiceCounts[questionName] || 0) + 1,
        queue_index: sess?.queueIndex ?? null,
        attempt_in_question: sess?.attemptInQuestion ?? null,
        user_id: user?.id || null,
        user_email: user?.email || null,
        survey_revision: revision.id,
        survey_response_contract: revision.contract,
        survey_draft_updated_at: currentProject?.draftUpdatedAt || null,
      },
    };

    meta.pendingSubmission = createPracticeSubmission(completeData);
    surveyModel.mode = 'display';
    const result = await saveSurveyResponse(meta.pendingSubmission);
    if (!result.success) {
      throw new Error(result.error?.message || result.error || 'Save failed');
    }
    return result;
  };

  /** Advance session queue after a saved (or skipped) answer. Returns false if session ended. */
  const advanceSessionAfterAnswer = (saved) => {
    const cur = sessionRef.current;
    if (!cur?.sessionId) return true;

    let {
      queueIndex,
      attemptInQuestion,
      roundIndex = 1,
      questionNames,
      paceMode = 'block',
      unlimited,
      repeats,
      totalSaved,
    } = cur;
    // Legacy sessions
    if (repeats == null) repeats = cur.repeatsPerQuestion || 1;

    if (saved) totalSaved += 1;

    if (paceMode === 'round') {
      // One of each question per round, then next round
      if (queueIndex + 1 < questionNames.length) {
        queueIndex += 1;
      } else if (unlimited || roundIndex < repeats) {
        queueIndex = 0;
        roundIndex += 1;
      } else {
        applySession(null, { persist: true, reload: false });
        setModel(null);
        setRoundMeta(null);
        setToast(language === 'zh' ? `练习完成，已保存 ${totalSaved} 次回答` : `Session complete — saved ${totalSaved} response(s)`);
        refreshAnalysisData();
        return false;
      }
      attemptInQuestion = 1;
    } else {
      // Block: finish all repeats of current question, then next
      if (unlimited) {
        // Stay on current question forever until user ends (or skip still advances? keep on same Q)
        attemptInQuestion += 1;
      } else if (attemptInQuestion < repeats) {
        attemptInQuestion += 1;
      } else if (queueIndex + 1 < questionNames.length) {
        queueIndex += 1;
        attemptInQuestion = 1;
      } else {
        applySession(null, { persist: true, reload: false });
        setModel(null);
        setRoundMeta(null);
        setToast(language === 'zh' ? `练习完成，已保存 ${totalSaved} 次回答` : `Session complete — saved ${totalSaved} response(s)`);
        refreshAnalysisData();
        return false;
      }
    }

    applySession({
      ...cur,
      queueIndex,
      attemptInQuestion,
      roundIndex,
      totalSaved,
      repeats,
      paceMode,
    });
    return true;
  };

  const submitAnswer = async () => {
    if (!model || submittingRef.current || loading) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      if (!model.validate(true)) {
        setError(tx("Please complete the required fields before submitting."));
        setSubmitting(false);
        return;
      }
      await enrichAndSave(model);
      setPracticeCounts((prev) => ({
        ...prev,
        [selectedName]: (prev[selectedName] || 0) + 1,
      }));
      setToast(tx("Saved"));
      // Refresh analysis so the collapsed Result card updates (free + session).
      refreshAnalysisData();

      if (sessionActive) {
        advanceSessionAfterAnswer(true);
        // Keep previous model visible until loadRound swaps it — avoids collapse jitter
      } else {
        setReloadToken((t) => t + 1);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || tx("Failed to save response"));
      setRetrySubmission(!!roundMetaRef.current?.pendingSubmission);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const skipWithoutSave = () => {
    setToast(tx("Skipped"));
    if (sessionActive) {
      advanceSessionAfterAnswer(false);
    } else {
      setReloadToken((t) => t + 1);
    }
  };

  if (!currentProject) {
    return <Alert severity="info">{' '}{tx("Select a project to practice questions.")}{' '}</Alert>;
  }

  if (!questions.length) {
    return (
      <Alert severity="warning">{' '}{tx("This project has no answerable questions yet. Add questions in Survey Builder first.")}{' '}</Alert>
    );
  }

  const sessionProgressLabel = (() => {
    if (!session) return null;
    if (language === 'zh') return `连续练习 · 第 ${session.queueIndex + 1}/${session.questionNames.length} 题 · ${session.paceMode === 'round' ? '第 ' + (session.roundIndex || 1) + ' 轮' : '本题第 ' + session.attemptInQuestion + ' 次'} · 已保存 ${session.totalSaved} 次${session.unlimited ? ' · 不限次数' : ' · 每题 ' + session.repeats + ' 次'}`;
    const qPos = `${session.queueIndex + 1}/${session.questionNames.length}`;
    const pace = session.paceMode === 'round' ? 'round' : 'block';
    if (session.unlimited) {
      if (pace === 'round') {
        return `Session · round ${session.roundIndex || 1} · Q ${qPos} · saved ${session.totalSaved} · unlimited`;
      }
      return `Session · Q ${qPos} · attempt ${session.attemptInQuestion} · saved ${session.totalSaved} · unlimited`;
    }
    if (pace === 'round') {
      return `Session · round ${session.roundIndex || 1}/${session.repeats} · Q ${qPos} · saved ${session.totalSaved}`;
    }
    return `Session · Q ${qPos} · ${session.attemptInQuestion}/${session.repeats} · saved ${session.totalSaved}`;
  })();

  return (
    <ImageResolverContext.Provider value={imageNameToUrl}>
    <Box>
      <AdminPageHeader
        icon={<PlayArrow />}
        title={t.practiceTitle}
        description={t.practiceDescription}
      />
      <Box sx={{ display: 'flex', gap: 2, minHeight: 480, flexDirection: { xs: 'column', md: 'row' } }}>
      <Paper
        ref={questionListRef}
        variant="outlined"
        onScroll={(e) => {
          if (!projectId) return;
          persistPracticeUi(projectId, { listScrollTop: e.currentTarget.scrollTop });
        }}
        sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0, maxHeight: 640, overflow: 'auto' }}
      >
        <Box sx={{ p: 2, pb: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>{t.practiceQuestions}</Typography>
            {!sessionActive && (
              <Button size="small" variant="outlined" startIcon={<PlayArrow />} onClick={openSetup}>
                {t.practiceStartSession}
              </Button>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block">
            {sessionActive
              ? t.practiceSessionLocked
              : t.practiceFreePick}
          </Typography>
        </Box>
        <Divider />
        {questionsByPage.map((group) => (
          <Box key={group.pageName}>
            <Box
              sx={{
                px: 2,
                py: 0.75,
                bgcolor: 'grey.100',
                borderBottom: '1px solid',
                borderColor: 'divider',
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                {group.pageTitle}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ ml: 1 }}>
                {group.questions.length} Q
              </Typography>
            </Box>
            <List dense disablePadding>
              {group.questions.map((q) => {
                const count = practiceCounts[q.name] || 0;
                const inSession = session?.questionNames?.includes(q.name);
                const isSelected = selectedName === q.name;
                const pickLocked = sessionActive
                  && session?.questionNames?.[session.queueIndex] !== q.name;
                return (
                  <ListItemButton
                    key={q.name}
                    ref={isSelected ? selectedItemRef : undefined}
                    selected={isSelected}
                    onClick={() => {
                      if (pickLocked) return;
                      selectFreeQuestion(q.name);
                    }}
                    sx={{
                      pr: 0.5,
                      opacity: pickLocked ? 0.55 : 1,
                      cursor: pickLocked ? 'default' : 'pointer',
                    }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: 14 }}>
                            {q.title || q.name}
                          </Typography>
                          <Chip
                            size="small"
                            label={countsLoading && count === 0 ? '…' : `${count}`}
                            color={count > 0 ? 'primary' : 'default'}
                            variant={count > 0 ? 'filled' : 'outlined'}
                            sx={{ height: 20, fontSize: '0.7rem' }}
                            title={tx("Researcher practice responses for this question")}
                          />
                        </Stack>
                      }
                      secondary={`${q.type}${inSession ? (language === 'zh' ? ' · 练习中' : ' · in session') : ''}`}
                      secondaryTypographyProps={{ noWrap: true, fontSize: 11 }}
                    />
                    <Tooltip title={t.practiceEditSettings}>
                      <IconButton
                        size="small"
                        edge="end"
                        aria-label={t.practiceEditSettings}
                        onClick={(e) => {
                          e.stopPropagation();
                          openQuestionSettings(q);
                        }}
                        sx={{ ml: 0.25 }}
                      >
                        <Settings fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        ))}
      </Paper>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {sessionActive && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={(
              <Button color="inherit" size="small" startIcon={<Stop />} onClick={stopSession}>
                {t.practiceEndSession}
              </Button>
            )}
          >
            {sessionProgressLabel}
          </Alert>
        )}

        {!selectedQuestion && (
          <Alert severity="info">{t.practiceChooseQuestion}</Alert>
        )}

        {selectedQuestion && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ flex: 1, minWidth: 160 }}>
                {selectedQuestion.title || selectedQuestion.name}
              </Typography>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={tf(t.practiceTotal, { n: practiceCounts[selectedQuestion.name] || 0 })}
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={<Settings />}
                onClick={() => openQuestionSettings(selectedQuestion)}
              >
                {t.practiceEditSettings}
              </Button>
              {!sessionActive && (
                <Button
                  size="small"
                  startIcon={<Replay />}
                  onClick={() => {
                    usedImageKeysRef.current = new Set();
                    usedGroupKeysRef.current = new Set();
                    setReloadToken((token) => token + 1);
                  }}
                >
                  {t.practiceNewRound}
                </Button>
              )}
            </Stack>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {retrySubmission && <Alert severity="info" sx={{ mb: 2 }}>
              {language === 'zh'
                ? '本次答案已在当前页面保留。请重试提交以确认保存，不会重复新增记录。'
                : 'This attempt is kept unchanged on this page. Retry submission to confirm it without creating a duplicate.'}
            </Alert>}
            {statusMsg && (
              <Alert severity="info" sx={{ mb: 2 }} onClose={() => setStatusMsg(null)}>
                {statusMsg}
              </Alert>
            )}

            <Box sx={{ position: 'relative', minHeight: 120 }}>
              {loading && (
                <Box
                  sx={{
                    position: model ? 'absolute' : 'relative',
                    inset: model ? 0 : undefined,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    py: model ? 0 : 6,
                    bgcolor: model ? 'rgba(255,255,255,0.55)' : 'transparent',
                    zIndex: 2,
                    borderRadius: 1,
                  }}
                >
                  <CircularProgress size={model ? 28 : 40} />
                </Box>
              )}

              {model && (
                <Box
                  inert={submitting || retrySubmission ? '' : undefined}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'white',
                    p: 1,
                    mb: 2,
                    opacity: loading ? 0.55 : 1,
                    '& .sd-body': { padding: '12px !important' },
                  }}
                >
                  {/* Remount nav each round — otherwise finished/trial index from the
                      previous attempt sticks and opens the last trial for the same Q name. */}
                  <SurveyTrialNavProvider key={`practice-nav-${practiceNavKey}`}>
                    <Survey model={model} />
                  </SurveyTrialNavProvider>
                </Box>
              )}
            </Box>

            {model && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Button variant="contained" disabled={submitting || loading} onClick={submitAnswer}>
                  {submitting ? tx("Saving…") : (retrySubmission ? (language === 'zh' ? '重试提交' : 'Retry submission') : (sessionActive ? tx("Submit & Next") : tx("Submit")))}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<SkipNext />}
                  disabled={submitting || loading}
                  onClick={skipWithoutSave}
                >{' '}{tx("Skip (no save)")}{' '}</Button>
              </Stack>
            )}

            {roundMeta?.shownImages?.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{' '}{tx("Shown media:")}{' '}{roundMeta.shownImages.map((u) => String(u).split('/').pop()).join(', ')}
              </Typography>
            )}

            {!sessionActive && (() => {
              const analysisProps = analysisPropsForQuestion(selectedQuestion);
              if (!analysisProps) return null;
              return (
                <Box sx={{ mt: 2.5 }}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>{' '}{tx("Result analysis")}{' '}</Typography>
                  <QuestionCard {...analysisProps} />
                </Box>
              );
            })()}
          </Paper>
        )}
      </Box>

      <Snackbar
        open={!!toast}
        autoHideDuration={1600}
        onClose={() => setToast(null)}
        message={toast || ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

      {editingQuestion && (
        <QuestionEditor
          question={editingQuestion.question}
          onSave={saveQuestionSettings}
          onCancel={() => setEditingQuestion(null)}
          images={surveyConfig?.images || []}
          currentProject={currentProject}
          surveyConfig={surveyConfig}
        />
      )}

      <Dialog open={setupOpen} onClose={() => setSetupOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{' '}{tx("Start practice session")}{' '}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{' '}{tx("Selected questions always run in survey order (not click order). The Practice tab stays mounted while the session is running.")}{' '}</Typography>
          <List dense sx={{ maxHeight: 260, overflow: 'auto', mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            {questionsByPage.map((group) => {
              const pageNames = group.questions.map((q) => q.name);
              const allSelected = pageNames.every((n) => setupSelected.includes(n));
              const someSelected = !allSelected && pageNames.some((n) => setupSelected.includes(n));
              return (
                <Box key={group.pageName}>
                  <ListItemButton onClick={() => toggleSetupPage(group.questions)} dense sx={{ bgcolor: 'grey.50' }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Checkbox
                        edge="start"
                        checked={allSelected}
                        indeterminate={someSelected}
                        tabIndex={-1}
                        disableRipple
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={group.pageTitle}
                      secondary={`${group.questions.length} question(s)`}
                      primaryTypographyProps={{ fontWeight: 700, fontSize: 13 }}
                    />
                  </ListItemButton>
                  {group.questions.map((q) => (
                    <ListItemButton
                      key={q.name}
                      onClick={() => toggleSetupQuestion(q.name)}
                      dense
                      sx={{ pl: 4 }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox
                          edge="start"
                          checked={setupSelected.includes(q.name)}
                          tabIndex={-1}
                          disableRipple
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={q.title || q.name}
                        secondary={`${q.type} · practiced ${practiceCounts[q.name] || 0}×`}
                      />
                    </ListItemButton>
                  ))}
                </Box>
              );
            })}
          </List>

          <FormControl component="fieldset" sx={{ mb: 2, width: '100%' }}>
            <FormLabel component="legend">{' '}{tx("Answering pace")}{' '}</FormLabel>
            <RadioGroup
              value={setupPaceMode}
              onChange={(e) => setSetupPaceMode(e.target.value)}
            >
              <FormControlLabel
                value="round"
                control={<Radio size="small" />}
                label={tx("One of each selected question per round")}
              />
              <FormControlLabel
                value="block"
                control={<Radio size="small" />}
                label={tx("Finish all repeats of one question, then the next")}
              />
            </RadioGroup>
          </FormControl>

          <FormControlLabel
            control={(
              <Checkbox
                checked={setupUnlimited}
                onChange={(e) => setSetupUnlimited(e.target.checked)}
              />
            )}
            label={
              setupPaceMode === 'round'
                ? tx("Unlimited rounds (keep going until you end the session)")
                : tx("Unlimited repeats on each question (stay on current Q until you end)")
            }
          />
          {!setupUnlimited && (
            <TextField
              fullWidth
              type="number"
              label={setupPaceMode === 'round' ? tx("Number of rounds") : tx("Repeats per question")}
              value={setupRepeats}
              onChange={(e) => setSetupRepeats(e.target.value)}
              inputProps={{ min: 1, max: 9999 }}
              helperText={
                setupPaceMode === 'round'
                  ? tx("Each round answers every selected question once, in survey order.")
                  : tx("Each selected question is answered this many times before moving on.")
              }
              sx={{ mt: 1 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSetupOpen(false)}>{' '}{tx("Cancel")}{' '}</Button>
          <Button
            variant="contained"
            startIcon={<PlayArrow />}
            disabled={!setupSelected.length}
            onClick={startSessionFromSetup}
          >{' '}{tx("Start session")}{' '}</Button>
        </DialogActions>
      </Dialog>
      </Box>
    </Box>
    </ImageResolverContext.Provider>
  );
}

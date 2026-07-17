import React, { useMemo, useRef } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { useSurveyTrialNav } from '../contexts/SurveyTrialNavContext';
import {
  getStoredTrialsAnswer,
  getTrialsAnswer,
  isTrialsAnswer,
  questionUnitHasAnswer,
  trialHasAnswer,
} from '../lib/trialNavigation';

const QUESTION_GROUP_SIZE = 24;

/**
 * Hierarchical progress:
 *   Page X / Y  ·  Question A / B  ·  Trial i / n (only when multi-trial)
 * Question-level segments (not every trial) — trial dots stay in TrialShell.
 */
export default function ProgressChrome({ enabled = true, surveyModel = null }) {
  const nav = useSurveyTrialNav();
  const units = nav?.units || [];
  const furthest = nav?.furthestUnitIndex ?? 0;
  const current = nav?.currentUnitIndex ?? 0;
  void (nav?.answerEpoch); // re-render when answers change (green fill)

  const questionGroups = useMemo(() => groupUnitsByQuestion(units), [units]);

  const currentUnit = units[current] || null;
  const currentQ = currentUnit
    ? questionGroups.find((g) => g.questionName === currentUnit.questionName)
    : null;

  const pageInfo = useMemo(() => {
    const pages = surveyModel?.pages || [];
    const total = pages.length || 1;
    let index = 1;
    try {
      const cur = surveyModel?.currentPage;
      if (cur && pages.length) {
        const i = typeof pages.indexOf === 'function' ? pages.indexOf(cur) : -1;
        if (i >= 0) index = i + 1;
        else if (typeof surveyModel.currentPageNo === 'number') {
          index = surveyModel.currentPageNo + 1;
        }
      }
    } catch { /* ignore */ }
    return { index, total };
  }, [surveyModel, surveyModel?.currentPage, surveyModel?.currentPageNo, current]);

  const [groupIdx, setGroupIdx] = React.useState(0);
  const qChunks = useMemo(() => chunkArray(questionGroups, QUESTION_GROUP_SIZE), [questionGroups]);

  React.useEffect(() => {
    if (!currentQ || qChunks.length <= 1) return;
    const qi = questionGroups.findIndex((g) => g.questionName === currentQ.questionName);
    const g = Math.floor(Math.max(0, qi) / QUESTION_GROUP_SIZE);
    if (g !== groupIdx) setGroupIdx(g);
  }, [currentQ?.questionName, qChunks.length, questionGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  // High-water answered counts — never flash to 0 on Next-trial flat-value clears.
  const answeredFloorRef = useRef(new Map());
  React.useEffect(() => {
    answeredFloorRef.current = new Map();
  }, [surveyModel]);

  if (!enabled || !nav || !units.length) return null;

  const activeChunk = qChunks[Math.min(groupIdx, qChunks.length - 1)] || qChunks[0] || [];
  const questionProgress = computeQuestionProgress(
    questionGroups,
    surveyModel,
    furthest,
    answeredFloorRef.current,
  );

  const jumpToQuestion = (group) => {
    if (!group || group.unitStart > furthest) return;
    // Land on current trial if this is the active question; else first reached unit.
    if (currentUnit?.questionName === group.questionName) {
      nav.requestJump(current);
      return;
    }
    const target = Math.min(Math.max(group.unitStart, 0), furthest);
    // Prefer first unanswered trial within this question (among reached units)
    for (let ui = group.unitStart; ui <= Math.min(group.unitEnd, furthest); ui += 1) {
      const u = units[ui];
      const q = surveyModel?.getQuestionByName?.(u.questionName);
      if (q && !questionUnitHasAnswer(q, u.trialIndex)) {
        nav.requestJump(ui);
        return;
      }
    }
    nav.requestJump(target);
  };

  return (
    <Box
      className="sp-progress-chrome"
      sx={{
        px: { xs: 1.5, sm: 2 },
        pb: { xs: 1, sm: 1.25 },
        // Notch / status bar clearance on phones; desktop keeps normal top padding.
        pt: {
          xs: 'calc(8px + env(safe-area-inset-top, 0px))',
          sm: 1.25,
        },
        borderBottom: '1px solid',
        borderColor: 'var(--sp-progress-border, #e0e0e0)',
        bgcolor: 'var(--sp-progress-bg, #ffffff)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          mb: { xs: 0.5, sm: 0.75 },
          fontWeight: 600,
          lineHeight: 1.4,
          color: 'var(--sp-progress-label, #757575)',
        }}
      >
        Page {pageInfo.index} / {pageInfo.total}
        <Box component="span" sx={{ mx: 0.75, fontWeight: 400, opacity: 0.55 }}>·</Box>
        Question {(currentQ?.questionIndex ?? 0) + 1} / {questionGroups.length}
        {currentUnit && currentUnit.trialCount > 1 && (
          <>
            <Box component="span" sx={{ mx: 0.75, fontWeight: 400, opacity: 0.55 }}>·</Box>
            Trial {currentUnit.trialIndex + 1} / {currentUnit.trialCount}
          </>
        )}
      </Typography>

      {qChunks.length > 1 && (
        <>
          {/* Phones: one compact pager instead of wrapping chip rows */}
          <Box
            sx={{
              display: { xs: 'flex', sm: 'none' },
              alignItems: 'center',
              gap: 1,
              mb: 0.75,
            }}
          >
            <Box
              component="button"
              type="button"
              disabled={groupIdx <= 0}
              onClick={() => setGroupIdx((g) => Math.max(0, g - 1))}
              aria-label="Previous question group"
              sx={{
                minWidth: 28,
                minHeight: 28,
                border: '1px solid',
                borderColor: 'var(--sp-progress-border, #e0e0e0)',
                borderRadius: 1,
                bgcolor: 'transparent',
                cursor: groupIdx <= 0 ? 'not-allowed' : 'pointer',
                opacity: groupIdx <= 0 ? 0.4 : 1,
                fontFamily: 'inherit',
                color: 'var(--sp-progress-label, #757575)',
              }}
            >
              ‹
            </Box>
            <Typography
              variant="caption"
              sx={{ flex: 1, textAlign: 'center', fontWeight: 600, color: 'var(--sp-progress-label, #757575)' }}
            >
              {(() => {
                const start = groupIdx * QUESTION_GROUP_SIZE + 1;
                const end = groupIdx * QUESTION_GROUP_SIZE + activeChunk.length;
                return `Q${start}–${end}`;
              })()}
            </Typography>
            <Box
              component="button"
              type="button"
              disabled={groupIdx >= qChunks.length - 1}
              onClick={() => setGroupIdx((g) => Math.min(qChunks.length - 1, g + 1))}
              aria-label="Next question group"
              sx={{
                minWidth: 28,
                minHeight: 28,
                border: '1px solid',
                borderColor: 'var(--sp-progress-border, #e0e0e0)',
                borderRadius: 1,
                bgcolor: 'transparent',
                cursor: groupIdx >= qChunks.length - 1 ? 'not-allowed' : 'pointer',
                opacity: groupIdx >= qChunks.length - 1 ? 0.4 : 1,
                fontFamily: 'inherit',
                color: 'var(--sp-progress-label, #757575)',
              }}
            >
              ›
            </Box>
          </Box>

          {/* Desktop: chip row */}
          <Box
            sx={{
              display: { xs: 'none', sm: 'flex' },
              flexWrap: 'wrap',
              gap: 0.5,
              mb: 1,
            }}
          >
            {qChunks.map((chunk, gi) => {
              const start = gi * QUESTION_GROUP_SIZE + 1;
              const end = gi * QUESTION_GROUP_SIZE + chunk.length;
              return (
                <Box
                  key={start}
                  component="button"
                  type="button"
                  onClick={() => setGroupIdx(gi)}
                  sx={{
                    border: '1px solid',
                    borderColor: gi === groupIdx
                      ? 'var(--sp-progress-primary, #1976d2)'
                      : 'var(--sp-progress-border, #e0e0e0)',
                    bgcolor: gi === groupIdx
                      ? 'color-mix(in srgb, var(--sp-progress-primary, #1976d2) 12%, transparent)'
                      : 'transparent',
                    borderRadius: 1,
                    px: 1,
                    py: 0.25,
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: 'var(--sp-progress-label, #757575)',
                  }}
                >
                  Q{start}–{end}
                </Box>
              );
            })}
          </Box>
        </>
      )}

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: { xs: 0.5, sm: 0.75 },
          alignItems: 'center',
        }}
      >
        {activeChunk.map((group) => {
          const reached = group.unitStart <= furthest;
          const isViewing = currentUnit?.questionName === group.questionName;
          const { answered, total } = countAnsweredInGroup(
            group,
            surveyModel,
            answeredFloorRef.current,
          );
          const complete = answered >= total && total > 0;
          const multi = total > 1;
          const fillPct = total > 0 ? Math.round((answered / total) * 100) : 0;
          const label = multi
            ? `Q${group.questionIndex + 1} · ${answered}/${total} trials`
            : `Q${group.questionIndex + 1}`;
          const deskW = multi ? Math.min(56, 16 + total * 2) : 16;
          // Compact on phones: still tappable (~22px) without dominating the viewport
          const mobileW = multi ? Math.min(48, 22 + total * 2) : 22;

          return (
            <Tooltip
              key={group.questionName}
              title={reached
                ? (multi ? `${label} — click to jump` : `Question ${group.questionIndex + 1}`)
                : 'Not reached yet'}
            >
              <Box
                component="button"
                type="button"
                disabled={!reached}
                onClick={() => jumpToQuestion(group)}
                aria-label={label}
                sx={{
                  position: 'relative',
                  height: { xs: 22, sm: 16 },
                  minWidth: multi ? { xs: 28, sm: 28 } : { xs: 22, sm: 16 },
                  width: { xs: mobileW, sm: deskW },
                  borderRadius: multi ? 1 : '50%',
                  border: '2px solid',
                  borderColor: complete
                    ? 'var(--sp-progress-success, #4caf50)'
                    : (isViewing
                      ? 'var(--sp-progress-primary, #1976d2)'
                      : 'var(--sp-progress-muted, #bdbdbd)'),
                  bgcolor: 'transparent',
                  overflow: 'hidden',
                  p: 0,
                  cursor: reached ? 'pointer' : 'not-allowed',
                  opacity: reached ? 1 : 0.35,
                  boxShadow: isViewing
                    ? {
                      xs: '0 0 0 1px var(--sp-progress-surface, #fff), 0 0 0 2px var(--sp-progress-primary, #1976d2)',
                      sm: '0 0 0 2px var(--sp-progress-surface, #fff), 0 0 0 4px var(--sp-progress-primary, #1976d2)',
                    }
                    : 'none',
                  flexShrink: 0,
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: `${complete ? 100 : fillPct}%`,
                    bgcolor: complete
                      ? 'var(--sp-progress-success-light, #4caf50)'
                      : 'var(--sp-progress-primary-light, #42a5f5)',
                    opacity: 0.85,
                    transition: 'width 0.2s ease',
                  }}
                />
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      <Box
        sx={{
          mt: { xs: 0.75, sm: 1 },
          height: 4,
          borderRadius: 2,
          bgcolor: 'var(--sp-progress-track, #e0e0e0)',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: `${Math.round(questionProgress * 100)}%`,
            bgcolor: 'var(--sp-progress-primary, #1976d2)',
            transition: 'width 0.2s ease',
          }}
        />
      </Box>
    </Box>
  );
}

function groupUnitsByQuestion(units) {
  const out = [];
  const byName = new Map();
  (units || []).forEach((u, index) => {
    let g = byName.get(u.questionName);
    if (!g) {
      g = {
        questionName: u.questionName,
        questionIndex: u.questionIndex ?? out.length,
        trialCount: u.trialCount || 1,
        unitStart: index,
        unitEnd: index,
        unitIndexes: [],
      };
      byName.set(u.questionName, g);
      out.push(g);
    }
    g.unitEnd = index;
    g.trialCount = u.trialCount || g.trialCount;
    g.unitIndexes.push(index);
  });
  return out;
}

function chunkArray(arr, size) {
  if (!arr.length) return [];
  if (arr.length <= size) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function countAnsweredInGroup(group, surveyModel, answeredFloor = null) {
  const total = group.unitIndexes?.length || group.trialCount || 1;
  const q = surveyModel?.getQuestionByName?.(group.questionName);
  const stored = getStoredTrialsAnswer(group.questionName)
    || getTrialsAnswer(q);

  let answered = 0;
  if (total > 1 && isTrialsAnswer(stored)) {
    for (let i = 0; i < total; i += 1) {
      if (trialHasAnswer(stored.trials?.[i], q)) answered += 1;
    }
  } else if (q && questionUnitHasAnswer(q, 0)) {
    answered = 1;
  }

  if (answeredFloor && group.questionName) {
    const prev = answeredFloor.get(group.questionName) || 0;
    answered = Math.max(answered, prev);
    if (answered > prev) answeredFloor.set(group.questionName, answered);
  }
  return { answered, total };
}

/** 0–1 progress: completed questions + partial credit for current multi-trial. */
function computeQuestionProgress(questionGroups, surveyModel, furthest, answeredFloor) {
  if (!questionGroups.length) return 0;
  let score = 0;
  questionGroups.forEach((group) => {
    if (group.unitStart > furthest) return;
    const { answered, total } = countAnsweredInGroup(group, surveyModel, answeredFloor);
    if (total <= 0) return;
    if (answered >= total) {
      score += 1;
      return;
    }
    score += answered / total;
  });
  return Math.min(1, score / questionGroups.length);
}

import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import React, { useEffect, useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Card,
  CardContent,
  CardActions,
  IconButton,
  Grid,
  Fab,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip
} from '@mui/material';
import {
  Add,
  Delete,
  Edit,
  DragIndicator,
  ContentCopy
} from '@mui/icons-material';
import ConfirmDialog from '../layout/ConfirmDialog';
import { allocateUniqueName, collectUsedQuestionNames } from '../../lib/questionNames';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import QuestionEditor from './QuestionEditor';
import { useQuestionEditorText } from '../../contexts/questionEditorI18n';
import { getPresetSkill } from '../../lib/presetSkills';

function skillQuestionTypeLabel(question) {
  if (question?.type !== 'skillquestion') return null;
  const preset = getPresetSkill(question.skillId);
  if (preset) return preset.builderLabel || preset.name;
  if (question.skillId) return 'Custom interactive task';
  return 'Custom interactive task (not configured)';
}

// Sortable Question Item Component
function SortableQuestionItem({ question, questionIndex, onEdit, onDelete, onDuplicate }) {
  const { tr } = useQuestionEditorText();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `question-${questionIndex}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getQuestionTypeLabel = (question) => {
    const type = typeof question === 'string' ? question : question.type;
    
    // Special handling for image ranking questions
    if (typeof question === 'object' && type === 'ranking' && question.isImageRanking) {
      return 'Image Ranking';
    }

    if (type === 'skillquestion') {
      return skillQuestionTypeLabel(typeof question === 'object' ? question : null) || 'Custom interactive task';
    }
    
    const typeLabels = {
      text: 'Text Input',
      comment: 'Text Multi-line Input',
      radiogroup: 'Text Single Choice',
      checkbox: 'Text Multiple Choice',
      imagepicker: 'Image Choice',
      imageranking: 'Image Ranking',
      imagerating: 'Image Rating Scale',
      imageboolean: 'Image Yes/No',
      imagecheckbox: 'Image Multi-select',
      ranking: 'Text Ranking',
      rating: 'Text Rating Scale',
      boolean: 'Text Yes/No',
      dropdown: 'Text Dropdown',
      matrix: 'Text Matrix',
      imagematrix: 'Image Matrix',
      expression: 'Text Instruction',
      number: 'Text Number',
      consent: 'Text Consent',
      image: 'Image Display (1 image)',
      mediadisplay: 'Media Display',
      mediapicker: 'Media Choice',
      mediaranking: 'Media Ranking',
      mediarating: 'Media Rating',
      mediaboolean: 'Media Yes/No',
      mediacheckbox: 'Media Multi-select',
      mediamatrix: 'Media Matrix',
      mediaslidergroup: 'Media Slider Group',
      mediapointallocation: 'Media Point Allocation',
      imageannotation: 'Image Annotation',
      slidergroup: 'Text Slider Group',
      imageslidergroup: 'Image Slider Group',
      pointallocation: 'Text Point Allocation',
      imagepointallocation: 'Image Point Allocation',
    };
    return typeLabels[type] || type;
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={{
        mb: 2,
        bgcolor: 'background.paper',
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        '&:hover': {
          borderColor: 'primary.main',
          bgcolor: 'action.hover',
        },
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        aria-label={tr('Drag to reorder question')}
        sx={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'grab',
          mr: 2,
          '&:active': {
            cursor: 'grabbing',
          },
        }}
      >
        <DragIndicator color="action" />
      </Box>
      
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
            <Typography variant="subtitle1">
              {question.title || tr('Question {number}', { number: questionIndex + 1 })}
            </Typography>
            <Chip
              label={tr(getQuestionTypeLabel(question))}
              size="small"
              color="secondary"
              variant="outlined"
            />
            {question.isRequired && (
              <Chip
                label={tr("Required")}
                size="small"
                color="error"
                variant="outlined"
              />
            )}
          </Box>
        }
        secondary={
          <Typography variant="body2" color="text.secondary">
            {question.description || tr('No description provided')}
          </Typography>
        }
      />
      
      <ListItemSecondaryAction>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton
            size="small"
            color="primary"
            aria-label={tr("Edit question")}
            onClick={() => onEdit({ question, index: questionIndex })}
            sx={{ 
              border: 1, 
              borderColor: 'primary.main',
              '&:hover': { bgcolor: 'primary.light', borderColor: 'primary.dark' }
            }}
          >
            <Edit fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="primary"
            aria-label={tr("Duplicate question")}
            onClick={() => onDuplicate(questionIndex)}
            sx={{ 
              border: 1, 
              borderColor: 'primary.main',
              '&:hover': { bgcolor: 'primary.light', borderColor: 'primary.dark' }
            }}
          >
            <ContentCopy fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label={tr("Delete question")}
            onClick={() => onDelete(questionIndex)}
            sx={{ 
              border: 1, 
              borderColor: 'error.main',
              '&:hover': { bgcolor: 'error.light', borderColor: 'error.dark' }
            }}
          >
            <Delete fontSize="small" />
          </IconButton>
        </Box>
      </ListItemSecondaryAction>
    </ListItem>
  );
}

export default function PageEditor({ page, pageIndex, onSave, onCancel, images, currentProject, surveyConfig, onSelectionChange, onWorkspaceChange }) {
  const { tr } = useQuestionEditorText();
  const [editedPage, setEditedPage] = useState({ ...page });
  const [selectedQuestion, setSelectedQuestion] = useState(null);

  const initialPage = useRef(JSON.stringify(page));
  const pageDirty = JSON.stringify(editedPage) !== initialPage.current;
  useEffect(() => {
    const selection = {
      pageName: editedPage?.name || page?.name,
      questionName: selectedQuestion?.question?.name || null,
      pageWorkingCopy: editedPage,
      pageDirty,
      dirty: pageDirty,
    };
    onSelectionChange?.(selection);
    onWorkspaceChange?.({
      open: false,
      ...selection,
    });
  }, [editedPage, page?.name, pageDirty, selectedQuestion, onSelectionChange, onWorkspaceChange]);
  const guard = useUnsavedChanges(pageDirty);
  const closeEditor = () => guard.request(onCancel);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handlePageChange = (field, value) => {
    setEditedPage({
      ...editedPage,
      [field]: value
    });
  };

  const addNewQuestion = () => {
    const newQuestion = {
      type: "text",
      name: `question_${Date.now()}`,
      title: "New Question",
      isRequired: false
    };
    
    setEditedPage({
      ...editedPage,
      elements: [...(editedPage.elements || []), newQuestion]
    });
  };

  const deleteQuestion = (questionIndex) => {
    const question = editedPage.elements[questionIndex];
    const title = question?.title || question?.name || tr('Question {number}', { number: questionIndex + 1 });
    setConfirmDialog({
      title: 'Delete question',
      message: 'Delete "{title}"? This cannot be undone.',
      values: { title },
      confirmLabel: 'Delete',
      confirmColor: 'error',
      onConfirm: () => {
        setConfirmDialog(null);
        const newElements = editedPage.elements.filter((_, index) => index !== questionIndex);
        setEditedPage({
          ...editedPage,
          elements: newElements
        });
      },
    });
  };

  const duplicateQuestion = (questionIndex) => {
    const questionToDuplicate = editedPage.elements[questionIndex];
    const duplicatedQuestion = JSON.parse(JSON.stringify(questionToDuplicate));

    // Names must be unique across the whole survey, not just this page.
    const draftConfig = {
      ...(surveyConfig || {}),
      pages: (surveyConfig?.pages || []).map((p, i) => (
        i === pageIndex ? editedPage : p
      )),
    };
    // If this page isn't in surveyConfig yet, append editedPage for name collection.
    if (!surveyConfig?.pages?.[pageIndex]) {
      draftConfig.pages = [...(draftConfig.pages || []), editedPage];
    }
    const usedNames = collectUsedQuestionNames(draftConfig);
    duplicatedQuestion.name = allocateUniqueName(
      questionToDuplicate.name || 'question',
      usedNames,
    );

    const titleUsed = new Set(
      (editedPage.elements || []).map((el) => el?.title).filter(Boolean),
    );
    duplicatedQuestion.title = allocateUniqueName(
      questionToDuplicate.title || 'New Question',
      titleUsed,
    );

    const newElements = [
      ...editedPage.elements.slice(0, questionIndex + 1),
      duplicatedQuestion,
      ...editedPage.elements.slice(questionIndex + 1),
    ];

    setEditedPage({
      ...editedPage,
      elements: newElements,
    });
  };

  const updateQuestion = (questionIndex, updatedQuestion) => {
    const newElements = [...editedPage.elements];
    newElements[questionIndex] = updatedQuestion;
    setEditedPage({
      ...editedPage,
      elements: newElements
    });
  };

  const handleQuestionDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = parseInt(active.id.split('-')[1]);
      const newIndex = parseInt(over.id.split('-')[1]);

      const newElements = arrayMove(editedPage.elements || [], oldIndex, newIndex);
      setEditedPage({
        ...editedPage,
        elements: newElements
      });
    }
  };

  return (
    <>
      <Dialog open onClose={closeEditor} maxWidth="lg" fullWidth>
        <DialogTitle>
          {tr('Edit Page: {title}', { title: page.title || tr('Page {number}', { number: pageIndex + 1 }) })}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
              {tr("Page Settings")}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <TextField
                fullWidth
                variant="outlined"
                label={tr("Page Title")}
                value={editedPage.title || ''}
                onChange={(e) => handlePageChange('title', e.target.value)}
                helperText={tr("The title that appears at the top of this page")}
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />
              
              <TextField
                fullWidth
                variant="outlined"
                multiline
                rows={3}
                label={tr("Page Description")}
                value={editedPage.description || ''}
                onChange={(e) => handlePageChange('description', e.target.value)}
                helperText={tr("Optional description to explain what this page is about")}
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />
            </Box>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" sx={{ color: 'primary.main' }}>
              {tr("Questions")}
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={addNewQuestion}
              size="large"
            >
              {tr("Add Question")}
            </Button>
          </Box>

          {editedPage.elements && editedPage.elements.length > 0 ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {tr("Drag and drop to reorder questions within this page.")}
              </Typography>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleQuestionDragEnd}
              >
                <SortableContext
                  items={editedPage.elements.map((_, index) => `question-${index}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <List sx={{ width: '100%' }}>
                    {editedPage.elements.map((question, questionIndex) => (
                      <SortableQuestionItem
                        key={`question-${questionIndex}`}
                        question={question}
                        questionIndex={questionIndex}
                        onEdit={setSelectedQuestion}
                        onDuplicate={duplicateQuestion}
                        onDelete={deleteQuestion}
                      />
                    ))}
                  </List>
                </SortableContext>
              </DndContext>
            </Box>
          ) : (
            <Box sx={{ textAlign: 'center', py: 4, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {tr("No questions added yet. Click \"Add Question\" to get started.")}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditor}>{tr('Cancel')}</Button>
          <Button onClick={() => onSave(editedPage)} variant="contained">
            {tr("Save Page")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Question Editor */}
      {selectedQuestion && (
        <QuestionEditor
          pageName={editedPage?.name || page?.name}
          question={selectedQuestion.question}
          onSave={(updatedQuestion) => {
            updateQuestion(selectedQuestion.index, updatedQuestion);
            setSelectedQuestion(null);
          }}
          onCancel={() => setSelectedQuestion(null)}
          onWorkingCopyChange={(info) => {
            onSelectionChange?.({
              pageName: editedPage?.name || page?.name,
              questionName: info?.questionName || selectedQuestion.question?.name,
              workingCopy: info?.workingCopy,
              baseline: info?.baseline,
              dirty: Boolean(info?.dirty || pageDirty),
              pageWorkingCopy: editedPage,
              pageDirty,
            });
          }}
          images={images}
          currentProject={currentProject}
          surveyConfig={surveyConfig}
        />
      )}
      <ConfirmDialog open={guard.open} onCancel={guard.cancel} onConfirm={guard.discard}
        title={tr("Discard unsaved page changes?")} message={tr("Your page and question changes have not been saved.")}
        confirmLabel={tr("Discard changes")} cancelLabel={tr("Keep editing")} />
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={tr(confirmDialog?.title)}
        message={tr(confirmDialog?.message, confirmDialog?.values)}
        confirmLabel={tr(confirmDialog?.confirmLabel)}
        cancelLabel={tr('Cancel')}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </>
  );
}

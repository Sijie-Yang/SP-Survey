import React, { useState } from 'react';
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

// Sortable Question Item Component
function SortableQuestionItem({ question, questionIndex, onEdit, onDelete, onDuplicate }) {
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
    
    const typeLabels = {
      text: 'Text Input',
      comment: 'Text Multi-line Input',
      radiogroup: 'Text Single Choice',
      checkbox: 'Text Multiple Choice',
      imagepicker: 'Image Choice',
      imageranking: 'Image Ranking',
      imagerating: 'Image Rating Scale',
      imageboolean: 'Image Yes/No',
      ranking: 'Text Ranking',
      rating: 'Text Rating Scale',
      boolean: 'Text Yes/No',
      dropdown: 'Text Dropdown',
      matrix: 'Matrix',
      imagematrix: 'Image Matrix',
      expression: 'Text Instruction',
      image: 'Image Display (1 image)',
      mediadisplay: 'Media Display',
      mediarating: 'Media Rating',
      mediaboolean: 'Media Yes/No',
      imageannotation: 'Image Annotation',
      slidergroup: 'Slider Group',
      imageslidergroup: 'Image Slider Group',
      pointallocation: 'Point Allocation',
      imagepointallocation: 'Image Point Allocation',
      skillquestion: 'Skill Question',
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle1">
              {question.title || `Question ${questionIndex + 1}`}
            </Typography>
            <Chip
              label={getQuestionTypeLabel(question)}
              size="small"
              color="secondary"
              variant="outlined"
            />
            {question.isRequired && (
              <Chip
                label="Required"
                size="small"
                color="error"
                variant="outlined"
              />
            )}
          </Box>
        }
        secondary={
          <Typography variant="body2" color="text.secondary">
            {question.description || 'No description provided'}
          </Typography>
        }
      />
      
      <ListItemSecondaryAction>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton
            size="small"
            color="primary"
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

export default function PageEditor({ page, pageIndex, onSave, onCancel, images, currentProject }) {
  const [editedPage, setEditedPage] = useState({ ...page });
  const [selectedQuestion, setSelectedQuestion] = useState(null);

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
    const title = question?.title || question?.name || `Question ${questionIndex + 1}`;
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;

    const newElements = editedPage.elements.filter((_, index) => index !== questionIndex);
    setEditedPage({
      ...editedPage,
      elements: newElements
    });
  };

  const duplicateQuestion = (questionIndex) => {
    const questionToDuplicate = editedPage.elements[questionIndex];
    // Deep clone the question
    const duplicatedQuestion = JSON.parse(JSON.stringify(questionToDuplicate));
    
    const underscoreNumberPattern = /_(\d+)$/;
    
    // Smart name generation: check if name ends with _number
    const originalName = questionToDuplicate.name;
    const nameMatch = originalName.match(underscoreNumberPattern);
    
    if (nameMatch) {
      // Name ends with _number, increment the number
      const currentNumber = parseInt(nameMatch[1], 10);
      const newNumber = currentNumber + 1;
      duplicatedQuestion.name = originalName.replace(underscoreNumberPattern, `_${newNumber}`);
    } else {
      // Name doesn't end with _number, add _1
      duplicatedQuestion.name = `${originalName}_1`;
    }
    // Smart title generation: check if title ends with _number
    const originalTitle = questionToDuplicate.title || 'New Question';
    const titleMatch = originalTitle.match(underscoreNumberPattern);
    
    if (titleMatch) {
      // Title ends with _number, increment the number
      const currentNumber = parseInt(titleMatch[1], 10);
      const newNumber = currentNumber + 1;
      duplicatedQuestion.title = originalTitle.replace(underscoreNumberPattern, `_${newNumber}`);
    } else {
      // Title doesn't end with _number, add _1
      duplicatedQuestion.title = `${originalTitle}_1`;
    }
    
    // Insert the duplicated question right after the original
    const newElements = [
      ...editedPage.elements.slice(0, questionIndex + 1),
      duplicatedQuestion,
      ...editedPage.elements.slice(questionIndex + 1)
    ];
    
    setEditedPage({
      ...editedPage,
      elements: newElements
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

  const getQuestionTypeLabel = (question) => {
    const type = typeof question === 'string' ? question : question.type;
    
    // Special handling for image ranking questions
    if (typeof question === 'object' && type === 'ranking' && question.isImageRanking) {
      return 'Image Ranking';
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
      ranking: 'Text Ranking',
      rating: 'Text Rating Scale',
      boolean: 'Text Yes/No',
      dropdown: 'Text Dropdown',
      matrix: 'Matrix',
      imagematrix: 'Image Matrix',
      expression: 'Text Instruction',
      image: 'Image Display (1 image)',
      mediadisplay: 'Media Display',
      mediarating: 'Media Rating',
      mediaboolean: 'Media Yes/No',
      imageannotation: 'Image Annotation',
      slidergroup: 'Slider Group',
      imageslidergroup: 'Image Slider Group',
      pointallocation: 'Point Allocation',
      imagepointallocation: 'Image Point Allocation',
      skillquestion: 'Skill Question',
    };
    return typeLabels[type] || type;
  };

  return (
    <>
      <Dialog open={true} onClose={onCancel} maxWidth="lg" fullWidth>
        <DialogTitle>
          Edit Page: {page.title}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
              Page Settings
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <TextField
                fullWidth
                variant="outlined"
                label="Page Title"
                value={editedPage.title || ''}
                onChange={(e) => handlePageChange('title', e.target.value)}
                helperText="The title that appears at the top of this page"
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />
              
              <TextField
                fullWidth
                variant="outlined"
                multiline
                rows={3}
                label="Page Description"
                value={editedPage.description || ''}
                onChange={(e) => handlePageChange('description', e.target.value)}
                helperText="Optional description to explain what this page is about"
                sx={{ '& .MuiInputLabel-root': { backgroundColor: 'white', px: 1 } }}
              />
            </Box>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" sx={{ color: 'primary.main' }}>
              Questions
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={addNewQuestion}
              size="large"
            >
              Add Question
            </Button>
          </Box>

          {editedPage.elements && editedPage.elements.length > 0 ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Drag and drop to reorder questions within this page.
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
                No questions added yet. Click "Add Question" to get started.
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onSave(editedPage)} variant="contained">
            Save Page
          </Button>
        </DialogActions>
      </Dialog>

      {/* Question Editor */}
      {selectedQuestion && (
        <QuestionEditor
          question={selectedQuestion.question}
          onSave={(updatedQuestion) => {
            updateQuestion(selectedQuestion.index, updatedQuestion);
            setSelectedQuestion(null);
          }}
          onCancel={() => setSelectedQuestion(null)}
          images={images}
          currentProject={currentProject}
        />
      )}
    </>
  );
}

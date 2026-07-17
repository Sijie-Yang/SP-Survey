import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box, Typography, Card } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { resolveQuestionImageChoices } from '../lib/questionImageChoices';

function SortableItem({ id, image, index }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (!image || !image.imageLink) {
    return (
      <Card sx={{ mb: 1, p: 2, bgcolor: 'error.light' }}>
        <Typography>Error: No image data</Typography>
      </Card>
    );
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="sp-image-gallery__item"
      sx={{
        position: 'relative',
        width: '100%',
        background: 'transparent',
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        mb: 0,
      }}
    >
      <Box
        className="sp-image-gallery__image-container"
        sx={{ position: 'relative', lineHeight: 0, flex: '0 0 auto', minWidth: 0 }}
      >
        <Box
          component="img"
          src={image.imageLink}
          alt={`Image ${index + 1}`}
          sx={{ display: 'block' }}
          draggable={false}
        />
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            bgcolor: 'rgba(0,0,0,0.7)',
            color: 'white',
            borderRadius: 1,
            px: 1,
            py: 0.5,
            fontSize: '0.875rem',
            fontWeight: 'bold',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        >
          #{index + 1}
        </Box>
      </Box>
      {/* Drag only via handle — rest of row scrolls the page on touch */}
      <Box
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder image ${index + 1}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
          width: { xs: 44, sm: 40 },
          touchAction: 'none',
          cursor: 'grab',
          bgcolor: 'action.hover',
          borderLeft: '1px solid',
          borderColor: 'divider',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorIcon fontSize="small" color="action" />
      </Box>
    </Card>
  );
}

export default function ImageRankingWidget({ question, value, onValueChanged, trialStimulusMedia = null }) {
  const [items, setItems] = useState([]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    // Long-press before drag so vertical scroll still works on phones
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const trialMediaKey = Array.isArray(trialStimulusMedia)
    ? trialStimulusMedia.map((m) => (typeof m === 'string' ? m : m?.url)).filter(Boolean).join('|')
    : '';

  useEffect(() => {
    const resolved = resolveQuestionImageChoices(question, trialStimulusMedia);
    if (!resolved.length) {
      setItems([]);
      return;
    }

    const initialItems = resolved.map((choice, index) => ({
      id: choice.value || `item-${index}`,
      value: choice.value,
      imageLink: choice.imageLink,
      originalIndex: index,
    }));

    if (value && Array.isArray(value) && value.length > 0) {
      const orderedItems = value.map((val) => (
        initialItems.find((item) => item.value === val)
      )).filter(Boolean);
      const usedValues = new Set(value);
      const missingItems = initialItems.filter((item) => !usedValues.has(item.value));
      setItems([...orderedItems, ...missingItems]);
    } else {
      setItems(initialItems);
    }
  }, [question, question.choices, question.imageLinks, value, trialMediaKey, trialStimulusMedia]);

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((prev) => {
      const oldIndex = prev.findIndex((item) => item.id === active.id);
      const newIndex = prev.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const newItems = arrayMove(prev, oldIndex, newIndex);
      onValueChanged(newItems.map((item) => item.value));
      return newItems;
    });
  }

  if (!items || items.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
        <Typography>No images available for ranking</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Drag the handle on the right to reorder (touch: press & hold).
      </Typography>
      <Box
        className="sp-image-gallery sp-image-gallery--vertical sp-image-gallery--with-handle"
        sx={{ width: '100%' }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            {items.map((item, index) => (
              <SortableItem
                key={item.id}
                id={item.id}
                image={item}
                index={index}
              />
            ))}
          </SortableContext>
        </DndContext>
      </Box>
    </Box>
  );
}

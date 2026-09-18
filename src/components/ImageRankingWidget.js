import { MediaPlayer } from './MediaWidgets';
import { resolveSurveyUiLanguage } from '../lib/surveyLocale';
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
import { Box, Typography, Card, Button, IconButton } from '@mui/material';
import { ArrowUpward, ArrowDownward } from '@mui/icons-material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { resolveQuestionImageChoices } from '../lib/questionImageChoices';

function SortableItem({ id, image, index, readOnly, onMove, total, zh }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: readOnly });

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

  const isPlayable = image.mediaType === 'video' || image.mediaType === 'audio';
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={isPlayable ? 'sp-media-ranking-item' : 'sp-image-gallery__item'}
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
        sx={{ position: 'relative', lineHeight: 0, flex: isPlayable ? '1 1 auto' : '0 0 auto', minWidth: 0 }}
      >
        {isPlayable ? <MediaPlayer url={image.imageLink} type={image.mediaType} name={image.name} /> : <Box
          component="img"
          src={image.imageLink}
          alt={`Image ${index + 1}`}
          sx={{ display: 'block' }}
          draggable={false}
        />}
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
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <IconButton disabled={readOnly || index === 0} onClick={() => onMove(index, index - 1)}
        aria-label={zh ? `上移第 ${index + 1} 项` : `Move item ${index + 1} up`} sx={{ width: 44, height: 44 }}><ArrowUpward /></IconButton>
      <Box
        {...(readOnly ? {} : attributes)}
        {...(readOnly ? {} : listeners)}
        aria-label={zh ? `拖动第 ${index + 1} 项` : `Drag to reorder image ${index + 1}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
          width: 44,
          minHeight: 44,
          touchAction: 'none',
          cursor: readOnly ? 'default' : 'grab',
          bgcolor: 'action.hover',
          borderLeft: '1px solid',
          borderColor: 'divider',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorIcon fontSize="small" color="action" />
      </Box>
      <IconButton disabled={readOnly || index === total - 1} onClick={() => onMove(index, index + 1)}
        aria-label={zh ? `下移第 ${index + 1} 项` : `Move item ${index + 1} down`} sx={{ width: 44, height: 44 }}><ArrowDownward /></IconButton>
      </Box>
    </Card>
  );
}

export default function ImageRankingWidget({ question, value, onValueChanged, trialStimulusMedia = null }) {
  const [items, setItems] = useState([]);
  const zh = resolveSurveyUiLanguage(question?.survey) === 'zh';
  const readOnly = !!question?.isReadOnly || question?.survey?.mode === 'display';

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
      mediaType: trialStimulusMedia?.[index]?.type || question.mediaItems?.[index]?.type || question.mediaTypes?.[index]
        || (/\.(mp4|webm|mov)(\?|$)/i.test(choice.imageLink) ? 'video' : /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(choice.imageLink) ? 'audio' : 'image'),
      name: choice.imageName,
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
  }, [question, question.choices, question.imageLinks, value, trialMediaKey, trialStimulusMedia, onValueChanged]);

  function moveItem(oldIndex, newIndex) {
    if (readOnly || oldIndex < 0 || newIndex < 0 || newIndex >= items.length) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    onValueChanged?.(next.map((item) => item.value));
  }

  function handleDragEnd({ active, over }) {
    if (readOnly || !over || active.id === over.id) return;
    moveItem(items.findIndex((item) => item.id === active.id), items.findIndex((item) => item.id === over.id));
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
        {zh ? '点击上下箭头或拖动手柄调整顺序（手机上长按拖动），也可以确认当前顺序。' : 'Use the up/down buttons or drag the handle (touch: press and hold), or confirm the current order.'}
      </Typography>
      <Button variant="outlined" sx={{ mb: 1 }} disabled={!items.length || readOnly}
        onClick={() => { if (!readOnly) onValueChanged?.(items.map((item) => item.value)); }}>
        {Array.isArray(value) && value.length ? (zh ? '已确认顺序' : 'Order confirmed') : (zh ? '确认当前顺序' : 'Confirm current order')}
      </Button>
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
                readOnly={readOnly} onMove={moveItem} total={items.length} zh={zh}
              />
            ))}
          </SortableContext>
        </DndContext>
      </Box>
    </Box>
  );
}

import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import DragIndicator from '@mui/icons-material/DragIndicator';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { movePage, moveQuestion, relocateQuestion } from '../../lib/viewportLayout';

function OutlineRow({ id, data, title, selected, onSelect, onMove, first, last, labels, children }) {
  const drag = useDraggable({ id, data });
  const drop = useDroppable({ id, data });
  return (
    <Box ref={drop.setNodeRef} sx={{ borderTop: '2px solid', borderColor: drop.isOver ? 'primary.main' : 'transparent', mb: 0.25 }}>
      <Box ref={drag.setNodeRef} sx={{ position: 'relative', display: 'flex', alignItems: 'center', borderRadius: 1.5, bgcolor: selected ? 'primary.50' : 'transparent', background: selected ? 'rgba(25,118,210,.09)' : undefined, opacity: drag.isDragging ? 0.35 : 1, '&:hover': { bgcolor: 'action.hover' }, '& .outline-move': { opacity: 0, pointerEvents: 'none' }, '&:hover .outline-move, &:focus-within .outline-move': { opacity: 1, pointerEvents: 'auto' } }}>
        <IconButton size="small" {...drag.listeners} {...drag.attributes} aria-label={`${labels.drag}: ${title}`} sx={{ cursor: 'grab', touchAction: 'none', color: 'text.disabled' }}><DragIndicator sx={{ fontSize: 17 }} /></IconButton>
        <Box component="button" onClick={onSelect} title={title} sx={{ border: 0, background: 'none', color: selected ? 'primary.main' : 'text.primary', cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0, py: 1, font: 'inherit', fontSize: 12, fontWeight: data.kind === 'page' ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Box>
        <Box className="outline-move" sx={{ display: 'flex', position: 'absolute', right: 0, bgcolor: 'background.paper', borderRadius: 1 }}>
          <IconButton size="small" disabled={first} aria-label={`${labels.up}: ${title}`} onClick={() => onMove(-1)}><ArrowUpward sx={{ fontSize: 13 }} /></IconButton>
          <IconButton size="small" disabled={last} aria-label={`${labels.down}: ${title}`} onClick={() => onMove(1)}><ArrowDownward sx={{ fontSize: 13 }} /></IconButton>
        </Box>
      </Box>
      {children}
    </Box>
  );
}

export default function PreviewOutline({ config, selection, onSelect, onChange, labels }) {
  const [active, setActive] = React.useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }));
  const pages = config?.pages || [];
  const drop = ({ active: dragged, over }) => {
    setActive(null);
    if (!over || over.id === dragged.id) return;
    const from = dragged.data.current;
    const to = over.data.current;
    if (from.kind === 'page') {
      const index = pages.findIndex((p) => p.name === from.name);
      const target = pages.findIndex((p) => p.name === to.pageName);
      if (target >= 0) onChange(movePage(config, from.name, target - index));
    } else {
      onChange(relocateQuestion(config, from.name, to.pageName, to.kind === 'question' ? to.name : null));
      onSelect({ kind: 'question', name: from.name, pageName: to.pageName });
    }
  };
  return (
    <DndContext sensors={sensors} onDragStart={({ active: item }) => setActive(item.data.current.title)} onDragCancel={() => setActive(null)} onDragEnd={drop}>
      {pages.map((page, index) => {
        const title = `${String(index + 1).padStart(2, '0')} · ${page.title || page.name}`;
        return <OutlineRow key={page.name} id={`page:${page.name}`} data={{ kind: 'page', name: page.name, pageName: page.name, title }} title={title} labels={labels}
          selected={selection.kind === 'page' && selection.name === page.name} onSelect={() => onSelect({ kind: 'page', name: page.name, pageName: page.name })}
          first={index === 0} last={index === pages.length - 1} onMove={(direction) => onChange(movePage(config, page.name, direction))}>
          <Box sx={{ pl: 1.5, ml: 1.5, borderLeft: '1px solid', borderColor: 'divider' }}>
            {(page.elements || []).map((question, qIndex, list) => {
              const caption = `${qIndex + 1}. ${question.title || question.name}`;
              return <OutlineRow key={question.name} id={`question:${question.name}`} data={{ kind: 'question', name: question.name, pageName: page.name, title: caption }} title={caption} labels={labels}
                selected={selection.kind === 'question' && selection.name === question.name} onSelect={() => onSelect({ kind: 'question', name: question.name, pageName: page.name })}
                first={qIndex === 0} last={qIndex === list.length - 1} onMove={(direction) => onChange(moveQuestion(config, question.name, direction))} />;
            })}
            {!page.elements?.length && <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>{labels.emptyPage}</Typography>}
          </Box>
        </OutlineRow>;
      })}
      <DragOverlay>{active ? <Box sx={{ bgcolor: 'background.paper', p: 1.5, boxShadow: 4, borderRadius: 1, fontSize: 12 }}>{active}</Box> : null}</DragOverlay>
    </DndContext>
  );
}

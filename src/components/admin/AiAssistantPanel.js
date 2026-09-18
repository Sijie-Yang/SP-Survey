import React from 'react';
import ChatAssistant from './ChatAssistant';
import { chatPropsFromAssistant } from '../../hooks/useSurveyAssistant';

/**
 * Embeddable AI shell for Admin Dashboard Survey Builder dialogs.
 * Reuses the same controller + chat content as the global sidebar.
 */
export default function AiAssistantPanel({
  assistant,
  onOpenSilicon,
}) {
  return (
    <ChatAssistant
      variant="embedded"
      fillHeight={false}
      onOpenSilicon={onOpenSilicon}
      {...chatPropsFromAssistant(assistant)}
    />
  );
}

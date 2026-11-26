import React, { createContext, useContext } from 'react';

const TrialAdvanceHoldContext = createContext(null);

export function TrialAdvanceHoldProvider({ value, children }) {
  return (
    <TrialAdvanceHoldContext.Provider value={value}>
      {children}
    </TrialAdvanceHoldContext.Provider>
  );
}

/** Sliders and number fields hold auto-advance until the gesture is released. */
export function useTrialAdvanceHold() {
  return useContext(TrialAdvanceHoldContext);
}

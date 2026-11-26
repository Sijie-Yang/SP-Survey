import React, { createContext, useContext } from 'react';
import { LOCAL_USER_ID } from '../lib/appMode';

// Self-hosted SP-Survey has no accounts. Components shared with the hosted
// platform still call useAuth(), so every caller sees one local user.
const LOCAL_AUTH = Object.freeze({
  user: Object.freeze({ id: LOCAL_USER_ID, email: null }),
  loading: false,
  isAuthenticated: true,
  login: async () => ({ success: false, error: 'Accounts are not used in self-hosted SP-Survey.' }),
  register: async () => ({ success: false, error: 'Accounts are not used in self-hosted SP-Survey.' }),
  logout: async () => {},
  sendPasswordReset: async () => ({ success: false }),
  resendConfirmation: async () => ({ success: false }),
  setNewPassword: async () => ({ success: false }),
});

const AuthContext = createContext(LOCAL_AUTH);

export const isResetPage = () => false;

export function AuthProvider({ children }) {
  return <AuthContext.Provider value={LOCAL_AUTH}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext) || LOCAL_AUTH;
export const useOptionalAuth = () => useContext(AuthContext) || LOCAL_AUTH;

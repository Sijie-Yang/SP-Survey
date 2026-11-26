import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box, CircularProgress } from '@mui/material';
import { RegionProvider } from './contexts/RegionContext';
import { ToastProvider } from './components/layout/ToastProvider';
import { createCustomTheme, DEFAULT_THEME_KEY } from './themes/themeConfig';

const QuestionPreviewPage = lazy(() => import('./components/admin/QuestionPreviewPage'));
const SurveyApp = lazy(() => import('./SurveyApp'));
const AdminApp = lazy(() => import('./AdminApp'));
const SkillEditorPage = lazy(() => import('./pages/SkillEditorPage'));
const SkillLibraryPage = lazy(() => import('./pages/SkillLibraryPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const StudioPage = lazy(() => import('./pages/StudioPage'));

const theme = createCustomTheme(DEFAULT_THEME_KEY);

const router = createBrowserRouter(createRoutesFromElements(
  <>
    <Route path="/survey" element={<SurveyApp />} />
    <Route path="/admin" element={<AdminApp />} />
    <Route path="/admin/integrations" element={<IntegrationsPage />} />
    <Route path="/studio" element={<StudioPage />} />
    <Route path="/studio/:projectId" element={<StudioPage />} />
    <Route path="/skills" element={<SkillLibraryPage />} />
    <Route path="/skill-editor" element={<SkillEditorPage />} />
    <Route path="/skill-editor/:id" element={<SkillEditorPage />} />
    <Route path="/" element={<Navigate to="/admin" replace />} />
  </>
));

export default function App() {
  if (window.location.pathname === '/question-preview') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RegionProvider>
          <Suspense fallback={<CircularProgress aria-label="Loading preview" />}>
            <QuestionPreviewPage />
          </Suspense>
        </RegionProvider>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RegionProvider>
        <Suspense fallback={<Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Loading" /></Box>}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </Suspense>
      </RegionProvider>
    </ThemeProvider>
  );
}

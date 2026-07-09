import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import SurveyApp from './SurveyApp';
import AdminApp from './AdminApp';
import SkillEditorPage from './pages/SkillEditorPage';
import SkillLibraryPage from './pages/SkillLibraryPage';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    secondary: { main: '#dc004e' },
  },
});

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Routes>
          <Route path="/survey" element={<SurveyApp />} />
          <Route path="/admin" element={<AdminApp />} />
          <Route path="/skills" element={<SkillLibraryPage />} />
          <Route path="/skill-editor" element={<SkillEditorPage />} />
          <Route path="/skill-editor/:id" element={<SkillEditorPage />} />
          <Route path="/" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

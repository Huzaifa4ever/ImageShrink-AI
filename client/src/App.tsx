import { Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import Navbar from './components/layout/Navbar';
import { RedirectIfAuthed, RequireAuth } from './components/RouteGuards';
import { AuthProvider } from './context/AuthContext';
import LandingPage from './pages/LandingPage';
import ExtensionPage from './pages/ExtensionPage';
import DocsPage from './pages/DocsPage';
import ActivatePage from './pages/ActivatePage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import WorkbenchPage from './pages/WorkbenchPage';
import AnalysisPage from './pages/AnalysisPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';

function App() {
  return (
    <AuthProvider>
      <Box sx={{ minHeight: '100vh', position: 'relative' }}>
        <div className="grid-bg" />
        <div className="glow-orb glow-orb-1" />
        <div className="glow-orb glow-orb-2" />

        <Navbar />

        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/extension" element={<ExtensionPage />} />
          <Route path="/docs" element={<DocsPage />} />

          <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
          <Route path="/signup" element={<RedirectIfAuthed><SignupPage /></RedirectIfAuthed>} />

          <Route path="/activate" element={<RequireAuth><ActivatePage /></RequireAuth>} />

          <Route path="/workbench" element={<RequireAuth><WorkbenchPage /></RequireAuth>} />
          <Route path="/analysis/:id" element={<RequireAuth><AnalysisPage /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Box>
    </AuthProvider>
  );
}

export default App;

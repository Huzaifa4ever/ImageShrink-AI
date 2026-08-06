import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../context/AuthContext';

function FullPageSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <CircularProgress sx={{ color: '#CCFF00' }} />
    </Box>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, bootstrapping } = useAuth();
  const location = useLocation();

  if (bootstrapping) return <FullPageSpinner />;
  if (!isAuthenticated) {
    return (
      <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />
    );
  }
  return <>{children}</>;
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, bootstrapping } = useAuth();

  if (bootstrapping) return <FullPageSpinner />;
  if (isAuthenticated) return <Navigate to="/workbench" replace />;
  return <>{children}</>;
}

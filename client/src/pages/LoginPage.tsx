import { useState } from 'react';
import { Alert, Button, Link as MuiLink, Stack, TextField, Typography } from '@mui/material';
import { Login as LoginIcon } from '@mui/icons-material';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../services/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Set by RequireAuth when it bounced an unauthenticated visit.
  const from = (location.state as { from?: string } | null)?.from ?? '/workbench';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim() || !password) {
      setError('Enter your username or email and your password.');
      return;
    }

    setSubmitting(true);
    try {
      await login(identifier.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not sign you in.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="Sign in"
      title="Welcome back"
      subtitle="Sign in to reach your workbench and analysis history."
      footer={
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Don’t have an account?{' '}
          <MuiLink component={Link} to="/signup" sx={{ color: '#CCFF00', fontWeight: 600 }}>
            Create one
          </MuiLink>
        </Typography>
      }
    >
      <GoogleSignInButton redirectTo={from} text="signin_with" />

      <Stack component="form" spacing={2.5} onSubmit={handleSubmit} noValidate>
        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}

        <TextField
          label="Username or email"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          autoFocus
          fullWidth
          disabled={submitting}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          fullWidth
          disabled={submitting}
        />

        <MuiLink
          component={Link}
          to="/forgot-password"
          variant="body2"
          sx={{ color: 'text.secondary', alignSelf: 'flex-end', mt: -1 }}
        >
          Forgot your password?
        </MuiLink>

        <Button type="submit" variant="contained" size="large" disabled={submitting} startIcon={<LoginIcon />} sx={{ py: 1.3 }}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </Button>
      </Stack>
    </AuthLayout>
  );
}

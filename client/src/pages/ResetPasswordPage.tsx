import { useState } from 'react';
import { Alert, Button, Link as MuiLink, Stack, TextField, Typography } from '@mui/material';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import { authService } from '../services/authService';
import { apiErrorMessage } from '../services/api';

const MIN_LENGTH = 8;

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await authService.resetPassword(token, password);
      setDone(true);
      // Resetting signs every device out, including any session in this browser, so the only
      // sensible next step is a fresh sign-in.
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not reset your password.'));
    } finally {
      setSubmitting(false);
    }
  };

  const layout = (children: React.ReactNode) => (
    <AuthLayout
      eyebrow="Reset password"
      title="Choose a new password"
      subtitle="Pick something you have not used here before."
      footer={
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          <MuiLink component={Link} to="/login" sx={{ color: '#CCFF00', fontWeight: 600 }}>
            Back to sign in
          </MuiLink>
        </Typography>
      }
    >
      {children}
    </AuthLayout>
  );

  if (!token) {
    return layout(
      <Stack spacing={2.5}>
        <Alert severity="error">
          This link is missing its token. Open the link from your email again, or request a new one.
        </Alert>
        <Button component={Link} to="/forgot-password" variant="outlined" fullWidth>
          Request a new link
        </Button>
      </Stack>
    );
  }

  if (done) {
    return layout(
      <Stack spacing={2.5}>
        <Alert severity="success">
          Password changed. Every device has been signed out. Taking you to sign in…
        </Alert>
      </Stack>
    );
  }

  return layout(
    <form onSubmit={handleSubmit} noValidate>
      <Stack spacing={2.5}>
        {error && <Alert severity="error">{error}</Alert>}

        <TextField
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          helperText={`At least ${MIN_LENGTH} characters`}
          autoFocus
          fullWidth
          disabled={submitting}
        />

        <TextField
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          fullWidth
          disabled={submitting}
        />

        <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting}>
          {submitting ? 'Saving…' : 'Change my password'}
        </Button>
      </Stack>
    </form>
  );
}

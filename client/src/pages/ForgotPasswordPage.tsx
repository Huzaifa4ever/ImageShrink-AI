import { useState } from 'react';
import { Alert, Button, Link as MuiLink, Stack, TextField, Typography } from '@mui/material';
import { MailOutlined } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import { authService } from '../services/authService';
import { apiErrorMessage } from '../services/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Enter the email address for your account.');
      return;
    }

    setSubmitting(true);
    try {
      // The API answers the same way whether or not the account exists, so the wording here
      // must stay non-committal too. Saying "sent!" would confirm the address is registered.
      setSent(await authService.forgotPassword(email.trim()));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the reset email.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="Reset password"
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a link to choose a new one."
      footer={
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Remembered it?{' '}
          <MuiLink component={Link} to="/login" sx={{ color: '#CCFF00', fontWeight: 600 }}>
            Back to sign in
          </MuiLink>
        </Typography>
      }
    >
      {sent ? (
        <Stack spacing={2.5}>
          <Alert severity="success" icon={<MailOutlined fontSize="inherit" />}>
            {sent}
          </Alert>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            The link expires in 30 minutes and works once. If nothing arrives within a few
            minutes, check your spam folder.
          </Typography>
          <Button component={Link} to="/login" variant="outlined" fullWidth>
            Back to sign in
          </Button>
        </Stack>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              fullWidth
              disabled={submitting}
            />

            <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}

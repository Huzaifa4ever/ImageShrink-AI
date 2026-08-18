import { useState } from 'react';
import { Alert, Button, Link as MuiLink, Stack, TextField, Typography } from '@mui/material';
import { PersonAdd } from '@mui/icons-material';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../services/api';
import { MIN_PASSWORD_LENGTH, validateEmail, validatePassword, validateUsername } from '../utils/validation';

type FieldErrors = Partial<Record<'username' | 'email' | 'password' | 'confirm', string>>;

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const found: FieldErrors = {};
    const u = validateUsername(username);
    const em = validateEmail(email);
    const p = validatePassword(password);
    if (u) found.username = u;
    if (em) found.email = em;
    if (p) found.password = p;
    if (password !== confirm) found.confirm = 'Passwords do not match';

    setFields(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await signup(username.trim(), email.trim(), password);
      navigate('/workbench', { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create your account.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="Sign up"
      title="Create your account"
      subtitle="Your analyses are saved privately to your account."
      footer={
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Already have an account?{' '}
          <MuiLink component={Link} to="/login" sx={{ color: '#CCFF00', fontWeight: 600 }}>
            Sign in
          </MuiLink>
        </Typography>
      }
    >
      <GoogleSignInButton text="signup_with" />

      <Stack component="form" spacing={2.5} onSubmit={handleSubmit} noValidate>
        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}

        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={!!fields.username}
          helperText={fields.username ?? '3–32 characters'}
          autoComplete="username"
          autoFocus
          fullWidth
          disabled={submitting}
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={!!fields.email}
          helperText={fields.email}
          autoComplete="email"
          fullWidth
          disabled={submitting}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={!!fields.password}
          helperText={fields.password ?? `At least ${MIN_PASSWORD_LENGTH} characters`}
          autoComplete="new-password"
          fullWidth
          disabled={submitting}
        />
        <TextField
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={!!fields.confirm}
          helperText={fields.confirm}
          autoComplete="new-password"
          fullWidth
          disabled={submitting}
        />

        <Button type="submit" variant="contained" size="large" disabled={submitting} startIcon={<PersonAdd />} sx={{ py: 1.3 }}>
          {submitting ? 'Creating account…' : 'Create Account'}
        </Button>
      </Stack>
    </AuthLayout>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link as MuiLink, Stack, Typography } from '@mui/material';
import { Link, useSearchParams } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import { apiErrorMessage } from '../services/api';

type State = 'working' | 'done' | 'failed' | 'no-token';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { isAuthenticated, setUser } = useAuth();

  const [state, setState] = useState<State>(token ? 'working' : 'no-token');
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState<string | null>(null);

  // Tokens are single-use. React StrictMode mounts effects twice in development, which would
  // spend the token on the first run and show a failure from the second.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    authService.confirmEmail(token)
      .then((user) => {
        setState('done');
        // Keeps the signed-in user object fresh so the "confirm your email" banner disappears
        // without needing a reload.
        if (isAuthenticated) setUser(user);
      })
      .catch((err) => {
        setError(apiErrorMessage(err, 'That link could not be used.'));
        setState('failed');
      });
  }, [token, isAuthenticated, setUser]);

  const resend = async () => {
    setResent(null);
    setError(null);
    try {
      setResent(await authService.resendVerification());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send a new link.'));
    }
  };

  return (
    <AuthLayout
      eyebrow="Email"
      title={state === 'done' ? 'Email confirmed' : 'Confirm your email'}
      subtitle={
        state === 'done'
          ? 'Thanks — your address is verified.'
          : 'We are checking the link from your email.'
      }
      footer={
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          <MuiLink component={Link} to="/login" sx={{ color: '#CCFF00', fontWeight: 600 }}>
            Back to sign in
          </MuiLink>
        </Typography>
      }
    >
      <Stack spacing={2.5}>
        {state === 'working' && (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <CircularProgress size={22} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Checking your link…
            </Typography>
          </Box>
        )}

        {state === 'done' && (
          <>
            <Alert severity="success">Your email address is confirmed.</Alert>
            <Button
              component={Link}
              to={isAuthenticated ? '/workbench' : '/login'}
              variant="contained"
              fullWidth
            >
              {isAuthenticated ? 'Go to the workbench' : 'Sign in'}
            </Button>
          </>
        )}

        {state === 'no-token' && (
          <Alert severity="warning">
            This page needs the link from your email. Open that link directly.
          </Alert>
        )}

        {state === 'failed' && (
          <>
            <Alert severity="error">{error}</Alert>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Confirmation links expire, and each one works only once. If you have already
              confirmed this address, you can just sign in.
            </Typography>
          </>
        )}

        {resent && <Alert severity="success">{resent}</Alert>}

        {(state === 'failed' || state === 'no-token') && (
          <Stack spacing={1.5}>
            {isAuthenticated && (
              <Button onClick={resend} variant="contained" fullWidth>
                Send me a new link
              </Button>
            )}
            <Button component={Link} to={isAuthenticated ? '/workbench' : '/login'} variant="outlined" fullWidth>
              {isAuthenticated ? 'Back to the workbench' : 'Back to sign in'}
            </Button>
          </Stack>
        )}
      </Stack>
    </AuthLayout>
  );
}

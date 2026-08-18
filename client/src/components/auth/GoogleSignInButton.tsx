import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Divider, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessage } from '../../services/api';

/**
 * Renders Google's own sign-in button.
 *
 * It has to be Google's button, not one of ours: the flow returns a signed ID token straight
 * to the page, and Google only issues that to a button it rendered itself. We pass the token
 * to our API, which verifies the signature before trusting anything in it.
 *
 * With no VITE_GOOGLE_CLIENT_ID the component renders nothing at all. The rest of the login
 * page keeps working, so a missing key degrades to "no Google option" rather than a broken UI.
 */

const SCRIPT_ID = 'google-identity-services';
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

function loadScript(): Promise<void> {
  if (document.getElementById(SCRIPT_ID)) {
    return window.google ? Promise.resolve() : new Promise((resolve) => {
      document.getElementById(SCRIPT_ID)!.addEventListener('load', () => resolve(), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not reach Google'));
    document.head.appendChild(script);
  });
}

interface Props {
  /** Where to go after a successful sign-in. */
  redirectTo?: string;
  text?: 'signin_with' | 'signup_with' | 'continue_with';
}

export default function GoogleSignInButton({ redirectTo = '/workbench', text = 'continue_with' }: Props) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const navigate = useNavigate();
  const { signInWithGoogle } = useAuth();

  const holder = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCredential = useCallback(
    async (response: { credential?: string }) => {
      if (!response.credential) {
        setError('Google did not return a sign-in token. Please try again.');
        return;
      }
      setError(null);
      setBusy(true);
      try {
        await signInWithGoogle(response.credential);
        navigate(redirectTo, { replace: true });
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not sign you in with Google.'));
      } finally {
        setBusy(false);
      }
    },
    [navigate, redirectTo, signInWithGoogle]
  );

  useEffect(() => {
    if (!clientId || !holder.current) return;

    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredential,
        });
        window.google.accounts.id.renderButton(holder.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'rectangular',
          text,
          width: 320,
          logo_alignment: 'center',
        });
      })
      .catch(() => {
        if (!cancelled) setError('Could not load Google sign-in. Use your email and password.');
      });

    return () => { cancelled = true; };
  }, [clientId, handleCredential, text]);

  if (!clientId) return null;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box
        ref={holder}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          minHeight: 44,
          opacity: busy ? 0.6 : 1,
          pointerEvents: busy ? 'none' : 'auto',
        }}
      />

      <Divider sx={{ my: 2.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', px: 1 }}>
          or
        </Typography>
      </Divider>
    </Box>
  );
}

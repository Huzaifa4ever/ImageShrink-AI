import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Container, Typography, Button, Card, CardContent, Stack,
  TextField, Alert, CircularProgress, alpha,
} from '@mui/material';
import { CheckCircle, Close, Code, Warning } from '@mui/icons-material';
import { apiErrorMessage } from '../services/api';
import { extensionService } from '../services/extensionService';
import { useAuth } from '../context/AuthContext';
import type { DeviceRequest } from '../types';

/**
 * Approves a VS Code sign-in.
 *
 * The extension shows a code and polls; this page is where a signed-in user decides whether to
 * lend their account to it.
 *
 * The design leans hard on naming the client and warning the user, because a device flow is
 * inherently phishable — anyone can start one and send someone else the code. A page that just
 * said "Approve?" would be an invitation to hand an account to a stranger, so the client, its
 * version and its platform are all shown, and the copy tells the user to decline if they did
 * not start this themselves.
 */

type Phase = 'entering' | 'loading' | 'confirming' | 'approved' | 'denied' | 'error';

export default function ActivatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [code, setCode] = useState(() => params.get('code') ?? '');
  const [phase, setPhase] = useState<Phase>('entering');
  const [request, setRequest] = useState<DeviceRequest | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async (userCode: string) => {
    setPhase('loading');
    setError('');
    try {
      setRequest(await extensionService.pending(userCode));
      setPhase('confirming');
    } catch (e) {
      setError(apiErrorMessage(e, 'That code could not be found.'));
      setPhase('error');
    }
  }, []);

  // A code in the URL is the common path — the extension opens a pre-filled link, so the user
  // should land straight on the confirmation rather than retyping what they were just shown.
  useEffect(() => {
    const fromUrl = params.get('code');
    if (fromUrl) void lookup(fromUrl);
  }, [params, lookup]);

  const decide = async (approve: boolean) => {
    if (!request) return;
    setBusy(true);
    setError('');
    try {
      if (approve) {
        await extensionService.approve(request.userCode);
        setPhase('approved');
      } else {
        await extensionService.deny(request.userCode);
        setPhase('denied');
      }
    } catch (e) {
      setError(apiErrorMessage(e, 'That did not work. The code may have expired.'));
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="sm" sx={{ pt: { xs: 8, md: 12 }, pb: 10 }}>
        <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Device sign-in
        </Typography>
        <Typography variant="h3" sx={{ fontSize: { xs: '1.7rem', md: '2.2rem' }, mb: 1 }}>
          Connect an editor
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
          Signed in as <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{user?.username}</Box>.
        </Typography>

        <Card>
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            {error && (
              <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
                {error}
              </Alert>
            )}

            {(phase === 'entering' || phase === 'error') && (
              <Stack
                component="form"
                spacing={2.5}
                onSubmit={(e) => { e.preventDefault(); if (code.trim()) void lookup(code.trim()); }}
              >
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Enter the code shown in VS Code.
                </Typography>
                <TextField
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  slotProps={{
                    htmlInput: {
                      maxLength: 12,
                      style: {
                        fontFamily: '"JetBrains Mono", monospace',
                        letterSpacing: '0.2em',
                        fontSize: '1.2rem',
                        textAlign: 'center',
                      },
                    },
                  }}
                />
                <Button type="submit" variant="contained" size="large" disabled={!code.trim()}>
                  Continue
                </Button>
              </Stack>
            )}

            {phase === 'loading' && (
              <Stack spacing={2} sx={{ alignItems: 'center', py: 4 }}>
                <CircularProgress size={28} />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>Checking that code…</Typography>
              </Stack>
            )}

            {phase === 'confirming' && request && (
              <Stack spacing={3}>
                <Box
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 2, p: 2.5, borderRadius: 2,
                    border: '1px solid', borderColor: alpha('#3F3F46', 0.6), bgcolor: alpha('#CCFF00', 0.03),
                  }}
                >
                  <Box sx={{ width: 42, height: 42, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha('#CCFF00', 0.1), color: '#CCFF00' }}>
                    <Code />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {request.client.name || 'Unknown client'}
                      {request.client.version && (
                        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.75, fontSize: '0.85rem' }}>
                          {request.client.version}
                        </Box>
                      )}
                    </Typography>
                    <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem' }} noWrap>
                      {request.client.platform || 'platform not reported'} · code {request.userCode}
                    </Typography>
                  </Box>
                </Box>

                <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.8 }}>
                  Approving lets this editor analyse Dockerfiles on your behalf and read and write
                  your analysis history. You can sign it out at any time from{' '}
                  <Box component="span" sx={{ color: 'text.primary' }}>Settings → Connected devices</Box>.
                </Typography>

                <Alert severity="warning" icon={<Warning fontSize="inherit" />} sx={{ '& .MuiAlert-message': { fontSize: '0.82rem' } }}>
                  Only approve this if you just started a sign-in in VS Code yourself. If someone
                  sent you this code, decline — approving would give them access to your account.
                </Alert>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button
                    variant="contained" size="large" fullWidth disabled={busy}
                    startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <CheckCircle />}
                    onClick={() => void decide(true)}
                  >
                    Approve
                  </Button>
                  <Button variant="outlined" size="large" fullWidth disabled={busy} startIcon={<Close />} onClick={() => void decide(false)}>
                    Decline
                  </Button>
                </Stack>
              </Stack>
            )}

            {phase === 'approved' && (
              <Stack spacing={2} sx={{ alignItems: 'center', py: 3, textAlign: 'center' }}>
                <CheckCircle sx={{ fontSize: 48, color: '#4ADE80' }} />
                <Typography variant="h6">You're connected</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Return to VS Code — it should sign in within a few seconds. You can close this tab.
                </Typography>
                <Button variant="outlined" onClick={() => navigate('/settings')} sx={{ mt: 1 }}>
                  Manage connected devices
                </Button>
              </Stack>
            )}

            {phase === 'denied' && (
              <Stack spacing={2} sx={{ alignItems: 'center', py: 3, textAlign: 'center' }}>
                <Close sx={{ fontSize: 48, color: 'text.secondary' }} />
                <Typography variant="h6">Request declined</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Nothing was granted access. If you did not start this, no further action is needed.
                </Typography>
              </Stack>
            )}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

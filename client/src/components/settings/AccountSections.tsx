import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, IconButton,
  Stack, TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import {
  Check, Code, ContentCopy, Delete, DeleteForever, Devices, Key, Language,
  PhotoCamera, Warning,
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessage, tokenStore } from '../../services/api';
import { accountService, downscaleImage } from '../../services/accountService';
import type { ApiKey, ConnectedSession } from '../../types';

const LIME = '#CCFF00';

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2.5 }}>
      {icon}
      <Typography className="mono" sx={{ fontSize: '0.7rem', color: LIME, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
    </Stack>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ProfilePictureSection() {
  const { user, setUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const dataUrl = await downscaleImage(file);
      setUser(await accountService.setAvatar(dataUrl));
    } catch (e) {
      setError(apiErrorMessage(e, 'That picture could not be uploaded.'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      setUser(await accountService.setAvatar(null));
    } catch (e) {
      setError(apiErrorMessage(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 3, md: 4 } }}>
        <SectionHeading icon={<PhotoCamera sx={{ fontSize: '1rem', color: LIME }} />} label="Profile picture" />
        {error && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{error}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ alignItems: 'center' }}>
          <Avatar
            src={user?.avatar ?? undefined}
            sx={{ width: 80, height: 80, bgcolor: LIME, color: '#000', fontSize: '2rem', fontWeight: 800 }}
          >
            {user?.username?.charAt(0).toUpperCase()}
          </Avatar>

          <Stack spacing={1.5} sx={{ flex: 1, width: '100%' }}>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Button variant="outlined" disabled={busy} onClick={() => inputRef.current?.click()}>
                {busy ? 'Working…' : 'Upload picture'}
              </Button>
              {user?.avatar && (
                <Button color="error" disabled={busy} onClick={() => void remove()}>
                  Remove
                </Button>
              )}
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Resized to 256×256 in your browser before upload, which also strips any location
              data the original photo carried.
            </Typography>
          </Stack>
        </Stack>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </CardContent>
    </Card>
  );
}

function ConnectedDevicesSection() {
  const [sessions, setSessions] = useState<ConnectedSession[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await accountService.sessions());
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load your devices.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const revoke = async (session: ConnectedSession) => {
    setBusyId(session.id);
    setError('');
    try {
      const { signedOutSelf } = await accountService.revokeSession(session.id);
      if (signedOutSelf) {
        tokenStore.clear();
        window.location.assign('/login');
        return;
      }
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not sign that device out.'));
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    setBusyId('others');
    setError('');
    try {
      await accountService.revokeOtherSessions();
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not sign the other devices out.'));
    } finally {
      setBusyId(null);
    }
  };

  const others = (sessions ?? []).filter((s) => !s.isCurrent);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 3, md: 4 } }}>
        <SectionHeading icon={<Devices sx={{ fontSize: '1rem', color: LIME }} />} label="Connected devices" />
        {error && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{error}</Alert>}

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, lineHeight: 1.7 }}>
          Every browser and editor signed into this account. Signing one out takes effect on its
          next request — a VS Code window will ask you to sign in again.
        </Typography>

        {sessions === null ? (
          <Stack sx={{ alignItems: 'center', py: 3 }}><CircularProgress size={24} sx={{ color: LIME }} /></Stack>
        ) : sessions.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>No active sessions.</Typography>
        ) : (
          <Stack spacing={0}>
            {sessions.map((session, index) => (
              <Stack
                key={session.id}
                direction="row"
                spacing={2}
                sx={{
                  alignItems: 'center', py: 2,
                  borderTop: index === 0 ? 'none' : '1px solid',
                  borderColor: alpha('#3F3F46', 0.3),
                }}
              >
                <Box sx={{ color: session.client.kind === 'vscode' ? LIME : 'text.secondary' }}>
                  {session.client.kind === 'vscode' ? <Code /> : <Language />}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {session.client.name || 'Unknown client'}
                      {session.client.version && (
                        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.75, fontSize: '0.8rem' }}>
                          {session.client.version}
                        </Box>
                      )}
                    </Typography>
                    {session.isCurrent && (
                      <Chip label="this device" size="small" sx={{ bgcolor: alpha(LIME, 0.12), color: LIME, height: 20 }} />
                    )}
                  </Stack>
                  <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', display: 'block' }} noWrap>
                    {session.client.platform || 'platform not reported'}
                    {session.ip ? ` · ${session.ip}` : ''} · last seen {relativeTime(session.lastSeenAt)}
                  </Typography>
                </Box>

                <Tooltip title={session.isCurrent ? 'Sign out of this browser' : 'Sign this device out'}>
                  <IconButton
                    size="small"
                    disabled={busyId !== null}
                    onClick={() => void revoke(session)}
                    sx={{ color: '#FF6B6B' }}
                  >
                    {busyId === session.id ? <CircularProgress size={16} color="inherit" /> : <Delete fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        )}

        {others.length > 0 && (
          <Box sx={{ mt: 2.5 }}>
            <Button
              variant="outlined" size="small" disabled={busyId !== null}
              onClick={() => void revokeOthers()}
            >
              {busyId === 'others' ? 'Signing out…' : `Sign out ${others.length} other device(s)`}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<(ApiKey & { key: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setKeys(await accountService.apiKeys());
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load your API keys.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      setCreated(await accountService.createApiKey(name.trim() || 'Untitled key'));
      setName('');
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not create a key.'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await accountService.revokeApiKey(id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not revoke that key.'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 3, md: 4 } }}>
        <SectionHeading icon={<Key sx={{ fontSize: '1rem', color: LIME }} />} label="API keys" />
        {error && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{error}</Alert>}

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, lineHeight: 1.7 }}>
          For CI, scripts, and anywhere a browser cannot be opened. Send one as{' '}
          <Box component="code" sx={{ color: LIME }}>Authorization: Bearer isk_…</Box>. Keys cannot
          approve new devices or delete your account — those need a signed-in browser.
        </Typography>

        {created && (
          <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              Copy this key now — it cannot be shown again.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box
                component="code"
                sx={{
                  flex: 1, p: 1, borderRadius: 1, bgcolor: alpha('#000', 0.4),
                  fontSize: '0.75rem', wordBreak: 'break-all',
                }}
              >
                {created.key}
              </Box>
              <Button
                size="small"
                startIcon={copied ? <Check /> : <ContentCopy />}
                onClick={() => void copy()}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </Stack>
            <Button size="small" sx={{ mt: 1 }} onClick={() => setCreated(null)}>Done</Button>
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 3 }}>
          <TextField
            size="small" label="Key name" placeholder="CI pipeline"
            value={name} onChange={(e) => setName(e.target.value)}
            disabled={busy} sx={{ flex: 1 }}
          />
          <Button variant="contained" disabled={busy} onClick={() => void create()}>
            {busy ? 'Working…' : 'Create key'}
          </Button>
        </Stack>

        {keys === null ? (
          <Stack sx={{ alignItems: 'center', py: 2 }}><CircularProgress size={22} sx={{ color: LIME }} /></Stack>
        ) : keys.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>No API keys yet.</Typography>
        ) : (
          <Stack spacing={0}>
            {keys.map((key, index) => (
              <Stack
                key={key.id}
                direction="row" spacing={2}
                sx={{
                  alignItems: 'center', py: 1.75,
                  borderTop: index === 0 ? 'none' : '1px solid', borderColor: alpha('#3F3F46', 0.3),
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: '0.88rem' }}>{key.name}</Typography>
                  <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem' }}>
                    {key.display}… · created {relativeTime(key.createdAt)} · last used {relativeTime(key.lastUsedAt)}
                  </Typography>
                </Box>
                <IconButton size="small" disabled={busy} onClick={() => void revoke(key.id)} sx={{ color: '#FF6B6B' }}>
                  <Delete fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function DangerZoneSection() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const nameMatches = confirmName.trim().toLowerCase() === (user?.username ?? '').toLowerCase();

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await accountService.deleteAccount(password, confirmName.trim());
      await logout();
      window.location.assign('/');
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not delete your account.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card sx={{ mb: 3, borderColor: alpha('#FF6B6B', 0.3) }}>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <SectionHeading
            icon={<Warning sx={{ fontSize: '1rem', color: '#FF6B6B' }} />}
            label="Delete account"
          />
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, lineHeight: 1.7 }}>
            Permanently deletes your account, every analysis in your history, all API keys and all
            connected devices. This cannot be undone and there is no recovery period.
          </Typography>
          <Button variant="outlined" color="error" startIcon={<DeleteForever />} onClick={() => setOpen(true)}>
            Delete my account
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2.5, fontSize: '0.9rem' }}>
            This removes your account and every analysis you have ever run. It cannot be undone.
          </DialogContentText>

          {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

          <Stack spacing={2}>
            <TextField
              label="Your password" type="password" fullWidth autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
            />
            <TextField
              label={`Type "${user?.username}" to confirm`} fullWidth
              value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={busy}
              error={confirmName.length > 0 && !nameMatches}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button
            variant="contained" color="error"
            disabled={busy || !password || !nameMatches}
            onClick={() => void remove()}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function AccountSections() {
  return (
    <>
      <ProfilePictureSection />
      <Divider sx={{ my: 4 }} />
      <ConnectedDevicesSection />
      <ApiKeysSection />
      <Divider sx={{ my: 4 }} />
      <DangerZoneSection />
    </>
  );
}

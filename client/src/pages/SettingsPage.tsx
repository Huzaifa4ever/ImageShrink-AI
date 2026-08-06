import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Container, Divider,
  Stack, TextField, Typography, alpha,
} from '@mui/material';
import { AccountCircle, Lock, Save } from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../services/api';
import { authService } from '../services/authService';
import { MIN_PASSWORD_LENGTH, validateEmail, validatePassword, validateUsername } from '../utils/validation';
import { AccountSections } from '../components/settings/AccountSections';

function Feedback({ ok, message }: { ok: boolean; message: string }) {
  return (
    <Alert severity={ok ? 'success' : 'error'} sx={{ borderRadius: 2, mb: 2.5 }}>
      {message}
    </Alert>
  );
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', mb: 2.5 }} spacing={1}>
      {icon}
      <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
    </Stack>
  );
}

export default function SettingsPage() {
  const { user, setUser } = useAuth();

  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileFields, setProfileFields] = useState<{ username?: string; email?: string }>({});
  const [profileResult, setProfileResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFields, setPasswordFields] = useState<Record<string, string>>({});
  const [passwordResult, setPasswordResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setEmail(user.email);
    }
  }, [user]);

  const profileUnchanged = username.trim() === user?.username && email.trim() === user?.email;

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileResult(null);

    const found: { username?: string; email?: string } = {};
    const u = validateUsername(username);
    const em = validateEmail(email);
    if (u) found.username = u;
    if (em) found.email = em;
    setProfileFields(found);
    if (Object.keys(found).length > 0) return;

    const updates: { username?: string; email?: string } = {};
    if (username.trim() !== user?.username) updates.username = username.trim();
    if (email.trim() !== user?.email) updates.email = email.trim();
    if (Object.keys(updates).length === 0) {
      setProfileResult({ ok: false, message: 'Nothing to update — change a field first.' });
      return;
    }

    setSavingProfile(true);
    try {
      const updated = await authService.updateProfile(updates);
      setUser(updated);
      setProfileResult({ ok: true, message: 'Profile updated.' });
    } catch (err) {
      setProfileResult({ ok: false, message: apiErrorMessage(err, 'Could not update your profile.') });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordResult(null);

    const found: Record<string, string> = {};
    if (!currentPassword) found.currentPassword = 'Enter your current password';
    const p = validatePassword(newPassword);
    if (p) found.newPassword = p;
    else if (newPassword === currentPassword) found.newPassword = 'New password must be different';
    if (newPassword !== confirmPassword) found.confirmPassword = 'Passwords do not match';

    setPasswordFields(found);
    if (Object.keys(found).length > 0) return;

    setSavingPassword(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setPasswordResult({ ok: true, message: 'Password changed. It will be required next time you sign in.' });
    } catch (err) {
      setPasswordResult({ ok: false, message: apiErrorMessage(err, 'Could not change your password.') });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="sm" sx={{ pt: 8, pb: 12 }}>
        <Box sx={{ mb: 5 }}>
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Settings
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 700, mb: 1, fontSize: { xs: '1.6rem', md: '2rem' } }}>
            Your account
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Update how you sign in. Your analysis history stays with your account.
          </Typography>
        </Box>

        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
            <SectionHeading icon={<AccountCircle sx={{ color: '#CCFF00', fontSize: '1rem' }} />} label="Profile" />

            {profileResult && <Feedback ok={profileResult.ok} message={profileResult.message} />}

            <Stack component="form" spacing={2.5} onSubmit={handleProfileSave} noValidate>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={!!profileFields.username}
                helperText={profileFields.username ?? 'Shown in the top-right corner'}
                fullWidth
                disabled={savingProfile}
              />
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={!!profileFields.email}
                helperText={profileFields.email ?? 'Used to sign in'}
                fullWidth
                disabled={savingProfile}
              />
              <Box>
                <Button type="submit" variant="contained" startIcon={<Save />} disabled={savingProfile || profileUnchanged}>
                  {savingProfile ? 'Saving…' : 'Save changes'}
                </Button>
              </Box>
            </Stack>

            {user && (
              <>
                <Divider sx={{ my: 3, borderColor: alpha('#3F3F46', 0.4) }} />
                <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                  <Typography className="mono" variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
                    Member since {new Date(user.createdAt).toLocaleDateString()}
                  </Typography>
                  <Chip
                    label={`id ${user.id.slice(-6)}`}
                    size="small"
                    sx={{ fontSize: '0.55rem', height: 18, bgcolor: alpha('#A1A1AA', 0.12), color: '#A1A1AA' }}
                  />
                </Stack>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
            <SectionHeading icon={<Lock sx={{ color: '#CCFF00', fontSize: '1rem' }} />} label="Password" />

            {passwordResult && <Feedback ok={passwordResult.ok} message={passwordResult.message} />}

            <Stack component="form" spacing={2.5} onSubmit={handlePasswordSave} noValidate>
              <TextField
                label="Current password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                error={!!passwordFields.currentPassword}
                helperText={passwordFields.currentPassword}
                autoComplete="current-password"
                fullWidth
                disabled={savingPassword}
              />
              <TextField
                label="New password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                error={!!passwordFields.newPassword}
                helperText={passwordFields.newPassword ?? `At least ${MIN_PASSWORD_LENGTH} characters`}
                autoComplete="new-password"
                fullWidth
                disabled={savingPassword}
              />
              <TextField
                label="Confirm new password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                error={!!passwordFields.confirmPassword}
                helperText={passwordFields.confirmPassword}
                autoComplete="new-password"
                fullWidth
                disabled={savingPassword}
              />
              <Box>
                <Button type="submit" variant="contained" startIcon={<Lock />} disabled={savingPassword}>
                  {savingPassword ? 'Updating…' : 'Change password'}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Divider sx={{ my: 4 }} />

        <AccountSections />
      </Container>
    </Box>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Box, Container, Typography, Button, Stack, Card, CardContent, Alert, alpha } from '@mui/material';
import Grid from '@mui/material/Grid';
import { ArrowForward, ContentCopy, Check, Terminal } from '@mui/icons-material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import {
  EditorMockup,
  ExtensionFeatures,
  INSTALL_ANCHOR,
} from '../components/landing/ExtensionShowcase';
import { useAuth } from '../context/AuthContext';

const LIME = '#CCFF00';

const REPO_URL = 'https://github.com/Huzaifa4ever/ImageShrink-AI.git';

const INSTALL_COMMANDS = `git clone ${REPO_URL}
cd ImageShrink-AI/vscode-extension
npm install
npm run install-local`;

const MANUAL_COMMANDS = `npm run vsix
code --install-extension imageshrink-ai.vsix --force`;

const STEPS = [
  {
    n: '01',
    title: 'Build and install',
    desc: 'Clone the repository and run npm run install-local. That packages the extension and installs it into VS Code in one step.',
  },
  {
    n: '02',
    title: 'Reload VS Code',
    desc: 'Run "Developer: Reload Window" from the command palette, then open any Dockerfile. Findings appear immediately — the rule engine runs on your machine, so this works offline and needs no account.',
  },
  {
    n: '03',
    title: 'Sign in for AI',
    desc: 'Run ImageShrink: Sign In. A code appears in VS Code; approve it here in your browser and the editor connects.',
  },
  {
    n: '04',
    title: 'Analyze',
    desc: 'Press Ctrl+Alt+D for a multi-stage rewrite, size estimate and CVE scan. Every analysis syncs to this dashboard.',
  },
];

function CommandBlock({ commands, label }: { commands: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
    }
  };

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: '1px solid',
        borderColor: alpha('#3F3F46', 0.6),
        bgcolor: alpha('#18181B', 0.8),
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 1, borderBottom: '1px solid', borderColor: alpha('#3F3F46', 0.4),
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Terminal sx={{ fontSize: '0.9rem', color: 'text.secondary' }} />
          <Typography className="mono" sx={{ fontSize: '0.65rem', color: 'text.secondary', letterSpacing: '0.06em' }}>
            {label ?? 'TERMINAL'}
          </Typography>
        </Stack>
        <Button
          size="small"
          onClick={() => void copy()}
          startIcon={copied ? <Check sx={{ fontSize: '0.85rem !important' }} /> : <ContentCopy sx={{ fontSize: '0.85rem !important' }} />}
          sx={{ fontSize: '0.7rem', color: copied ? '#4ADE80' : 'text.secondary', minWidth: 0 }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0, px: 2, py: 1.75, overflowX: 'auto',
          fontSize: { xs: '0.75rem', sm: '0.8rem' }, lineHeight: 1.9, color: '#E4E4E7',
        }}
      >
        <code>{commands}</code>
      </Box>
    </Box>
  );
}

export default function ExtensionPage() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const installRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (location.hash !== '#install') return;

    const timer = window.setTimeout(() => {
      installRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [location.hash, location.key]);

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="lg" sx={{ pt: { xs: 8, md: 12 }, pb: { xs: 6, md: 8 } }}>
        <Grid container spacing={{ xs: 5, md: 8 }} sx={{ alignItems: 'center' }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography className="mono" sx={{ fontSize: '0.7rem', color: LIME, mb: 2, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Visual Studio Code
            </Typography>
            <Typography variant="h1" sx={{ fontSize: { xs: '2.2rem', sm: '2.8rem', md: '3.2rem' }, lineHeight: 1.08, mb: 3 }}>
              Docker optimization,
              <br />
              <Box component="span" className="accent-text">as you type.</Box>
            </Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '1.02rem', lineHeight: 1.8, mb: 4, maxWidth: 520 }}>
              24 built-in rules that run locally on every keystroke, one-click fixes for most of
              them, and an AI rewrite when you want the whole file restructured into a proper
              multi-stage build.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 3 }}>
              <Button
                variant="contained" size="large"
                component={RouterLink} to={INSTALL_ANCHOR}
                sx={{ px: 3.5, py: 1.4 }}
              >
                Install the Extension
              </Button>
              <Button
                variant="outlined" size="large" component={RouterLink}
                to={isAuthenticated ? '/workbench' : '/signup'}
                endIcon={<ArrowForward />}
                sx={{ px: 3.5, py: 1.4 }}
              >
                {isAuthenticated ? 'Open Workbench' : 'Get Started'}
              </Button>
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.7 }}>
              Built from source and installed with one command — it is not on the Visual Studio
              Marketplace, so searching the Extensions view will not find it.
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <EditorMockup />
          </Grid>
        </Grid>
      </Container>

      <ExtensionFeatures />

      <Box
        ref={installRef}
        id="install"
        sx={{
          borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3),
          py: { xs: 8, md: 12 },
          scrollMarginTop: '64px',
        }}
      >
        <Container maxWidth="md">
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: LIME, mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Install
          </Typography>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2.2rem' }, mb: 2 }}>
            One command, from source.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4, lineHeight: 1.8, maxWidth: 640 }}>
            ImageShrink is installed from this repository rather than the Marketplace. You need{' '}
            <Box component="strong" sx={{ color: 'text.primary' }}>Node.js 20+</Box>, VS Code 1.95 or
            newer, and the{' '}
            <Box component="code" sx={{ color: LIME }}>code</Box> command on your PATH.
          </Typography>

          <Box sx={{ mb: 3 }}>
            <CommandBlock commands={INSTALL_COMMANDS} label="INSTALL" />
          </Box>

          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 5, lineHeight: 1.8 }}>
            Then run <Box component="strong" sx={{ color: 'text.primary' }}>Developer: Reload Window</Box>{' '}
            from the command palette and open a Dockerfile.
          </Typography>

          <Typography variant="h6" sx={{ fontSize: '1rem', mb: 1.5 }}>
            If the <Box component="code" sx={{ color: LIME, fontSize: '0.9rem' }}>code</Box> command isn't available
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5, lineHeight: 1.8 }}>
            Build the package yourself, then install it through the UI: open the Extensions view,
            click the <Box component="strong" sx={{ color: 'text.primary' }}>…</Box> menu and choose{' '}
            <Box component="strong" sx={{ color: 'text.primary' }}>Install from VSIX…</Box>, then pick the
            generated file.
          </Typography>
          <Box sx={{ mb: 4 }}>
            <CommandBlock commands={MANUAL_COMMANDS} label="MANUAL" />
          </Box>

          <Alert severity="info" sx={{ mb: 2 }}>
            To hack on the extension instead, open the <Box component="code">vscode-extension</Box>{' '}
            folder in VS Code and press <Box component="strong">F5</Box>. That launches an Extension
            Development Host with the extension loaded, and reloads it as you edit.
          </Alert>

          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.8 }}>
            Updating later: pull the repository and re-run{' '}
            <Box component="code" sx={{ color: LIME }}>npm run install-local</Box>. The{' '}
            <Box component="code">--force</Box> flag it passes replaces the installed copy in place.
          </Typography>
        </Container>
      </Box>

      <Box sx={{ borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3), py: { xs: 8, md: 12 } }}>
        <Container maxWidth="md">
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: LIME, mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Getting started
          </Typography>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2.2rem' }, mb: 5 }}>
            Four steps, two of them optional.
          </Typography>

          <Stack spacing={0}>
            {STEPS.map((step, i) => (
              <Box
                key={step.n}
                sx={{
                  display: 'flex', gap: 3, py: 3.5,
                  borderBottom: i < STEPS.length - 1 ? '1px solid' : 'none',
                  borderColor: alpha('#3F3F46', 0.3),
                }}
              >
                <Typography className="mono" sx={{ fontSize: '1.6rem', fontWeight: 700, color: alpha(LIME, 0.25), minWidth: 52 }}>
                  {step.n}
                </Typography>
                <Box>
                  <Typography variant="h6" sx={{ mb: 0.5, fontSize: '1rem' }}>{step.title}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.75 }}>{step.desc}</Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </Container>
      </Box>

      <Box sx={{ borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3), py: { xs: 8, md: 12 } }}>
        <Container maxWidth="md">
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: LIME, mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Privacy
          </Typography>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2.2rem' }, mb: 4 }}>
            What leaves your machine, and when.
          </Typography>

          <Grid container spacing={2.5}>
            {[
              {
                title: 'Linting sends nothing',
                body: 'The rule engine is bundled with the extension. Findings, quick fixes, hovers and IntelliSense all run locally, with no network access at all.',
              },
              {
                title: 'AI analysis is explicit',
                body: 'Your Dockerfile is sent only when you run the Analyze command — never automatically, never as you type. Your .dockerignore and dependency manifest go with it, to make suggestions specific, and you can turn that off.',
              },
              {
                title: 'A hard offline switch',
                body: 'Turn on "Use Local Rules Only" and the extension makes no network requests whatsoever, including sign-in. It overrides every other setting.',
              },
              {
                title: 'Tokens in the keychain',
                body: "Access tokens are stored through VS Code's SecretStorage, which is backed by your OS keychain — never in a settings file, never in plain text on disk.",
              },
            ].map((item) => (
              <Grid key={item.title} size={{ xs: 12, sm: 6 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ fontSize: '0.95rem', mb: 1 }}>{item.title}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.75 }}>
                      {item.body}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 4, fontStyle: 'italic' }}>
            Size figures throughout the extension are estimates derived from typical image sizes,
            not measurements of your build. They are labelled as estimates wherever they appear.
          </Typography>
        </Container>
      </Box>

      {/* ── CTA ──────────────────────────────────────────── */}
      <Box sx={{ borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3), py: { xs: 8, md: 12 } }}>
        <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
          <Typography variant="h3" sx={{ mb: 2, fontSize: { xs: '1.6rem', md: '2.2rem' } }}>
            Ship leaner containers.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
            Free, open source, and no account needed for linting.
          </Typography>
          <Button
            variant="contained" size="large"
            component={RouterLink} to={INSTALL_ANCHOR}
            sx={{ px: 5, py: 1.5 }}
          >
            Install the Extension
          </Button>
        </Container>
      </Box>
    </Box>
  );
}

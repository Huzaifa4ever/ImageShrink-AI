import { useEffect, useRef, useState } from 'react';
import { Box, Container, Typography, Button, Stack, Card, CardContent, Alert, alpha } from '@mui/material';
import Grid from '@mui/material/Grid';
import { ArrowForward, ContentCopy, Check, Terminal } from '@mui/icons-material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import {
  EditorMockup,
  ExtensionFeatures,
  EXTENSION_ID,
  INSTALL_ANCHOR,
  MARKETPLACE_URL,
} from '../components/landing/ExtensionShowcase';
import { useAuth } from '../context/AuthContext';

const LIME = '#CCFF00';

const QUICK_INSTALL = `ext install ${EXTENSION_ID}`;

const CLI_INSTALL = `code --install-extension ${EXTENSION_ID}`;

const SOURCE_COMMANDS = `git clone https://github.com/Huzaifa4ever/ImageShrink-AI.git
cd ImageShrink-AI/vscode-extension
npm install
npm run install-local`;

const STEPS = [
  {
    n: '01',
    title: 'Install',
    desc: 'Search for "ImageShrink" in the Extensions view and click Install. No account, no configuration.',
  },
  {
    n: '02',
    title: 'Open a Dockerfile',
    desc: 'Findings appear immediately. The rule engine is bundled into the extension, so it works offline and adds no latency to typing.',
  },
  {
    n: '03',
    title: 'Fix with one click',
    desc: 'Click the light bulb on any finding, or use Fix All to apply every safe change at once.',
  },
  {
    n: '04',
    title: 'Go deeper',
    desc: 'Press Ctrl+Alt+D for a full report: size before and after, a generated Dockerfile you can diff, and a CVE scan if you have Trivy installed.',
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
                href={MARKETPLACE_URL} target="_blank" rel="noopener noreferrer"
                sx={{ px: 3.5, py: 1.4 }}
              >
                Install from Marketplace
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
              On the Visual Studio Marketplace - search{' '}
              <Box component="strong" sx={{ color: 'text.primary' }}>ImageShrink</Box> in the
              Extensions view. Free, and it works without an account.{' '}
              <Box component={RouterLink} to={INSTALL_ANCHOR} sx={{ color: LIME }}>
                Other ways to install
              </Box>
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
            Search, click, done.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4, lineHeight: 1.8, maxWidth: 640 }}>
            Open the Extensions view in VS Code (<Box component="strong" sx={{ color: 'text.primary' }}>Ctrl+Shift+X</Box>),
            search for <Box component="strong" sx={{ color: 'text.primary' }}>ImageShrink</Box>, and
            click Install. Requires VS Code 1.95 or newer.
          </Typography>

          <Stack direction="row" spacing={1.5} sx={{ mb: 4, flexWrap: 'wrap', gap: 1 }}>
            <Button
              variant="contained" size="large"
              href={MARKETPLACE_URL} target="_blank" rel="noopener noreferrer"
              sx={{ px: 3.5, py: 1.4 }}
            >
              View on Marketplace
            </Button>
          </Stack>

          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5, lineHeight: 1.8 }}>
            Or paste this into Quick Open (<Box component="strong" sx={{ color: 'text.primary' }}>Ctrl+P</Box>):
          </Typography>
          <Box sx={{ mb: 3 }}>
            <CommandBlock commands={QUICK_INSTALL} label="VS CODE QUICK OPEN" />
          </Box>

          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5, lineHeight: 1.8 }}>
            Or from a terminal:
          </Typography>
          <Box sx={{ mb: 5 }}>
            <CommandBlock commands={CLI_INSTALL} label="TERMINAL" />
          </Box>

          <Typography variant="h6" sx={{ fontSize: '1rem', mb: 1.5 }}>
            Optional: enable CVE scanning
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4, lineHeight: 1.8 }}>
            Vulnerability scanning uses{' '}
            <Box component="a" href="https://github.com/aquasecurity/trivy#installation"
              target="_blank" rel="noopener noreferrer" sx={{ color: LIME }}>Trivy</Box>, a single
            binary you install separately. Everything else works without it, and the extension says
            plainly when Trivy is missing rather than reporting an unscanned image as clean.
          </Typography>

          <Typography variant="h6" sx={{ fontSize: '1rem', mb: 1.5 }}>
            Building from source
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5, lineHeight: 1.8 }}>
            To run the latest development version, or to contribute. Requires Node.js 20+ and the{' '}
            <Box component="code" sx={{ color: LIME }}>code</Box> command on your PATH.
          </Typography>
          <Box sx={{ mb: 3 }}>
            <CommandBlock commands={SOURCE_COMMANDS} label="FROM SOURCE" />
          </Box>

          <Alert severity="info">
            To hack on it, open the <Box component="code">vscode-extension</Box> folder in VS Code
            and press <Box component="strong">F5</Box>. That launches an Extension Development Host
            with the extension loaded, and reloads it as you edit.
          </Alert>
        </Container>
      </Box>

      <Box sx={{ borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3), py: { xs: 8, md: 12 } }}>
        <Container maxWidth="md">
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: LIME, mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Getting started
          </Typography>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2.2rem' }, mb: 5 }}>
            From install to first fix.
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
                body: 'There is nothing to turn off - the extension has no network code. Trivy and Docker are the only things it ever runs, both already on your machine, and both optional.',
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
            Free on the Visual Studio Marketplace. No account, no sign-in, no servers.
          </Typography>
          <Button
            variant="contained" size="large"
            href={MARKETPLACE_URL} target="_blank" rel="noopener noreferrer"
            sx={{ px: 5, py: 1.5 }}
          >
            Install from Marketplace
          </Button>
        </Container>
      </Box>
    </Box>
  );
}

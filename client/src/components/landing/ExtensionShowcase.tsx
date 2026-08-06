import { Box, Container, Typography, Button, Card, CardContent, Stack, alpha } from '@mui/material';
import Grid from '@mui/material/Grid';
import { ArrowForward, Bolt, Insights, Shield, Speed } from '@mui/icons-material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

const LIME = '#CCFF00';

export const INSTALL_ANCHOR = '/extension#install';

interface CodeLine {
  text: string;
  flagged?: boolean;
}

const MOCK_LINES: CodeLine[] = [
  { text: 'FROM node', flagged: true },
  { text: 'WORKDIR /app' },
  { text: 'COPY . .', flagged: true },
  { text: 'RUN npm install', flagged: true },
  { text: 'EXPOSE 3000' },
  { text: 'CMD ["node", "server.js"]' },
];

export function EditorMockup() {
  return (
    <Box
      className="editor-mock"
      sx={{
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: alpha('#3F3F46', 0.7),
        bgcolor: '#0D0D10',
        boxShadow: `0 30px 80px ${alpha('#000', 0.6)}, 0 0 60px ${alpha(LIME, 0.05)}`,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: { xs: '0.7rem', sm: '0.78rem' },
      }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25,
          borderBottom: '1px solid', borderColor: alpha('#3F3F46', 0.5),
          bgcolor: alpha('#18181B', 0.8),
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.6 }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((color) => (
            <Box key={color} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, opacity: 0.75 }} />
          ))}
        </Box>
        <Typography sx={{ ml: 1.5, fontSize: '0.7rem', color: 'text.secondary', fontFamily: 'inherit' }}>
          Dockerfile — my-api
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', minHeight: { xs: 210, sm: 250 } }}>
        <Box
          sx={{
            width: 40, flexShrink: 0, py: 1.5,
            borderRight: '1px solid', borderColor: alpha('#3F3F46', 0.4),
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.75,
          }}
        >
          {[0, 1].map((i) => (
            <Box key={i} sx={{ width: 16, height: 16, borderRadius: '3px', bgcolor: alpha('#A1A1AA', 0.25) }} />
          ))}
          <Stack spacing={0.35} className="mock-pulse" sx={{ alignItems: 'center', py: 0.25 }}>
            {[16, 11, 6].map((width) => (
              <Box key={width} sx={{ width, height: 2.5, borderRadius: 1, bgcolor: LIME }} />
            ))}
          </Stack>
        </Box>

        <Box sx={{ flex: 1, p: { xs: 1.5, sm: 2 }, position: 'relative', minWidth: 0 }}>
          {MOCK_LINES.map((line, index) => (
            <Box key={line.text} sx={{ display: 'flex', gap: 1.5, lineHeight: 2 }}>
              <Box component="span" sx={{ color: alpha('#A1A1AA', 0.4), userSelect: 'none', minWidth: 14, textAlign: 'right' }}>
                {index + 1}
              </Box>
              <Box
                component="span"
                className={line.flagged ? 'mock-squiggle' : undefined}
                sx={{
                  color: line.flagged ? '#E4E4E7' : alpha('#A1A1AA', 0.85),
                  whiteSpace: 'pre',
                  animationDelay: `${index * 0.25}s`,
                }}
              >
                {line.text}
              </Box>
            </Box>
          ))}

          <Box
            className="mock-tooltip"
            sx={{
              position: 'absolute',
              top: { xs: 44, sm: 52 },
              left: { xs: 24, sm: 90 },
              right: { xs: 12, sm: 'auto' },
              maxWidth: { sm: 300 },
              p: 1.5,
              borderRadius: 2,
              border: '1px solid',
              borderColor: alpha(LIME, 0.35),
              bgcolor: '#18181B',
              boxShadow: `0 12px 40px ${alpha('#000', 0.7)}`,
            }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.75 }}>
              <Bolt sx={{ fontSize: '0.85rem', color: LIME }} />
              <Typography sx={{ fontSize: '0.62rem', color: LIME, fontFamily: 'inherit', letterSpacing: '0.06em' }}>
                RECOMMENDED
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: '0.72rem', color: '#FAFAFA', fontFamily: 'inherit', mb: 0.5 }}>
              FROM node:22-alpine
            </Typography>
            <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', fontFamily: 'inherit', lineHeight: 1.6 }}>
              ~940 MB smaller · 85% drop-in
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 0.75,
          borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.4),
          bgcolor: alpha('#18181B', 0.6), fontSize: '0.62rem', color: 'text.secondary',
        }}
      >
        <Box component="span" sx={{ color: LIME }}>ImageShrink</Box>
        <Box component="span">3 suggestions</Box>
        <Box component="span" sx={{ ml: 'auto' }}>Optimization 42/100</Box>
      </Box>
    </Box>
  );
}

const HERO_POINTS = [
  'Analyze your Dockerfile in real time',
  'AI-powered optimization suggestions',
  'Reduce image size and build time',
  'Eliminate vulnerabilities before you ship',
  'Generate production-ready multi-stage Dockerfiles',
  'One-click Dockerfile optimization',
];

export function VSCodeHero() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        borderTop: '1px solid',
        borderColor: alpha('#3F3F46', 0.3),
        py: { xs: 8, md: 14 },
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Container maxWidth="lg">
        <Grid container spacing={{ xs: 6, md: 8 }} sx={{ alignItems: 'center' }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography
              className="mono"
              sx={{ fontSize: '0.7rem', color: LIME, mb: 2, letterSpacing: '0.12em', textTransform: 'uppercase' }}
            >
              VS Code Extension
            </Typography>

            <Typography variant="h2" sx={{ fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' }, lineHeight: 1.1, mb: 3 }}>
              Build smaller Docker images
              <br />
              without leaving{' '}
              <Box component="span" className="accent-text">VS Code.</Box>
            </Typography>

            <Stack spacing={1.25} sx={{ mb: 4 }}>
              {HERO_POINTS.map((point) => (
                <Stack key={point} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                  <Box component="span" sx={{ color: LIME, fontSize: '0.9rem', lineHeight: 1.7, flexShrink: 0 }}>
                    ✔
                  </Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
                    {point}
                  </Typography>
                </Stack>
              ))}
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                variant="contained"
                size="large"
                component={RouterLink}
                to={INSTALL_ANCHOR}
                sx={{ px: 3.5, py: 1.4 }}
              >
                Install the Extension
              </Button>
              <Button
                variant="outlined"
                size="large"
                component={RouterLink}
                to="/extension"
                sx={{ px: 3.5, py: 1.4 }}
              >
                Learn More
              </Button>
              <Button
                size="large"
                endIcon={<ArrowForward />}
                onClick={() => navigate('/signup')}
                sx={{ px: 2, color: 'text.secondary', '&:hover': { color: LIME } }}
              >
                Get Started
              </Button>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <EditorMockup />
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

interface FeatureCard {
  icon: ReactNode;
  title: string;
  accent: string;
  points: string[];
}

const FEATURE_CARDS: FeatureCard[] = [
  {
    icon: <Insights />,
    title: 'Real-Time Dockerfile Analysis',
    accent: LIME,
    points: [
      'Detect bad Docker practices',
      'Detect oversized base images',
      'Detect unnecessary COPY instructions',
      'Detect a missing .dockerignore',
    ],
  },
  {
    icon: <Bolt />,
    title: 'AI Optimization Suggestions',
    accent: '#7DD3FC',
    points: [
      'Suggest Alpine and slim images',
      'Suggest distroless final stages',
      'Suggest multi-stage builds',
      'Suggest package cleanup and npm ci',
      'Production dependencies only',
    ],
  },
  {
    icon: <Shield />,
    title: 'Security Analysis',
    accent: '#FF6B6B',
    points: [
      'Detect CVEs in base images',
      'Flag outdated packages',
      'Flag insecure and unpinned images',
      'Secrets detection in ENV and ARG',
      'Catch containers running as root',
    ],
  },
  {
    icon: <Speed />,
    title: 'Performance',
    accent: '#FBBF24',
    points: [
      'Faster builds through better cache use',
      'Smaller, fewer layers',
      'Layer optimization',
      'Catch cache-busting instruction order',
    ],
  },
];

export function ExtensionFeatures() {
  return (
    <Box sx={{ borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3), py: { xs: 8, md: 12 } }}>
      <Container maxWidth="lg">
        <Typography
          className="mono"
          sx={{ fontSize: '0.7rem', color: LIME, mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}
        >
          In your editor
        </Typography>
        <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2.2rem' }, mb: 1.5 }}>
          Develop faster with the ImageShrink VS Code extension.
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 6, maxWidth: 620, lineHeight: 1.8 }}>
          Linting runs on your machine, so it works offline and costs nothing. AI analysis runs
          only when you ask for it.
        </Typography>

        <Grid container spacing={2.5}>
          {FEATURE_CARDS.map((card) => (
            <Grid key={card.title} size={{ xs: 12, sm: 6 }}>
              <Card
                sx={{
                  height: '100%',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    borderColor: alpha(card.accent, 0.4),
                    boxShadow: `0 0 40px ${alpha(card.accent, 0.08)}`,
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                <CardContent sx={{ p: 3.5 }}>
                  <Box
                    sx={{
                      width: 40, height: 40, borderRadius: '10px',
                      border: '1px solid', borderColor: alpha(card.accent, 0.3),
                      bgcolor: alpha(card.accent, 0.08),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: card.accent, mb: 2.5, fontSize: '1.1rem',
                    }}
                  >
                    {card.icon}
                  </Box>
                  <Typography variant="h6" sx={{ mb: 2, fontSize: '1rem' }}>
                    {card.title}
                  </Typography>
                  <Stack spacing={1}>
                    {card.points.map((point) => (
                      <Stack key={point} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                        <Box component="span" sx={{ color: card.accent, fontSize: '0.8rem', lineHeight: 1.75, flexShrink: 0 }}>
                          ✔
                        </Box>
                        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.75, fontSize: '0.85rem' }}>
                          {point}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

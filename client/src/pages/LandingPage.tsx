import {
  Box, Container, Typography, Button, Card,
  CardContent, Stack, alpha,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  ArrowForward, Terminal, Shield, Layers, Bolt,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ExtensionFeatures, VSCodeHero } from '../components/landing/ExtensionShowcase';

const features = [
  {
    icon: <Terminal />,
    title: 'Multi-Stage Refactoring',
    desc: 'AI rewrites your Dockerfile into production-grade multi-stage builds with distroless final images.',
    accent: '#CCFF00',
  },
  {
    icon: <Shield />,
    title: 'CVE Detection',
    desc: 'Scans base images against known vulnerability databases. Ranks findings by severity with fix paths.',
    accent: '#FF6B6B',
  },
  {
    icon: <Layers />,
    title: 'Layer Audit',
    desc: 'Breaks down every instruction into measurable layers. Identifies bloat and unnecessary dependencies.',
    accent: '#FBBF24',
  },
  {
    icon: <Bolt />,
    title: 'Instant Report',
    desc: 'Get byte-level savings analysis and a downloadable optimized Dockerfile in under 5 seconds.',
    accent: '#4ADE80',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const primaryCta = isAuthenticated ? '/workbench' : '/signup';

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="md" sx={{ pt: { xs: 12, md: 18 }, pb: { xs: 10, md: 16 }, textAlign: 'center' }}>
        <Box className="fade-in">
          <Typography
            component="p"
            className="mono"
            sx={{ fontSize: '0.75rem', color: '#CCFF00', mb: 3, letterSpacing: '0.12em', textTransform: 'uppercase' }}
          >
            Powered by Cerebras AI
          </Typography>

          <Typography
            variant="h1"
            sx={{ fontSize: { xs: '2.6rem', sm: '3.6rem', md: '4.5rem' }, lineHeight: 1.05, mb: 3 }}
          >
            Your Docker images
            <br />
            are{' '}
            <Box component="span" className="accent-text">too fat.</Box>
          </Typography>

          <Typography
            sx={{
              maxWidth: 520, mx: 'auto', mb: 5,
              color: 'text.secondary', fontSize: '1.05rem', lineHeight: 1.8,
            }}
          >
            Drop a Dockerfile. Get a production-grade, multi-stage build back — 
            up to 90% smaller. Every analysis is saved privately to your account.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'center' }}>
            <Button
              variant="contained"
              size="large"
              endIcon={<ArrowForward />}
              onClick={() => navigate(primaryCta)}
              sx={{ px: 4, py: 1.5 }}
            >
              {isAuthenticated ? 'Open Workbench' : 'Create Free Account'}
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={() => navigate(isAuthenticated ? '/history' : '/login')}
              sx={{ px: 4, py: 1.5 }}
            >
              {isAuthenticated ? 'View Past Analyses' : 'Sign In'}
            </Button>
          </Stack>
        </Box>

        <Stack
          direction="row"
          spacing={0}
          sx={{
            mt: 10, justifyContent: 'center',
            border: '1px solid', borderColor: alpha('#3F3F46', 0.4),
            borderRadius: 2, overflow: 'hidden',
            bgcolor: alpha('#18181B', 0.6),
          }}
        >
          {[
            { value: '~90%', label: 'size reduction' },
            { value: '<5s', label: 'analysis time' },
            { value: '3', label: 'AI models' },
          ].map((s, i) => (
            <Box
              key={s.label}
              sx={{
                flex: 1, py: 3, px: 2, textAlign: 'center',
                borderRight: i < 2 ? '1px solid' : 'none',
                borderColor: alpha('#3F3F46', 0.4),
              }}
            >
              <Typography className="mono" sx={{ fontSize: '1.5rem', fontWeight: 700, color: '#CCFF00' }}>
                {s.value}
              </Typography>
              <Typography className="mono" sx={{ fontSize: '0.65rem', color: 'text.secondary', mt: 0.5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Container>

      <Box sx={{ borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3), py: { xs: 8, md: 12 } }}>
        <Container maxWidth="lg">
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Capabilities
          </Typography>
          <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2.2rem' }, mb: 6 }}>
            Everything you need to ship lean containers.
          </Typography>

          <Grid container spacing={2.5}>
            {features.map((f) => (
              <Grid key={f.title} size={{ xs: 12, sm: 6 }}>
                <Card
                  sx={{
                    height: '100%',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                      borderColor: alpha(f.accent, 0.4),
                      boxShadow: `0 0 40px ${alpha(f.accent, 0.08)}`,
                      transform: 'translateY(-2px)',
                    },
                  }}
                >
                  <CardContent sx={{ p: 3.5 }}>
                    <Box
                      sx={{
                        width: 40, height: 40, borderRadius: '10px',
                        border: '1px solid', borderColor: alpha(f.accent, 0.3),
                        bgcolor: alpha(f.accent, 0.08),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: f.accent, mb: 2.5, fontSize: '1.1rem',
                      }}
                    >
                      {f.icon}
                    </Box>
                    <Typography variant="h6" sx={{ mb: 1, fontSize: '1rem' }}>
                      {f.title}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
                      {f.desc}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      <VSCodeHero />
      <ExtensionFeatures />

      <Box sx={{ borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3), py: { xs: 8, md: 12 } }}>
        <Container maxWidth="md">
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase', textAlign: 'center' }}>
            Workflow
          </Typography>
          <Typography variant="h3" sx={{ textAlign: 'center', mb: 6, fontSize: { xs: '1.6rem', md: '2.2rem' } }}>
            Three steps. Zero friction.
          </Typography>

          <Stack spacing={0}>
            {[
              { n: '01', title: 'Upload', desc: 'Drag-and-drop your Dockerfile or paste its content directly.' },
              { n: '02', title: 'Analyze', desc: 'Cerebras AI parses every stage, detects bloat, and scans for CVEs.' },
              { n: '03', title: 'Ship', desc: 'Download a refactored multi-stage Dockerfile with a full savings report.' },
            ].map((step, i) => (
              <Box
                key={step.n}
                sx={{
                  display: 'flex', gap: 3, py: 3.5,
                  borderBottom: i < 2 ? '1px solid' : 'none',
                  borderColor: alpha('#3F3F46', 0.3),
                }}
              >
                <Typography className="mono" sx={{ fontSize: '1.8rem', fontWeight: 700, color: alpha('#CCFF00', 0.25), minWidth: 56 }}>
                  {step.n}
                </Typography>
                <Box>
                  <Typography variant="h6" sx={{ mb: 0.5, fontSize: '1rem' }}>{step.title}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>{step.desc}</Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </Container>
      </Box>

      <Box sx={{ borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.3), py: { xs: 8, md: 12 } }}>
        <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
          <Typography variant="h3" sx={{ mb: 2, fontSize: { xs: '1.6rem', md: '2.2rem' } }}>
            Ready to slim down?
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
            {isAuthenticated
              ? 'Free to use. Just paste your Dockerfile.'
              : 'Free to use. Create an account and paste your Dockerfile.'}
          </Typography>
          <Button
            variant="contained"
            size="large"
            endIcon={<ArrowForward />}
            onClick={() => navigate(primaryCta)}
            sx={{ px: 5, py: 1.5 }}
          >
            {isAuthenticated ? 'Launch Workbench' : 'Get Started Free'}
          </Button>
        </Container>
      </Box>
    </Box>
  );
}

import {
  Box, Container, Typography, Button, Card,
  CardContent, Chip, Stack, alpha,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  RocketLaunch, Security, AutoAwesome, Speed,
  ArrowForward, CheckCircle,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const features = [
  {
    icon: <AutoAwesome sx={{ fontSize: 28, color: '#6C63FF' }} />,
    title: 'AI-Powered Refactoring',
    description: 'Cerebras AI automatically rewrites your Dockerfile into an ultra-small, multi-stage build using distroless or Alpine bases.',
    color: '#6C63FF',
  },
  {
    icon: <Security sx={{ fontSize: 28, color: '#FF4D6D' }} />,
    title: 'Security Vulnerability Scanner',
    description: 'Detects CVEs in your base images and dependencies, ranked by CRITICAL → LOW severity with fix suggestions.',
    color: '#FF4D6D',
  },
  {
    icon: <Speed sx={{ fontSize: 28, color: '#00D4AA' }} />,
    title: 'Layer Size Auditor',
    description: 'Visualizes every build layer, its size contribution, and exactly which layers are bloating your final image.',
    color: '#00D4AA',
  },
  {
    icon: <RocketLaunch sx={{ fontSize: 28, color: '#FFB830' }} />,
    title: 'Instant Savings Report',
    description: 'Calculates exact byte savings per optimization and the projected reduction in cloud storage & CI/CD costs.',
    color: '#FFB830',
  },
];

const stats = [
  { value: '90%', label: 'Avg. Size Reduction' },
  { value: '< 5s', label: 'Analysis Time' },
  { value: 'Distroless', label: 'Target Base Images' },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="lg" sx={{ pt: { xs: 10, md: 14 }, pb: { xs: 8, md: 12 }, textAlign: 'center' }}>
        <Box className="fade-in-up">
          <Chip
            label="⚡  Powered by Cerebras AI"
            sx={{
              mb: 3, px: 2, py: 0.5, fontSize: '0.8rem',
              background: alpha('#6C63FF', 0.15),
              color: '#9D97FF',
              border: '1px solid',
              borderColor: alpha('#6C63FF', 0.3),
            }}
          />

          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: '2.4rem', sm: '3.2rem', md: '4.2rem' },
              lineHeight: 1.1,
              mb: 3,
            }}
          >
            Stop Shipping{' '}
            <Box component="span" className="gradient-text">Bloated</Box>
            <br />
            Docker Images
          </Typography>

          <Typography
            variant="h5"
            color="text.secondary"
            sx={{ maxWidth: 600, mx: 'auto', mb: 5, fontWeight: 400, lineHeight: 1.7 }}
          >
            Drop in your Dockerfile. Our AI refactors it into a{' '}
            <strong style={{ color: '#00D4AA' }}>production-grade, multi-stage build</strong>{' '}
            — reducing image size by up to 90% in seconds.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'center', alignItems: 'center' }}>
            <Button
              variant="contained"
              size="large"
              endIcon={<ArrowForward />}
              onClick={() => navigate('/workbench')}
              sx={{ px: 4, py: 1.6, fontSize: '1rem' }}
            >
              Open Workbench
            </Button>
            <Button
              variant="outlined"
              size="large"
              sx={{ px: 4, py: 1.6, fontSize: '1rem', borderColor: 'rgba(255,255,255,0.15)', color: 'text.secondary' }}
            >
              View Demo
            </Button>
          </Stack>
        </Box>

        <Grid container spacing={3} sx={{ justifyContent: 'center', mt: 8 }}>
          {stats.map((stat) => (
            <Grid key={stat.label} size={{ xs: 12, sm: 4 }}>
              <Card
                sx={{
                  p: 3, textAlign: 'center',
                  background: alpha('#6C63FF', 0.05),
                  border: '1px solid', borderColor: alpha('#6C63FF', 0.15),
                }}
              >
                <Typography variant="h3" className="gradient-text" sx={{ fontWeight: 800 }}>
                  {stat.value}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {stat.label}
                </Typography>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>


      <Container maxWidth="lg" sx={{ pb: { xs: 8, md: 12 } }}>
        <Typography variant="h2" sx={{ textAlign: 'center', mb: 2, fontSize: { xs: '1.8rem', md: '2.5rem' } }}>
          Everything a DevOps Engineer Needs
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center', mb: 6 }}>
          A complete workbench to audit, optimize, and secure your container builds.
        </Typography>

        <Grid container spacing={3}>
          {features.map((feature) => (
            <Grid key={feature.title} size={{ xs: 12, sm: 6 }}>
              <Card
                sx={{
                  height: '100%', p: 1,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: `0 12px 40px ${alpha(feature.color, 0.2)}`,
                  },
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Box
                    sx={{
                      width: 56, height: 56, borderRadius: '14px',
                      background: alpha(feature.color, 0.12),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      mb: 2,
                    }}
                  >
                    {feature.icon}
                  </Box>
                  <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 700 }}>
                    {feature.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
                    {feature.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>


      <Box sx={{ bgcolor: alpha('#6C63FF', 0.04), borderTop: '1px solid', borderColor: 'divider', py: { xs: 8, md: 12 } }}>
        <Container maxWidth="md">
          <Typography variant="h2" sx={{ textAlign: 'center', mb: 6, fontSize: { xs: '1.8rem', md: '2.5rem' } }}>
            How It Works
          </Typography>
          <Stack spacing={3}>
            {[
              { step: '01', title: 'Upload your Dockerfile', desc: 'Drag & drop or paste your Dockerfile directly into the workbench.' },
              { step: '02', title: 'AI Analyzes Every Layer', desc: 'Cerebras AI parses all build stages, detects bloat, dev-only packages, and security issues.' },
              { step: '03', title: 'Receive Optimized Dockerfile', desc: 'Get a refactored multi-stage Dockerfile with a full diff and savings report.' },
            ].map((item) => (
              <Card key={item.step} sx={{ p: 0 }}>
                <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, p: 3 }}>
                  <Typography
                    variant="h4"
                    sx={{ fontWeight: 800, color: alpha('#6C63FF', 0.4), minWidth: 48, flexShrink: 0 }}
                  >
                    {item.step}
                  </Typography>
                  <Box>
                    <Typography variant="h6" sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CheckCircle sx={{ fontSize: 18, color: '#00D4AA' }} />
                      {item.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">{item.desc}</Typography>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Container>
      </Box>


      <Container maxWidth="md" sx={{ py: { xs: 8, md: 12 }, textAlign: 'center' }}>
        <Typography variant="h3" sx={{ mb: 2, fontWeight: 800 }}>
          Ready to Shrink Your Images?
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Free to use. No account required. Just drop your Dockerfile.
        </Typography>
        <Button
          variant="contained"
          size="large"
          endIcon={<ArrowForward />}
          onClick={() => navigate('/workbench')}
          sx={{ px: 5, py: 1.8, fontSize: '1.05rem' }}
        >
          Launch Workbench
        </Button>
      </Container>
    </Box>
  );
}

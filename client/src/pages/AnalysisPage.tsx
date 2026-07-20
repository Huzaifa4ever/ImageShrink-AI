import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Card, CardContent,
  Chip, Button, Stack, CircularProgress, Alert, Divider,
  LinearProgress, alpha,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { ArrowBack, Download, Security, Speed, AutoAwesome } from '@mui/icons-material';
import { dockerService } from '../services/dockerService';
import type { AnalysisResult } from '../types';

const severityColors: Record<string, string> = {
  CRITICAL: '#FF1744', HIGH: '#FF4D6D', MEDIUM: '#FFB830', LOW: '#00D4AA',
};

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    dockerService.getAnalysis(id)
      .then((res) => setAnalysis(res.data))
      .catch(() => setError('Failed to load analysis.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <CircularProgress />
    </Box>
  );
  if (error) return (
    <Container maxWidth="lg" sx={{ pt: 6 }}>
      <Alert severity="error">{error}</Alert>
    </Container>
  );
  if (!analysis) return null;

  const savingsMB = ((analysis.originalSize - analysis.optimizedSize) / 1024 / 1024).toFixed(0);

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="lg" sx={{ pt: 5, pb: 10 }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate('/workbench')}
          sx={{ mb: 3, color: 'text.secondary' }}
        >
          Back to Workbench
        </Button>

        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 4 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>{analysis.filename}</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
              {new Date(analysis.createdAt).toLocaleString()}
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<Download />} sx={{ mt: { xs: 2, sm: 0 }, borderColor: 'rgba(255,255,255,0.12)', color: 'text.secondary' }}>
            Download Optimized Dockerfile
          </Button>
        </Stack>

        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[
            { label: 'Original Size', value: `${(analysis.originalSize / 1024 / 1024).toFixed(0)} MB`, color: '#FF4D6D', icon: <Speed /> },
            { label: 'Optimized Size', value: `${(analysis.optimizedSize / 1024 / 1024).toFixed(0)} MB`, color: '#00D4AA', icon: <AutoAwesome /> },
            { label: 'Space Saved', value: `${savingsMB} MB`, color: '#6C63FF', icon: <AutoAwesome /> },
            { label: 'Savings %', value: `${analysis.savingsPercent}%`, color: '#FFB830', icon: <Speed /> },
          ].map((stat) => (
            <Grid key={stat.label} size={{ xs: 6, md: 3 }}>
              <Card sx={{ background: alpha(stat.color, 0.07), border: '1px solid', borderColor: alpha(stat.color, 0.2) }}>
                <CardContent>
                  <Typography variant="body2" color="text.secondary">{stat.label}</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 800, color: stat.color }}>{stat.value}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Card sx={{ mb: 4, p: 0.5 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Size Reduction</Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={2}>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>Original</Typography>
              <Box sx={{ flexGrow: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={100}
                  sx={{ height: 12, borderRadius: 6, bgcolor: alpha('#FF4D6D', 0.15), '& .MuiLinearProgress-bar': { bgcolor: '#FF4D6D' } }}
                />
              </Box>
            </Stack>
            <Stack direction="row" sx={{ alignItems: 'center', mt: 1.5 }} spacing={2}>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>Optimized</Typography>
              <Box sx={{ flexGrow: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={100 - analysis.savingsPercent}
                  sx={{ height: 12, borderRadius: 6, bgcolor: alpha('#00D4AA', 0.15), '& .MuiLinearProgress-bar': { bgcolor: '#00D4AA' } }}
                />
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                  Build Stages ({analysis.stages?.length ?? 0})
                </Typography>
                {(analysis.stages ?? []).map((stage, i) => (
                  <Box key={stage.id} sx={{ mb: 2 }}>
                    {i > 0 && <Divider sx={{ mb: 2, borderColor: 'rgba(255,255,255,0.05)' }} />}
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{stage.name || `Stage ${i + 1}`}</Typography>
                      {stage.isFinalStage && <Chip label="FINAL" size="small" color="primary" sx={{ fontSize: '0.65rem' }} />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Base: <code>{stage.baseImage}</code>
                    </Typography>
                    {(stage.layers ?? []).map((layer) => (
                      <Stack key={layer.id} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '70%' }}>
                          {layer.command}
                        </Typography>
                        <Chip
                          label={layer.sizeHuman}
                          size="small"
                          sx={{
                            fontSize: '0.65rem',
                            bgcolor: layer.isOptimizable ? alpha('#FF4D6D', 0.12) : alpha('#00D4AA', 0.1),
                            color: layer.isOptimizable ? '#FF4D6D' : '#00D4AA',
                          }}
                        />
                      </Stack>
                    ))}
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }} spacing={1}>
                  <Security sx={{ color: '#FF4D6D' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Vulnerabilities ({analysis.vulnerabilities?.length ?? 0})
                  </Typography>
                </Stack>
                {(analysis.vulnerabilities ?? []).length === 0 ? (
                  <Alert severity="success">No vulnerabilities detected 🎉</Alert>
                ) : (
                  (analysis.vulnerabilities ?? []).map((v) => (
                    <Box
                      key={v.id}
                      sx={{
                        p: 1.5, mb: 1.5, borderRadius: 2,
                        background: alpha(severityColors[v.severity] ?? '#fff', 0.07),
                        border: '1px solid',
                        borderColor: alpha(severityColors[v.severity] ?? '#fff', 0.2),
                      }}
                    >
                      <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }} spacing={1}>
                        <Chip
                          label={v.severity}
                          size="small"
                          sx={{ bgcolor: severityColors[v.severity], color: '#fff', fontSize: '0.65rem', fontWeight: 700 }}
                        />
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>{v.package}</Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">{v.description}</Typography>
                      {v.fixedVersion && (
                        <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5 }}>
                          ✓ Fix: upgrade to {v.fixedVersion}
                        </Typography>
                      )}
                    </Box>
                  ))
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid size={12}>
            <Card>
              <CardContent>
                <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }} spacing={1}>
                  <AutoAwesome sx={{ color: '#6C63FF' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>AI-Optimized Dockerfile</Typography>
                </Stack>
                <Box
                  component="pre"
                  sx={{
                    p: 2.5, borderRadius: 2, overflowX: 'auto',
                    background: '#0D1117', border: '1px solid rgba(255,255,255,0.06)',
                    fontSize: '0.8rem', lineHeight: 1.8,
                    color: '#C9D1D9', fontFamily: 'monospace',
                    maxHeight: 400,
                  }}
                >
                  {analysis.optimizedDockerfile || '# Optimized Dockerfile will appear here after analysis'}
                </Box>
                {analysis.aiInsights && (
                  <Alert severity="info" icon={<AutoAwesome />} sx={{ mt: 2 }}>
                    <strong>AI Insights:</strong> {analysis.aiInsights}
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

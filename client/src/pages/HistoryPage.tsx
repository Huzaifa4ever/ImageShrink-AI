import { useEffect, useState } from 'react';
import {
  Box, Container, Typography, Card, CardContent,
  Chip, IconButton, Stack, CircularProgress, Alert, alpha,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { Delete, OpenInNew, AccessTime } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { dockerService } from '../services/dockerService';
import type { AnalysisResult } from '../types';

export default function HistoryPage() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = () => {
    dockerService.getHistory()
      .then((res) => setHistory(res.data))
      .catch(() => setError('Failed to load history.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchHistory(); }, []);

  const handleDelete = async (id: string) => {
    try {
      await dockerService.deleteAnalysis(id);
      setHistory((prev) => prev.filter((h) => h._id !== id));
    } catch {
      setError('Failed to delete analysis.');
    }
  };

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="lg" sx={{ pt: 6, pb: 10 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>Analysis History</Typography>
        <Typography color="text.secondary" sx={{ mb: 5 }}>
          All your previous Dockerfile analyses.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        ) : history.length === 0 ? (
          <Card sx={{ textAlign: 'center', py: 8 }}>
            <CardContent>
              <Typography variant="h5" color="text.secondary" sx={{ mb: 1 }}>No analyses yet</Typography>
              <Typography color="text.secondary" variant="body2">
                Upload your first Dockerfile from the workbench to get started.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Grid container spacing={3}>
            {history.map((item) => (
              <Grid key={item._id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card
                  sx={{
                    height: '100%', transition: 'transform 0.2s, box-shadow 0.2s',
                    '&:hover': { transform: 'translateY(-3px)', boxShadow: `0 8px 32px ${alpha('#6C63FF', 0.2)}` },
                  }}
                >
                  <CardContent>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, maxWidth: '75%' }}>
                        {item.filename}
                      </Typography>
                      <Stack direction="row">
                        <IconButton size="small" onClick={() => navigate(`/analysis/${item._id}`)}>
                          <OpenInNew fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleDelete(item._id)} sx={{ color: '#FF4D6D' }}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>

                    <Stack direction="row" sx={{ alignItems: 'center', mt: 0.5, mb: 2 }} spacing={0.5}>
                      <AccessTime sx={{ fontSize: 13, color: 'text.secondary' }} />
                      <Typography variant="caption" color="text.secondary">
                        {new Date(item.createdAt).toLocaleString()}
                      </Typography>
                    </Stack>

                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                      <Chip
                        label={`${(item.originalSize / 1024 / 1024).toFixed(0)} MB → ${(item.optimizedSize / 1024 / 1024).toFixed(0)} MB`}
                        size="small"
                        sx={{ bgcolor: alpha('#6C63FF', 0.1), color: 'primary.light', fontSize: '0.7rem' }}
                      />
                      <Chip
                        label={`-${item.savingsPercent}%`}
                        size="small"
                        sx={{ bgcolor: alpha('#00D4AA', 0.1), color: '#00D4AA', fontWeight: 700, fontSize: '0.7rem' }}
                      />
                    </Stack>

                    {item.vulnerabilities?.length > 0 && (
                      <Chip
                        label={`${item.vulnerabilities.length} vuln${item.vulnerabilities.length !== 1 ? 's' : ''}`}
                        size="small"
                        sx={{ mt: 1, bgcolor: alpha('#FF4D6D', 0.1), color: '#FF4D6D', fontSize: '0.7rem' }}
                      />
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Container>
    </Box>
  );
}

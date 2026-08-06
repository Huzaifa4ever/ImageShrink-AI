import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Container, Typography, Button, Stack, CircularProgress, Alert,
} from '@mui/material';
import { ArrowBack, Download } from '@mui/icons-material';
import AnalysisDetail, { downloadOptimizedDockerfile } from '../components/analysis/AnalysisDetail';
import { dockerService } from '../services/dockerService';
import { apiErrorMessage } from '../services/api';
import type { AnalysisResult } from '../types';

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    dockerService.getAnalysis(id)
      .then((res) => { if (!cancelled) setAnalysis(res.data); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, 'Failed to load analysis.')); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id]);

  if (loading) return (<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}><CircularProgress sx={{ color: '#CCFF00' }} /></Box>);
  if (error) return (
    <Container maxWidth="lg" sx={{ pt: 6 }}>
      <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>
      <Button startIcon={<ArrowBack />} onClick={() => navigate('/history')} sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
        Back to history
      </Button>
    </Container>
  );
  if (!analysis) return null;

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="lg" sx={{ pt: 5, pb: 10 }}>
        <Button startIcon={<ArrowBack />} onClick={() => navigate('/workbench')}
          sx={{ mb: 3, color: 'text.secondary', fontSize: '0.8rem' }}>Back</Button>

        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 4 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>{analysis.filename}</Typography>
            <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
              {new Date(analysis.createdAt).toLocaleString()}
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<Download />} onClick={() => downloadOptimizedDockerfile(analysis)}
            sx={{ mt: { xs: 2, sm: 0 }, fontSize: '0.8rem' }}>Download Optimized</Button>
        </Stack>

        <AnalysisDetail analysis={analysis} />
      </Container>
    </Box>
  );
}

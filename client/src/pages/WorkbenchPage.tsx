import { useState, useCallback, useEffect } from 'react';
import {
  Box, Container, Typography, Button, Card, CardContent,
  Alert, LinearProgress, Stack, alpha, Select, MenuItem, FormControl,
  CircularProgress, Chip, Divider, Tooltip,
} from '@mui/material';
import { CloudUpload, AutoAwesome, ContentPaste, Memory, Refresh } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { dockerService } from '../services/dockerService';
import { apiErrorMessage } from '../services/api';
import { validateDockerfileContent, validateDockerfileName } from '../utils/validation';
import type { AiModel, ModelStatus } from '../types';

const UPLOAD_ACCEPT = '.dockerfile,.containerfile,Dockerfile,Containerfile';

const STATUS_META: Record<ModelStatus, { color: string; label: string; hint: string }> = {
  available: { color: '#4ADE80', label: 'Available', hint: 'Answered a live test request just now' },
  busy: { color: '#FBBF24', label: 'Busy', hint: 'Serving, but queueing behind other traffic - retry shortly' },
  unavailable: { color: '#FF6B6B', label: 'Unavailable', hint: 'Not served by the provider right now' },
  unknown: { color: '#A1A1AA', label: 'Not checked', hint: 'Listed by the provider, but not health-checked yet' },
};

/** Only these are worth sending an analysis to. */
const isUsable = (m: AiModel) => m.status === 'available' || m.status === 'unknown';

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pasteContent, setPasteContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');

  const [models, setModels] = useState<AiModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [probed, setProbed] = useState(false);
  const [autoSwitched, setAutoSwitched] = useState<string | null>(null);

  const loadModels = useCallback(async (probe: boolean) => {
    if (probe) setChecking(true);
    try {
      const { data } = await dockerService.getModels(probe);
      setModels(data.models);
      setProbed(data.probed);
      setCatalogError(data.error);
      setSelectedModel((current) => {
        const stillGood = data.models.find((m) => m.id === current && isUsable(m));
        if (stillGood) return current;
        const fallback = data.models.find(isUsable) ?? data.models[0];
        if (current && fallback && fallback.id !== current) setAutoSwitched(fallback.label);
        return fallback?.id ?? current;
      });
    } catch {
      setCatalogError('Could not reach the server to list AI models.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void loadModels(false); }, [loadModels]);

  const acceptFile = useCallback((candidate: File) => {
    const problem = validateDockerfileName(candidate.name);
    if (problem) { setFile(null); setError(problem); return; }
    setError(null);
    setFile(candidate);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) acceptFile(dropped);
  }, [acceptFile]);

  const handleAnalyze = async () => {
    setError(null);

    let uploadFile: File;
    if (mode === 'paste') {
      const problem = validateDockerfileContent(pasteContent);
      if (problem) { setError(problem); return; }
      uploadFile = new File([new Blob([pasteContent], { type: 'text/plain' })], 'Dockerfile', { type: 'text/plain' });
    } else if (file) {
      const problem = validateDockerfileName(file.name);
      if (problem) { setError(problem); return; }
      uploadFile = file;
    } else {
      setError('Please upload or paste a Dockerfile first.');
      return;
    }

    setLoading(true);
    try {
      const result = await dockerService.analyzeDockerfile(uploadFile, selectedModel);
      navigate(`/analysis/${result.data._id}`);
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Analysis failed.'));
    } finally { setLoading(false); }
  };

  const selected = models.find((m) => m.id === selectedModel);
  const selectedUnusable = selected && !isUsable(selected);

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="md" sx={{ pt: 8, pb: 12 }}>
        <Box sx={{ mb: 5 }}>
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Workbench</Typography>
          <Typography variant="h3" sx={{ fontWeight: 700, mb: 1, fontSize: { xs: '1.6rem', md: '2rem' } }}>Analyze your Dockerfile</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Upload or paste - the AI handles the rest.</Typography>
        </Box>

        <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
          {(['upload', 'paste'] as const).map((m) => (
            <Button key={m} variant={mode === m ? 'contained' : 'outlined'} onClick={() => setMode(m)}
              startIcon={m === 'upload' ? <CloudUpload sx={{ fontSize: '1rem !important' }} /> : <ContentPaste sx={{ fontSize: '1rem !important' }} />}
              sx={{ fontSize: '0.8rem', px: 2.5 }}>
              {m === 'upload' ? 'Upload File' : 'Paste Content'}
            </Button>
          ))}
        </Stack>

        {mode === 'upload' && (
          <Card onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
            onClick={() => document.getElementById('file-input')?.click()}
            sx={{ border: '1px dashed', borderColor: isDragging ? '#CCFF00' : file ? '#4ADE80' : alpha('#3F3F46', 0.5),
              bgcolor: isDragging ? alpha('#CCFF00', 0.03) : file ? alpha('#4ADE80', 0.03) : 'transparent',
              transition: 'all 0.2s', cursor: 'pointer', mb: 3, '&:hover': { borderColor: alpha('#CCFF00', 0.5) } }}>
            <CardContent sx={{ py: 7, textAlign: 'center' }}>
              <input id="file-input" type="file" hidden accept={UPLOAD_ACCEPT}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); e.target.value = ''; }} />
              <CloudUpload sx={{ fontSize: 40, color: file ? '#4ADE80' : 'text.secondary', mb: 2, opacity: 0.7 }} />
              {file ? (<><Typography sx={{ fontWeight: 600, color: '#4ADE80' }}>{file.name}</Typography>
                <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>{(file.size / 1024).toFixed(1)} KB - click to replace</Typography></>
              ) : (<><Typography sx={{ color: 'text.secondary', fontWeight: 500 }}>Drop your Dockerfile here</Typography>
                <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>or click to browse</Typography>
                <Typography className="mono" variant="caption" sx={{ color: 'text.disabled', mt: 1.5, display: 'block', fontSize: '0.62rem' }}>
                  Dockerfile · Dockerfile.prod · prod.Dockerfile · Containerfile
                </Typography></>)}
            </CardContent>
          </Card>
        )}

        {mode === 'paste' && (
          <Card sx={{ mb: 3 }}>
            <Box component="textarea" value={pasteContent} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPasteContent(e.target.value)}
              placeholder={"# Paste your Dockerfile here...\nFROM node:18\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD [\"node\", \"server.js\"]"}
              sx={{ width: '100%', minHeight: 260, p: 3, background: 'transparent', border: 'none', outline: 'none',
                color: 'text.primary', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', lineHeight: 1.8, resize: 'vertical' }} />
          </Card>
        )}

        {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>{error}</Alert>}
        {loading && <LinearProgress sx={{ mb: 3, bgcolor: alpha('#CCFF00', 0.1), '& .MuiLinearProgress-bar': { bgcolor: '#CCFF00' } }} />}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <Select value={models.length ? selectedModel : ''} onChange={(e) => { setSelectedModel(e.target.value); setAutoSwitched(null); }}
              disabled={loading || !models.length} displayEmpty
              renderValue={(value) => {
                const m = models.find((x) => x.id === value);
                if (!m) return 'Loading models…';
                return (
                  <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: STATUS_META[m.status].color, flexShrink: 0 }} />
                    <span>{m.label}</span>
                  </Stack>
                );
              }}
              sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', bgcolor: alpha('#18181B', 0.8),
                '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha('#3F3F46', 0.5) },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: alpha('#CCFF00', 0.4) } }}>
              {models.map((m) => (
                <MenuItem key={m.id} value={m.id} disabled={m.status === 'unavailable'}
                  sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem' }}>
                  <Stack direction="row" sx={{ alignItems: 'center', width: '100%' }} spacing={1}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: STATUS_META[m.status].color, flexShrink: 0 }} />
                    <span>{m.label}</span>
                    {m.status !== 'unknown' && (
                      <Typography component="span" className="mono" sx={{ fontSize: '0.6rem', color: STATUS_META[m.status].color, ml: 'auto' }}>
                        {STATUS_META[m.status].label}
                      </Typography>
                    )}
                  </Stack>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" size="large" onClick={handleAnalyze}
            disabled={loading || !selectedModel || selectedUnusable || (mode === 'upload' ? !file : !pasteContent.trim())}
            startIcon={<AutoAwesome />} sx={{ px: 4, py: 1.3, flexShrink: 0 }}>
            {loading ? 'Analyzing...' : 'Run Analysis'}
          </Button>
        </Stack>
        <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2 }}>Typically completes in 3–8 seconds</Typography>

        {autoSwitched && (
          <Alert severity="info" onClose={() => setAutoSwitched(null)}
            sx={{ mt: 2, bgcolor: alpha('#38BDF8', 0.06), border: '1px solid', borderColor: alpha('#38BDF8', 0.2) }}>
            <Typography variant="caption">Switched you to <strong>{autoSwitched}</strong> - the previous choice isn't taking requests right now.</Typography>
          </Alert>
        )}

        <Card sx={{ mt: 6 }}>
          <CardContent>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
                <Memory sx={{ color: '#CCFF00', fontSize: '1rem' }} />
                <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Model Availability
                </Typography>
              </Stack>
              <Button size="small" variant="outlined" onClick={() => void loadModels(true)} disabled={checking}
                startIcon={checking ? <CircularProgress size={13} sx={{ color: '#CCFF00' }} /> : <Refresh sx={{ fontSize: '1rem !important' }} />}
                sx={{ fontSize: '0.72rem' }}>
                {checking ? 'Checking…' : 'Check availability'}
              </Button>
            </Stack>

            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7, mb: 2 }}>
              These models run on shared inference hardware, so capacity moves around during the day.
              A model marked <Box component="span" sx={{ color: '#FBBF24', fontWeight: 600 }}>Busy</Box> is
              queueing behind other traffic - that is provider load, <strong>not</strong> a problem with your
              Dockerfile or with ImageShrink. Run the check below, pick a model marked{' '}
              <Box component="span" sx={{ color: '#4ADE80', fontWeight: 600 }}>Available</Box>, and your
              analysis will go straight through.
            </Typography>

            {catalogError && (
              <Alert severity="warning" sx={{ mb: 2, bgcolor: alpha('#FBBF24', 0.06), border: '1px solid', borderColor: alpha('#FBBF24', 0.25) }}>
                <Typography variant="caption">{catalogError}</Typography>
              </Alert>
            )}

            {!models.length && !catalogError ? (
              <Typography className="mono" variant="caption" sx={{ color: 'text.secondary' }}>Loading model list…</Typography>
            ) : (
              <Stack divider={<Divider sx={{ borderColor: alpha('#3F3F46', 0.3) }} />}>
                {models.map((m) => {
                  const meta = STATUS_META[m.status];
                  const active = m.id === selectedModel;
                  return (
                    <Box key={m.id} onClick={() => { if (m.status !== 'unavailable') { setSelectedModel(m.id); setAutoSwitched(null); } }}
                      sx={{ py: 1.5, px: 1.5, mx: -1.5, borderRadius: 2,
                        cursor: m.status === 'unavailable' ? 'not-allowed' : 'pointer',
                        opacity: m.status === 'unavailable' ? 0.55 : 1,
                        bgcolor: active ? alpha('#CCFF00', 0.05) : 'transparent',
                        '&:hover': { bgcolor: active ? alpha('#CCFF00', 0.07) : alpha('#FFFFFF', 0.02) } }}>
                      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                        <Tooltip title={meta.hint} placement="top" arrow>
                          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: meta.color, flexShrink: 0,
                            boxShadow: m.status === 'available' ? `0 0 8px ${alpha(meta.color, 0.7)}` : 'none' }} />
                        </Tooltip>
                        <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{m.label}</Typography>
                        {active && <Chip label="SELECTED" size="small" sx={{ fontSize: '0.55rem', fontWeight: 700, height: 18, bgcolor: alpha('#CCFF00', 0.12), color: '#CCFF00' }} />}
                        {m.isDefault && <Chip label="DEFAULT" size="small" sx={{ fontSize: '0.55rem', fontWeight: 700, height: 18, bgcolor: alpha('#A1A1AA', 0.12), color: '#A1A1AA' }} />}
                        <Stack direction="row" sx={{ alignItems: 'center', ml: 'auto' }} spacing={1}>
                          {m.latencyMs != null && (
                            <Typography className="mono" variant="caption" sx={{ color: 'text.disabled', fontSize: '0.62rem' }}>{m.latencyMs} ms</Typography>
                          )}
                          <Typography className="mono" variant="caption" sx={{ color: meta.color, fontSize: '0.65rem', fontWeight: 700 }}>
                            {meta.label}
                          </Typography>
                        </Stack>
                      </Stack>
                      <Typography className="mono" variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: '0.62rem', mt: 0.3, ml: 2.3 }}>
                        {m.id}{m.reason ? ` - ${m.reason}` : ''}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}

            <Typography className="mono" variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: '0.62rem', mt: 2 }}>
              {probed
                ? 'Status from a live test request to each model. Results are cached for about a minute.'
                : 'Showing the provider’s catalog. Run the check for live status on each model.'}
            </Typography>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

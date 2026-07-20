import { useState, useCallback } from 'react';
import {
  Box, Container, Typography, Button, Card, CardContent,
  Alert, LinearProgress, Chip, Stack, alpha, Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import {
  CloudUpload, AutoAwesome, ContentPaste,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { dockerService } from '../services/dockerService';

const AI_MODELS = [
  { id: 'zai-glm-4.7', label: 'Z.ai GLM 4.7' },
  { id: 'gemma-4-31b', label: 'Gemma 4 31B' },
  { id: 'openai-gpt-oss', label: 'OpenAI GPT OSS' },
];

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pasteContent, setPasteContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0].id);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleAnalyze = async () => {
    setError(null);
    setLoading(true);
    try {
      let uploadFile: File;
      if (mode === 'paste') {
        const blob = new Blob([pasteContent], { type: 'text/plain' });
        uploadFile = new File([blob], 'Dockerfile', { type: 'text/plain' });
      } else if (file) {
        uploadFile = file;
      } else {
        setError('Please upload or paste a Dockerfile first.');
        setLoading(false);
        return;
      }
      const result = await dockerService.analyzeDockerfile(uploadFile, selectedModel);
      navigate(`/analysis/${result.data._id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Analysis failed. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="lg" sx={{ pt: 6, pb: 10 }}>
        <Box sx={{ mb: 5, textAlign: 'center' }}>
          <Typography variant="h3" sx={{ fontWeight: 800, mb: 1.5 }}>
            AI Workbench
          </Typography>
          <Typography color="text.secondary">
            Upload or paste your Dockerfile — our AI will analyze and optimize it instantly.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', mb: 4 }}>
          {(['upload', 'paste'] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'contained' : 'outlined'}
              onClick={() => setMode(m)}
              startIcon={m === 'upload' ? <CloudUpload /> : <ContentPaste />}
              sx={{ px: 3, borderColor: 'rgba(255,255,255,0.12)', color: mode !== m ? 'text.secondary' : undefined }}
            >
              {m === 'upload' ? 'Upload File' : 'Paste Content'}
            </Button>
          ))}
        </Stack>

        {mode === 'upload' && (
          <Card
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            sx={{
              border: '2px dashed',
              borderColor: isDragging ? 'primary.main' : file ? '#00D4AA' : 'rgba(255,255,255,0.1)',
              background: isDragging
                ? alpha('#6C63FF', 0.08)
                : file
                  ? alpha('#00D4AA', 0.05)
                  : 'transparent',
              transition: 'all 0.2s',
              cursor: 'pointer',
              mb: 3,
            }}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <CardContent sx={{ py: 6, textAlign: 'center' }}>
              <input
                id="file-input"
                type="file"
                hidden
                accept=".dockerfile,Dockerfile,text/plain"
                onChange={handleFileInput}
              />
              <CloudUpload sx={{ fontSize: 52, color: file ? '#00D4AA' : 'text.secondary', mb: 2 }} />
              {file ? (
                <>
                  <Typography variant="h6" color="success.main">{file.name}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {(file.size / 1024).toFixed(1)} KB · Click to replace
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" color="text.secondary">
                    Drag & drop your Dockerfile here
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    or click to browse
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', mt: 2 }}>
                    {['Dockerfile', '.dockerfile', 'text/plain'].map((t) => (
                      <Chip key={t} label={t} size="small" sx={{ fontSize: '0.7rem', bgcolor: alpha('#fff', 0.05) }} />
                    ))}
                  </Stack>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {mode === 'paste' && (
          <Card sx={{ mb: 3 }}>
            <CardContent sx={{ p: 0 }}>
              <Box
                component="textarea"
                value={pasteContent}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPasteContent(e.target.value)}
                placeholder={`# Paste your Dockerfile here...\nFROM node:18\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["node", "server.js"]`}
                sx={{
                  width: '100%', minHeight: 280, p: 3,
                  background: 'transparent', border: 'none', outline: 'none',
                  color: 'text.primary', fontFamily: 'monospace', fontSize: '0.875rem',
                  lineHeight: 1.7, resize: 'vertical',
                }}
              />
            </CardContent>
          </Card>
        )}

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
        {loading && <LinearProgress sx={{ mb: 3, borderRadius: 1 }} />}

        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <FormControl sx={{ minWidth: 240 }} size="small">
            <InputLabel id="model-select-label">AI Model</InputLabel>
            <Select
              labelId="model-select-label"
              value={selectedModel}
              label="AI Model"
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={loading}
              sx={{ bgcolor: 'background.paper' }}
            >
              {AI_MODELS.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ textAlign: 'center' }}>
          <Button
            variant="contained"
            size="large"
            onClick={handleAnalyze}
            disabled={loading || (mode === 'upload' ? !file : !pasteContent.trim())}
            startIcon={<AutoAwesome />}
            sx={{ px: 6, py: 1.8, fontSize: '1rem' }}
          >
            {loading ? 'Analyzing...' : 'Analyze & Optimize with AI'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            Analysis typically takes 3–8 seconds
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}

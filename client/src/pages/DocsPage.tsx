import { useEffect, useMemo, useState } from 'react';
import {
  Box, Container, Typography, Stack, Chip, Accordion, AccordionSummary, AccordionDetails,
  TextField, ToggleButtonGroup, ToggleButton, Alert, CircularProgress, Link, Divider, alpha,
} from '@mui/material';
import { ExpandMore, Search } from '@mui/icons-material';
import api, { apiErrorMessage } from '../services/api';
import type { ApiResponse } from '../types';

const LIME = '#CCFF00';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface Rule {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  instruction: string;
  problem: string;
  explanation: string;
  sizeImpactMb: number;
  savingsMb: number;
  securityImpact: string | null;
  performanceImpact: string | null;
  docsUrl: string;
  quickFixTitle: string | null;
  autoFixable: boolean;
}

interface RuleCatalog {
  rules: Rule[];
  categories: string[];
  severities: Severity[];
}

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#FF6B6B',
  high: '#FBBF24',
  medium: '#7DD3FC',
  low: '#A1A1AA',
  info: '#71717A',
};

const SETTINGS = [
  ['imageshrink.useLocalRulesOnly', 'false', 'Never contact the backend. Overrides every setting below.'],
  ['imageshrink.enableAiSuggestions', 'true', 'Include AI suggestions.'],
  ['imageshrink.useAiBackend', 'true', 'Allow full AI analysis on demand.'],
  ['imageshrink.enableAutoAnalysis', 'true', 'Analyze automatically.'],
  ['imageshrink.analyzeWhileTyping', 'true', 'Re-lint after a pause in typing.'],
  ['imageshrink.analyzeOnSave', 'true', 'Re-lint on save.'],
  ['imageshrink.sendWorkspaceContext', 'true', 'Include .dockerignore and package.json with AI analysis.'],
  ['imageshrink.minimumSeverity', 'info', 'Hide findings below this severity.'],
  ['imageshrink.diagnosticsSeverity', 'warning', 'How findings appear in the Problems panel.'],
  ['imageshrink.debounceMs', '400', 'Pause before re-linting, in milliseconds.'],
  ['imageshrink.model', '(server default)', 'Preferred AI model.'],
  ['imageshrink.apiUrl', 'http://localhost:8000/api/v1', 'Backend URL.'],
  ['imageshrink.telemetry', 'false', 'Anonymous usage data. Off by default.'],
];

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <Typography className="mono" sx={{ fontSize: '0.7rem', color: LIME, mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {eyebrow}
      </Typography>
      <Typography variant="h4" sx={{ fontSize: { xs: '1.4rem', md: '1.8rem' }, mb: 3 }}>
        {title}
      </Typography>
    </>
  );
}

export default function DocsPage() {
  const [catalog, setCatalog] = useState<RuleCatalog | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    let cancelled = false;
    api
      .get<ApiResponse<RuleCatalog>>('/rules')
      .then(({ data }) => { if (!cancelled) setCatalog(data.data); })
      .catch((e) => { if (!cancelled) setError(apiErrorMessage(e, 'Could not load the rule reference.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    return catalog.rules.filter((rule) => {
      if (category !== 'all' && rule.category !== category) return false;
      if (!needle) return true;
      return (
        rule.id.includes(needle) ||
        rule.title.toLowerCase().includes(needle) ||
        rule.problem.toLowerCase().includes(needle)
      );
    });
  }, [catalog, query, category]);

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="md" sx={{ pt: { xs: 8, md: 12 }, pb: 10 }}>
        <Typography variant="h1" sx={{ fontSize: { xs: '2rem', md: '2.8rem' }, mb: 2 }}>
          Documentation
        </Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: '1rem', lineHeight: 1.8, mb: 6, maxWidth: 620 }}>
          How ImageShrink analyses a Dockerfile, every rule it can report, the extension's
          settings, and the REST API behind both.
        </Typography>

        <SectionHeading eyebrow="Concepts" title="Two engines, one catalog" />
        <Stack spacing={2} sx={{ mb: 7 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.85 }}>
            Every finding comes from one of two places. The <strong>rule engine</strong> is
            deterministic: it parses your Dockerfile, applies the rules listed below, and produces
            the same answer every time. It is bundled into the VS Code extension so it can run on
            every keystroke without a network round trip, and it also runs on the server for web
            uploads.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.85 }}>
            The <strong>AI analysis</strong> runs only when you ask for it. It rewrites the whole
            file into a multi-stage build, estimates the size before and after, and reads your
            project context. Because it is a language model, its output is treated as untrusted:
            every field is type-checked and clamped before it is stored.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.85 }}>
            The two engines are separate implementations, so they are held to agreement by a parity
            test that runs both over a corpus of Dockerfiles and fails on any disagreement about
            which rules fired, where, or with which fix. Their user-facing wording is not
            duplicated at all - both read the catalog below, which is also what this page renders.
          </Typography>
          <Alert severity="info" sx={{ mt: 1 }}>
            <strong>Scores</strong> come from the rule engine, not the model. That makes them
            reproducible, traceable to specific findings, and stable whether or not the AI is
            reachable.
          </Alert>
        </Stack>

        <SectionHeading eyebrow="Reference" title={`Rules${catalog ? ` (${catalog.rules.length})` : ''}`} />

        {loading && (
          <Stack sx={{ alignItems: 'center', py: 5 }}>
            <CircularProgress size={26} sx={{ color: LIME }} />
          </Stack>
        )}

        {error && (
          <Alert severity="warning" sx={{ mb: 4 }}>
            {error} The rule reference is served by the API - check that the backend is running.
          </Alert>
        )}

        {catalog && (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
              <TextField
                size="small"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search rules"
                slotProps={{
                  input: {
                    startAdornment: <Search sx={{ fontSize: '1.1rem', color: 'text.secondary', mr: 1 }} />,
                  },
                }}
                sx={{ flex: 1 }}
              />
              <ToggleButtonGroup
                size="small"
                exclusive
                value={category}
                onChange={(_, value) => { if (value) setCategory(value); }}
              >
                <ToggleButton value="all" sx={{ fontSize: '0.72rem', px: 1.5 }}>All</ToggleButton>
                {catalog.categories.map((c) => (
                  <ToggleButton key={c} value={c} sx={{ fontSize: '0.72rem', px: 1.5, textTransform: 'capitalize' }}>
                    {c}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>

            {visible.length === 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary', py: 3 }}>
                No rules match that search.
              </Typography>
            )}

            <Box sx={{ mb: 7 }}>
              {visible.map((rule) => (
                <Accordion
                  key={rule.id}
                  disableGutters
                  sx={{
                    bgcolor: 'transparent', boxShadow: 'none',
                    borderBottom: '1px solid', borderColor: alpha('#3F3F46', 0.4),
                    '&:before': { display: 'none' },
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0 }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                      <Chip
                        label={rule.severity}
                        size="small"
                        sx={{
                          bgcolor: alpha(SEVERITY_COLOR[rule.severity], 0.12),
                          color: SEVERITY_COLOR[rule.severity],
                          border: '1px solid', borderColor: alpha(SEVERITY_COLOR[rule.severity], 0.3),
                          minWidth: 62,
                        }}
                      />
                      <Typography sx={{ fontWeight: 600, fontSize: '0.92rem' }}>{rule.title}</Typography>
                      {rule.autoFixable && (
                        <Chip label="quick fix" size="small" sx={{ bgcolor: alpha(LIME, 0.1), color: LIME }} />
                      )}
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pb: 3 }}>
                    <Stack spacing={1.75}>
                      <Typography variant="body2" sx={{ color: 'text.primary' }}>{rule.problem}</Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.8 }}>
                        {rule.explanation}
                      </Typography>

                      {rule.securityImpact && (
                        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.8 }}>
                          <Box component="span" sx={{ color: '#FF6B6B', fontWeight: 600 }}>Security - </Box>
                          {rule.securityImpact}
                        </Typography>
                      )}
                      {rule.performanceImpact && (
                        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.8 }}>
                          <Box component="span" sx={{ color: '#FBBF24', fontWeight: 600 }}>Performance - </Box>
                          {rule.performanceImpact}
                        </Typography>
                      )}

                      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
                        <Typography className="mono" variant="caption" sx={{ color: 'text.secondary' }}>
                          {rule.id}
                        </Typography>
                        <Typography className="mono" variant="caption" sx={{ color: 'text.secondary' }}>
                          {rule.instruction === '*' ? 'whole file' : rule.instruction}
                        </Typography>
                        {rule.savingsMb > 0 && (
                          <Typography className="mono" variant="caption" sx={{ color: '#4ADE80' }}>
                            ~{rule.savingsMb} MB estimated saving
                          </Typography>
                        )}
                        <Link href={rule.docsUrl} target="_blank" rel="noopener noreferrer" variant="caption" sx={{ color: LIME }}>
                          Docker docs ↗
                        </Link>
                      </Stack>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          </>
        )}

        <SectionHeading eyebrow="Extension" title="Settings" />
        <Box sx={{ mb: 7, overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: 560 }}>
            <Box component="thead">
              <Box component="tr">
                {['Setting', 'Default', 'Description'].map((h) => (
                  <Box
                    key={h}
                    component="th"
                    sx={{ textAlign: 'left', py: 1.25, px: 1, color: 'text.secondary', fontWeight: 600, borderBottom: '1px solid', borderColor: alpha('#3F3F46', 0.5) }}
                  >
                    {h}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {SETTINGS.map(([name, def, desc]) => (
                <Box component="tr" key={name}>
                  <Box component="td" className="mono" sx={{ py: 1.25, px: 1, fontSize: '0.76rem', color: '#E4E4E7', borderBottom: '1px solid', borderColor: alpha('#3F3F46', 0.25), whiteSpace: 'nowrap' }}>
                    {name}
                  </Box>
                  <Box component="td" className="mono" sx={{ py: 1.25, px: 1, fontSize: '0.74rem', color: LIME, borderBottom: '1px solid', borderColor: alpha('#3F3F46', 0.25), whiteSpace: 'nowrap' }}>
                    {def}
                  </Box>
                  <Box component="td" sx={{ py: 1.25, px: 1, color: 'text.secondary', borderBottom: '1px solid', borderColor: alpha('#3F3F46', 0.25) }}>
                    {desc}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        <SectionHeading eyebrow="Input" title="What can be analyzed" />
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 6, lineHeight: 1.85 }}>
          Uploads must be a Dockerfile: <Box component="code" sx={{ color: LIME }}>Dockerfile</Box>,{' '}
          <Box component="code" sx={{ color: LIME }}>Dockerfile.&lt;something&gt;</Box>,{' '}
          <Box component="code" sx={{ color: LIME }}>&lt;something&gt;.Dockerfile</Box> or{' '}
          <Box component="code" sx={{ color: LIME }}>Containerfile</Box>. Pasted text is held to
          the same standard by content instead of by name - it needs at least one{' '}
          <Box component="code">FROM</Box>, which every Dockerfile has by definition, and it has
          to read as Docker instructions rather than prose. Anything else is refused before it
          reaches the AI. This matters more than it sounds: a language model handed a PDF or a
          sentence will not object - it will invent a plausible Dockerfile and plausible savings
          figures, and the answer looks exactly like a real one. Refusing is the honest result.
        </Typography>

        <Divider sx={{ my: 5 }} />

        <SectionHeading eyebrow="Limits" title="Rate limiting and fallback" />
        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.85 }}>
          The AI provider's quota is per model and small. Requests are metered per model in a
          sliding window; a request that would exceed it waits for a slot or is served by the next
          model in the chain instead of being rejected. Transient failures are retried
          automatically, with the failing model put in a short cooldown so the retry lands
          elsewhere. When every candidate is exhausted the API returns <strong>429</strong> with a{' '}
          <Box component="code">Retry-After</Box> header, and says how long to wait. If a fallback
          model answered, the response says so - a substitution is never silent.
        </Typography>
      </Container>
    </Box>
  );
}

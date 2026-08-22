import {
  Box, Typography, Card, CardContent, Chip, Stack, Alert, Divider,
  LinearProgress, Link, alpha,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { Shield, AutoAwesome, Rule, OpenInNew } from '@mui/icons-material';
import type { AnalysisResult, Severity } from '../../types';

const sevColors: Record<string, string> = {
  CRITICAL: '#FF1744', HIGH: '#FF6B6B', MEDIUM: '#FBBF24', LOW: '#4ADE80', UNKNOWN: '#A1A1AA',
};

const SEV_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

export default function AnalysisDetail({ analysis }: { analysis: AnalysisResult }) {
  const origMB = (analysis.originalSize / 1024 / 1024).toFixed(0);
  const optMB = (analysis.optimizedSize / 1024 / 1024).toFixed(0);
  const savedMB = ((analysis.originalSize - analysis.optimizedSize) / 1024 / 1024).toFixed(0);

  const scanner = analysis.scanner;
  const vulns = analysis.vulnerabilities ?? [];
  const misconfigs = analysis.misconfigurations ?? [];
  const scanUnavailable = !scanner || scanner.status === 'unavailable' || scanner.status === 'disabled';
  const unscanned = (scanner?.skippedImages ?? []).filter((s) => !s.benign);
  const summary = analysis.scanSummary;
  const totalVulns = summary?.total ?? vulns.length;
  const multiPackageCves = vulns.filter((v) => (v.packages?.length ?? 1) > 1).length;
  const sevCounts: Record<string, number> = {
    CRITICAL: summary?.critical ?? 0,
    HIGH: summary?.high ?? 0,
    MEDIUM: summary?.medium ?? 0,
    LOW: summary?.low ?? 0,
    UNKNOWN: summary?.unknown ?? 0,
  };

  return (
    <>
      <Stack direction="row" spacing={0} sx={{ mb: 4, border: '1px solid', borderColor: alpha('#3F3F46', 0.4), borderRadius: 2, overflow: 'hidden' }}>
        {[
          { label: 'Original', value: `${origMB} MB`, color: '#FF6B6B' },
          { label: 'Optimized', value: `${optMB} MB`, color: '#4ADE80' },
          { label: 'Saved', value: `${savedMB} MB`, color: '#CCFF00' },
          { label: 'Reduction', value: `${analysis.savingsPercent}%`, color: '#FBBF24' },
        ].map((s, i) => (
          <Box key={s.label} sx={{ flex: 1, py: 2.5, px: 2, textAlign: 'center',
            borderRight: i < 3 ? '1px solid' : 'none', borderColor: alpha('#3F3F46', 0.4) }}>
            <Typography className="mono" sx={{ fontSize: '0.6rem', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.5 }}>{s.label}</Typography>
            <Typography sx={{ fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.value}</Typography>
          </Box>
        ))}
      </Stack>

      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: 'text.secondary', mb: 2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Size Comparison</Typography>
          <Stack spacing={1.5}>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={2}>
              <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', minWidth: 70 }}>Original</Typography>
              <Box sx={{ flexGrow: 1 }}><LinearProgress variant="determinate" value={100}
                sx={{ height: 10, borderRadius: 5, bgcolor: alpha('#FF6B6B', 0.1), '& .MuiLinearProgress-bar': { bgcolor: '#FF6B6B' } }} /></Box>
            </Stack>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={2}>
              <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', minWidth: 70 }}>Optimized</Typography>
              <Box sx={{ flexGrow: 1 }}><LinearProgress variant="determinate" value={Math.max(100 - analysis.savingsPercent, 2)}
                sx={{ height: 10, borderRadius: 5, bgcolor: alpha('#4ADE80', 0.1), '& .MuiLinearProgress-bar': { bgcolor: '#4ADE80' } }} /></Box>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        <Grid size={12}>
          <Card>
            <CardContent>
              <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }} spacing={1}>
                <AutoAwesome sx={{ color: '#CCFF00', fontSize: '1rem' }} />
                <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Optimized Dockerfile</Typography>
              </Stack>
              <Box component="pre" sx={{ p: 2.5, borderRadius: 2, overflowX: 'auto', background: '#0C0C0E',
                border: '1px solid', borderColor: alpha('#3F3F46', 0.3), fontSize: '0.78rem', lineHeight: 1.8,
                color: '#E4E4E7', fontFamily: '"JetBrains Mono", monospace', maxHeight: 420 }}>
                {analysis.optimizedDockerfile || '# Optimized Dockerfile will appear here after analysis'}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {analysis.aiInsights && (
          <Grid size={12}>
            <Card>
              <CardContent>
                <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }} spacing={1}>
                  <AutoAwesome sx={{ color: '#CCFF00', fontSize: '1rem' }} />
                  <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', letterSpacing: '0.06em', textTransform: 'uppercase' }}>AI Insights</Typography>
                </Stack>
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: alpha('#CCFF00', 0.04), border: '1px solid', borderColor: alpha('#CCFF00', 0.15) }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>{analysis.aiInsights}</Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', mb: 2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Build Stages ({analysis.stages?.length ?? 0})
              </Typography>
              {(analysis.stages ?? []).map((stage, i) => (
                <Box key={stage.id} sx={{ mb: 2 }}>
                  {i > 0 && <Divider sx={{ mb: 2, borderColor: alpha('#3F3F46', 0.3) }} />}
                  <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{stage.name || `Stage ${i + 1}`}</Typography>
                    {stage.isFinalStage && <Chip label="FINAL" size="small" sx={{ fontSize: '0.6rem', bgcolor: alpha('#CCFF00', 0.12), color: '#CCFF00', fontWeight: 700 }} />}
                  </Stack>
                  <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                    {stage.baseImage}
                  </Typography>
                  {(stage.layers ?? []).map((layer) => (
                    <Stack key={layer.id} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', py: 0.4 }}>
                      <Typography className="mono" variant="caption" sx={{ color: 'text.secondary' }} noWrap>{layer.command}</Typography>
                      <Chip label={layer.sizeHuman} size="small"
                        sx={{ fontSize: '0.6rem', bgcolor: layer.isOptimizable ? alpha('#FF6B6B', 0.1) : alpha('#4ADE80', 0.08),
                          color: layer.isOptimizable ? '#FF6B6B' : '#4ADE80', ml: 1, flexShrink: 0 }} />
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
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
                  <Shield sx={{ color: '#FF6B6B', fontSize: '1rem' }} />
                  <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#FF6B6B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Vulnerabilities ({totalVulns})
                  </Typography>
                </Stack>
                {scanner?.version && (
                  <Chip label={`trivy ${scanner.version}`} size="small"
                    sx={{ fontSize: '0.55rem', bgcolor: alpha('#CCFF00', 0.08), color: '#CCFF00', fontWeight: 700 }} />
                )}
              </Stack>

              {totalVulns > 0 && (
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
                  {SEV_ORDER.filter((s) => sevCounts[s] > 0).map((s) => (
                    <Chip key={s} label={`${s} ${sevCounts[s]}`} size="small"
                      sx={{ fontSize: '0.55rem', fontWeight: 700, color: sevColors[s],
                        bgcolor: alpha(sevColors[s], 0.1), border: '1px solid', borderColor: alpha(sevColors[s], 0.25) }} />
                  ))}
                  {(summary?.fixable ?? 0) > 0 && (
                    <Chip label={`${summary?.fixable} FIXABLE`} size="small"
                      sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#4ADE80', bgcolor: alpha('#4ADE80', 0.1) }} />
                  )}
                </Stack>
              )}

              {multiPackageCves > 0 && (
                <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mb: 1.5, lineHeight: 1.6 }}>
                  {multiPackageCves} of these CVEs affect more than one package - a single flaw in a
                  source package shows up in every binary built from it. Each is listed once, with all
                  affected packages inside, rather than repeated per package.
                </Typography>
              )}

              {scanUnavailable ? (
                <Alert severity="warning" sx={{ bgcolor: alpha('#FBBF24', 0.06), border: '1px solid', borderColor: alpha('#FBBF24', 0.25) }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                    {scanner?.status === 'disabled' ? 'Scanning disabled' : 'Scan unavailable'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {scanner?.errors?.[0] ?? 'Trivy could not run, so this Dockerfile has not been scanned.'}
                  </Typography>
                </Alert>
              ) : totalVulns === 0 ? (
                <Alert severity="success" sx={{ bgcolor: alpha('#4ADE80', 0.06), border: '1px solid', borderColor: alpha('#4ADE80', 0.2) }}>
                  <Typography variant="caption">
                    No known CVEs in {scanner?.scannedImages?.length ? scanner.scannedImages.join(', ') : 'the scanned base images'}
                  </Typography>
                </Alert>
              ) : null}

              {!scanUnavailable && (unscanned.length > 0 || scanner?.truncated) && (
                <Alert severity="info" sx={{ mt: 1.5, bgcolor: alpha('#38BDF8', 0.06), border: '1px solid', borderColor: alpha('#38BDF8', 0.2) }}>
                  {scanner?.truncated && (
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      Listing the {summary?.displayed ?? vulns.length} highest-severity of {totalVulns} findings.
                      Counts above cover the full scan.
                    </Typography>
                  )}
                  {unscanned.map((s) => (
                    <Typography key={s.image} className="mono" variant="caption" sx={{ display: 'block', fontSize: '0.65rem' }}>
                      {s.image} not scanned - {s.reason}
                    </Typography>
                  ))}
                </Alert>
              )}

              <Box sx={{ maxHeight: 420, overflowY: 'auto', mt: vulns.length ? 0 : 1.5 }}>
                {vulns.map((v) => {
                  const pkgs = v.packages?.length
                    ? v.packages
                    : [{ name: v.package, installedVersion: v.installedVersion, fixedVersion: v.fixedVersion }];
                  const targets = v.targets?.length ? v.targets : v.target ? [v.target] : [];
                  return (
                    <Box key={v.id} sx={{ p: 1.5, mb: 1.5, borderRadius: 2, border: '1px solid', borderColor: alpha(sevColors[v.severity] ?? '#fff', 0.2),
                      bgcolor: alpha(sevColors[v.severity] ?? '#fff', 0.04) }}>
                      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mb: 0.75 }}>
                        <Chip label={v.severity} size="small" sx={{ bgcolor: sevColors[v.severity], color: '#fff', fontSize: '0.6rem', fontWeight: 700 }} />
                        {v.referenceUrl ? (
                          <Link href={v.referenceUrl} target="_blank" rel="noopener noreferrer" className="mono"
                            sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#CCFF00', display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
                            {v.cveId}<OpenInNew sx={{ fontSize: '0.7rem' }} />
                          </Link>
                        ) : (
                          <Typography className="mono" variant="caption" sx={{ fontWeight: 700 }}>{v.cveId}</Typography>
                        )}
                        {pkgs.length > 1 && (
                          <Chip label={`${pkgs.length} packages`} size="small"
                            sx={{ fontSize: '0.55rem', fontWeight: 700, height: 18, bgcolor: alpha('#A1A1AA', 0.14), color: '#D4D4D8' }} />
                        )}
                      </Stack>

                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>{v.description}</Typography>

                      {pkgs.map((p) => (
                        <Stack key={`${p.name}@${p.installedVersion}`} direction="row"
                          sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 1, py: 0.2 }}>
                          <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }} noWrap>
                            {p.name}{p.installedVersion ? ` @ ${p.installedVersion}` : ''}
                          </Typography>
                          <Typography className="mono" variant="caption" sx={{ flexShrink: 0, fontSize: '0.62rem',
                            color: p.fixedVersion ? '#4ADE80' : 'text.disabled' }}>
                            {p.fixedVersion ? `→ ${p.fixedVersion}` : 'no fix'}
                          </Typography>
                        </Stack>
                      ))}

                      {targets.length > 0 && (
                        <Typography className="mono" variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: '0.6rem', mt: 0.5 }}>
                          {targets.join(', ')}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={12}>
          <Card>
            <CardContent>
              <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }} spacing={1}>
                <Rule sx={{ color: '#FBBF24', fontSize: '1rem' }} />
                <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#FBBF24', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Dockerfile Misconfigurations ({misconfigs.length})
                </Typography>
              </Stack>
              {misconfigs.length === 0 ? (
                <Typography variant="caption" sx={{ color: scanUnavailable ? 'text.secondary' : '#4ADE80' }}>
                  {scanUnavailable
                    ? 'Dockerfile was not scanned for misconfigurations.'
                    : 'No misconfigurations found - Dockerfile passed every Trivy check.'}
                </Typography>
              ) : (
                <Grid container spacing={1.5}>
                  {misconfigs.map((m) => (
                    <Grid size={{ xs: 12, md: 6 }} key={m.id}>
                      <Box sx={{ p: 1.5, height: '100%', borderRadius: 2, border: '1px solid',
                        borderColor: alpha(sevColors[m.severity] ?? '#fff', 0.2), bgcolor: alpha(sevColors[m.severity] ?? '#fff', 0.04) }}>
                        <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mb: 0.5 }}>
                          <Chip label={m.severity} size="small" sx={{ bgcolor: sevColors[m.severity], color: '#fff', fontSize: '0.6rem', fontWeight: 700 }} />
                          {m.referenceUrl ? (
                            <Link href={m.referenceUrl} target="_blank" rel="noopener noreferrer" className="mono"
                              sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#CCFF00', display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
                              {m.checkId}<OpenInNew sx={{ fontSize: '0.7rem' }} />
                            </Link>
                          ) : (
                            <Typography className="mono" variant="caption" sx={{ fontWeight: 700 }}>{m.checkId}</Typography>
                          )}
                          {!!m.line && (
                            <Typography className="mono" variant="caption" sx={{ color: 'text.disabled', fontSize: '0.6rem' }}>line {m.line}</Typography>
                          )}
                        </Stack>
                        <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{m.title}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{m.description}</Typography>
                        {m.resolution && (
                          <Typography variant="caption" sx={{ color: '#4ADE80', display: 'block', mt: 0.5 }}>{m.resolution}</Typography>
                        )}
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

      </Grid>
    </>
  );
}

export function downloadOptimizedDockerfile(analysis: AnalysisResult): void {
  if (!analysis.optimizedDockerfile) return;
  const blob = new Blob([analysis.optimizedDockerfile], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Dockerfile.optimized';
  a.click();
  URL.revokeObjectURL(url);
}

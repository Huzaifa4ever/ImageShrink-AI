import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Container, Typography, Card, CardContent, Chip, IconButton, Stack,
  CircularProgress, Alert, Dialog, DialogContent, DialogTitle, Button, Divider,
  TextField, ToggleButtonGroup, ToggleButton, MenuItem, Select, Pagination,
  Tooltip, alpha,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Delete, OpenInNew, AccessTime, Close, Download, LaunchOutlined, Search,
  Star, StarBorder, Code, Language,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import AnalysisDetail, { downloadOptimizedDockerfile } from '../components/analysis/AnalysisDetail';
import { dockerService } from '../services/dockerService';
import { apiErrorMessage } from '../services/api';
import type { AnalysisListItem, AnalysisResult, HistoryQuery } from '../types';

const LIME = '#CCFF00';
const PAGE_SIZE = 12;

const SEARCH_DEBOUNCE_MS = 350;

type SourceFilter = 'all' | 'web' | 'vscode';
type SortOption = NonNullable<HistoryQuery['sort']>;

const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  savings: 'Biggest saving',
  score: 'Worst score first',
};

export default function HistoryPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState<AnalysisListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>('newest');
  const [page, setPage] = useState(1);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AnalysisResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [query, source, favoritesOnly, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dockerService.getHistory({
        q: query,
        source,
        sort,
        page,
        pageSize: PAGE_SIZE,
        ...(favoritesOnly ? { favorite: true } : {}),
      });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load history.'));
    } finally {
      setLoading(false);
    }
  }, [query, source, sort, page, favoritesOnly]);

  useEffect(() => { void load(); }, [load]);

  const openAnalysis = useCallback(async (id: string) => {
    setOpenId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await dockerService.getAnalysis(id);
      setDetail(res.data);
    } catch (err) {
      setDetailError(apiErrorMessage(err, 'Could not load this analysis.'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await dockerService.deleteAnalysis(id);
      if (openId === id) setOpenId(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete analysis.'));
    }
  };

  const toggleFavorite = async (item: AnalysisListItem) => {
    const next = !item.favorite;
    setItems((prev) => prev.map((r) => (r._id === item._id ? { ...r, favorite: next } : r)));
    try {
      await dockerService.setFavorite(item._id, next);
      if (favoritesOnly && !next) await load();
    } catch (err) {
      setItems((prev) => prev.map((r) => (r._id === item._id ? { ...r, favorite: item.favorite } : r)));
      setError(apiErrorMessage(err, 'Could not update that favourite.'));
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = query !== '' || source !== 'all' || favoritesOnly;

  const summary = useMemo(() => {
    if (loading) return 'Loading…';
    if (total === 0) return filtersActive ? 'No matches' : 'No analyses yet';
    const range = `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)}`;
    return `Showing ${range} of ${total}`;
  }, [loading, total, page, filtersActive]);

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="lg" sx={{ pt: 8, pb: 12 }}>
        <Box sx={{ mb: 4 }}>
          <Typography className="mono" sx={{ fontSize: '0.7rem', color: LIME, mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            History
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 700, mb: 1, fontSize: { xs: '1.6rem', md: '2rem' } }}>
            Past Analyses
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Everything you have analysed, from the web app and from VS Code. Click a card to
            reopen the full report.
          </Typography>
        </Box>

        <Stack spacing={2} sx={{ mb: 3 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
            <TextField
              size="small"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by filename or summary"
              slotProps={{
                input: {
                  startAdornment: <Search sx={{ fontSize: '1.1rem', color: 'text.secondary', mr: 1 }} />,
                  endAdornment: search ? (
                    <IconButton size="small" onClick={() => setSearch('')} sx={{ color: 'text.secondary' }}>
                      <Close sx={{ fontSize: 16 }} />
                    </IconButton>
                  ) : undefined,
                },
              }}
              sx={{ flex: 1 }}
            />

            <Select
              size="small"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              sx={{ minWidth: 180, fontSize: '0.85rem' }}
            >
              {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                <MenuItem key={option} value={option} sx={{ fontSize: '0.85rem' }}>
                  {SORT_LABELS[option]}
                </MenuItem>
              ))}
            </Select>
          </Stack>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={source}
              onChange={(_, value) => { if (value) setSource(value as SourceFilter); }}
            >
              <ToggleButton value="all" sx={{ fontSize: '0.72rem', px: 1.75 }}>All sources</ToggleButton>
              <ToggleButton value="web" sx={{ fontSize: '0.72rem', px: 1.75 }}>Web</ToggleButton>
              <ToggleButton value="vscode" sx={{ fontSize: '0.72rem', px: 1.75 }}>VS Code</ToggleButton>
            </ToggleButtonGroup>

            <ToggleButtonGroup
              size="small"
              value={favoritesOnly ? ['favorites'] : []}
              onChange={() => setFavoritesOnly((prev) => !prev)}
            >
              <ToggleButton value="favorites" sx={{ fontSize: '0.72rem', px: 1.75 }}>
                {favoritesOnly ? <Star sx={{ fontSize: 15, mr: 0.6, color: LIME }} /> : <StarBorder sx={{ fontSize: 15, mr: 0.6 }} />}
                Favourites
              </ToggleButton>
            </ToggleButtonGroup>

            <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', ml: { sm: 'auto' } }}>
              {summary}
            </Typography>
          </Stack>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress sx={{ color: LIME }} />
          </Box>
        ) : items.length === 0 ? (
          <Card sx={{ textAlign: 'center', py: 8 }}>
            <CardContent>
              <Typography variant="h6" sx={{ color: 'text.secondary', mb: 1 }}>
                {filtersActive ? 'Nothing matches those filters' : 'No analyses yet'}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
                {filtersActive
                  ? 'Try a different search, or clear the filters.'
                  : 'Upload your first Dockerfile from the workbench, or analyse one from VS Code.'}
              </Typography>
              {filtersActive ? (
                <Button
                  variant="outlined"
                  onClick={() => { setSearch(''); setSource('all'); setFavoritesOnly(false); }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="contained" onClick={() => navigate('/workbench')}>Go to workbench</Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <Grid container spacing={2.5}>
              {items.map((item) => {
                const cves = item.scanSummary?.total ?? 0;
                const misconfigs = item.scanSummary?.misconfigurations ?? 0;
                const notScanned =
                  !item.scanner || item.scanner.status === 'unavailable' || item.scanner.status === 'disabled';

                return (
                  <Grid key={item._id} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Card
                      onClick={() => openAnalysis(item._id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAnalysis(item._id); } }}
                      sx={{
                        height: '100%', cursor: 'pointer',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        '&:hover': { borderColor: alpha(LIME, 0.3), transform: 'translateY(-2px)' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: alpha(LIME, 0.6), outlineOffset: 2 },
                      }}
                    >
                      <CardContent>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700, maxWidth: '60%' }}>
                            {item.filename}
                          </Typography>
                          <Stack direction="row">
                            <IconButton
                              size="small"
                              title={item.favorite ? 'Remove from favourites' : 'Add to favourites'}
                              onClick={(e) => { e.stopPropagation(); void toggleFavorite(item); }}
                              sx={{ color: item.favorite ? LIME : 'text.secondary', '&:hover': { color: LIME } }}
                            >
                              {item.favorite ? <Star sx={{ fontSize: 16 }} /> : <StarBorder sx={{ fontSize: 16 }} />}
                            </IconButton>
                            <IconButton size="small" title="Open full page"
                              onClick={(e) => { e.stopPropagation(); navigate(`/analysis/${item._id}`); }}
                              sx={{ color: 'text.secondary', '&:hover': { color: LIME } }}>
                              <OpenInNew sx={{ fontSize: 16 }} />
                            </IconButton>
                            <IconButton size="small" title="Delete"
                              onClick={(e) => { e.stopPropagation(); void handleDelete(item._id); }}
                              sx={{ color: 'text.secondary', '&:hover': { color: '#FF6B6B' } }}>
                              <Delete sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Stack>
                        </Stack>

                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 0.5, mb: 2 }}>
                          <Tooltip title={item.source === 'vscode' ? 'Analysed in VS Code' : 'Analysed in the web app'}>
                            <Box sx={{ display: 'flex', color: item.source === 'vscode' ? LIME : 'text.secondary' }}>
                              {item.source === 'vscode'
                                ? <Code sx={{ fontSize: 13 }} />
                                : <Language sx={{ fontSize: 13 }} />}
                            </Box>
                          </Tooltip>
                          <AccessTime sx={{ fontSize: 12, color: 'text.secondary' }} />
                          <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                            {new Date(item.createdAt).toLocaleString()}
                          </Typography>
                        </Stack>

                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                          <Chip
                            label={`${(item.originalSize / 1024 / 1024).toFixed(0)} → ${(item.optimizedSize / 1024 / 1024).toFixed(0)} MB`}
                            size="small" sx={{ bgcolor: alpha(LIME, 0.08), color: LIME }} />
                          <Chip label={`-${item.savingsPercent}%`} size="small"
                            sx={{ bgcolor: alpha('#4ADE80', 0.08), color: '#4ADE80', fontWeight: 700 }} />
                        </Stack>

                        <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                          {/* Older analyses predate the deterministic scores, so a 0 here means
                              "not recorded" rather than a genuinely terrible Dockerfile. */}
                          {item.optimizationScore > 0 && (
                            <Chip label={`opt ${item.optimizationScore}`} size="small"
                              sx={{ bgcolor: alpha('#7DD3FC', 0.08), color: '#7DD3FC' }} />
                          )}
                          {cves > 0 && (
                            <Chip label={`${cves} CVE${cves !== 1 ? 's' : ''}`}
                              size="small" sx={{ bgcolor: alpha('#FF6B6B', 0.08), color: '#FF6B6B' }} />
                          )}
                          {misconfigs > 0 && (
                            <Chip label={`${misconfigs} misconfig`}
                              size="small" sx={{ bgcolor: alpha('#FBBF24', 0.08), color: '#FBBF24' }} />
                          )}
                          {notScanned && (
                            <Chip label="not scanned" size="small"
                              sx={{ bgcolor: alpha('#A1A1AA', 0.1), color: '#A1A1AA' }} />
                          )}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>

            {pageCount > 1 && (
              <Stack sx={{ alignItems: 'center', mt: 5 }}>
                <Pagination
                  count={pageCount}
                  page={page}
                  onChange={(_, value) => {
                    setPage(value);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  shape="rounded"
                  sx={{
                    '& .Mui-selected': {
                      bgcolor: `${alpha(LIME, 0.15)} !important`,
                      color: LIME,
                    },
                  }}
                />
              </Stack>
            )}
          </>
        )}
      </Container>

      {/* Full report for the clicked card */}
      <Dialog
        open={openId !== null}
        onClose={() => setOpenId(null)}
        fullWidth
        maxWidth="lg"
        scroll="paper"
        slotProps={{
          paper: {
            sx: {
              bgcolor: '#09090B', backgroundImage: 'none',
              border: '1px solid', borderColor: alpha('#3F3F46', 0.6), borderRadius: 3,
            },
          },
        }}
      >
        <DialogTitle sx={{ pb: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
                {detail?.filename ?? items.find((h) => h._id === openId)?.filename ?? 'Analysis'}
              </Typography>
              <Typography className="mono" variant="caption" sx={{ color: 'text.secondary' }}>
                {(() => {
                  const created = detail?.createdAt ?? items.find((h) => h._id === openId)?.createdAt;
                  return created ? new Date(created).toLocaleString() : '';
                })()}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
              {detail && (
                <>
                  <IconButton size="small" title="Download optimized Dockerfile"
                    onClick={() => downloadOptimizedDockerfile(detail)}
                    sx={{ color: 'text.secondary', '&:hover': { color: LIME } }}>
                    <Download sx={{ fontSize: 18 }} />
                  </IconButton>
                  <IconButton size="small" title="Open as a full page"
                    onClick={() => navigate(`/analysis/${detail._id}`)}
                    sx={{ color: 'text.secondary', '&:hover': { color: LIME } }}>
                    <LaunchOutlined sx={{ fontSize: 18 }} />
                  </IconButton>
                </>
              )}
              <IconButton size="small" onClick={() => setOpenId(null)} title="Close"
                sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                <Close sx={{ fontSize: 18 }} />
              </IconButton>
            </Stack>
          </Stack>
        </DialogTitle>
        <Divider sx={{ borderColor: alpha('#3F3F46', 0.4) }} />
        <DialogContent sx={{ pt: 3 }}>
          {detailLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress sx={{ color: LIME }} />
            </Box>
          )}
          {detailError && <Alert severity="error">{detailError}</Alert>}
          {detail && <AnalysisDetail analysis={detail} />}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

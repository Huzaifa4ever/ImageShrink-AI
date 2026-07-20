import { useState } from 'react';
import {
  AppBar, Toolbar, Typography, Button, IconButton,
  Drawer, List, ListItem, ListItemButton, ListItemText,
  Box, Chip, useMediaQuery, useTheme, alpha,
} from '@mui/material';
import { Menu as MenuIcon, Close as CloseIcon } from '@mui/icons-material';
import { useNavigate, useLocation, Link } from 'react-router-dom';

const navLinks = [
  { label: 'Workbench', path: '/workbench' },
  { label: 'History', path: '/history' },
];

export default function Navbar() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ px: { xs: 2, md: 4 }, minHeight: '68px !important' }}>

          <Box
            component={Link}
            to="/"
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none', flexGrow: 1 }}
          >
            <Box
              sx={{
                width: 36, height: 36, borderRadius: '10px',
                background: 'linear-gradient(135deg, #6C63FF, #00D4AA)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.1rem', fontWeight: 800,
              }}
            >
              🐳
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary' }}>
              Image<span style={{ color: '#6C63FF' }}>Shrink</span>
              <Chip label="AI" size="small" sx={{ ml: 1, height: 20, fontSize: '0.65rem', background: 'linear-gradient(135deg, #6C63FF, #00D4AA)', color: '#fff' }} />
            </Typography>
          </Box>

          {!isMobile && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {navLinks.map((link) => (
                <Button
                  key={link.path}
                  onClick={() => navigate(link.path)}
                  sx={{
                    color: location.pathname === link.path ? 'primary.main' : 'text.secondary',
                    backgroundColor: location.pathname === link.path
                      ? alpha('#6C63FF', 0.12) : 'transparent',
                    '&:hover': { color: 'text.primary', backgroundColor: alpha('#6C63FF', 0.08) },
                    px: 2,
                  }}
                >
                  {link.label}
                </Button>
              ))}
              <Button
                variant="contained"
                onClick={() => navigate('/workbench')}
                sx={{ ml: 1 }}
              >
                Try It Free
              </Button>
            </Box>
          )}

          {isMobile && (
            <IconButton onClick={() => setDrawerOpen(true)} sx={{ color: 'text.primary' }}>
              <MenuIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: 260, bgcolor: 'background.paper', borderLeft: '1px solid', borderColor: 'divider' } }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1.5 }}>
          <IconButton onClick={() => setDrawerOpen(false)}><CloseIcon /></IconButton>
        </Box>
        <List>
          {navLinks.map((link) => (
            <ListItem key={link.path} disablePadding>
              <ListItemButton
                onClick={() => { navigate(link.path); setDrawerOpen(false); }}
                selected={location.pathname === link.path}
              >
                <ListItemText primary={link.label} />
              </ListItemButton>
            </ListItem>
          ))}
          <ListItem sx={{ mt: 2, px: 2 }}>
            <Button variant="contained" fullWidth onClick={() => { navigate('/workbench'); setDrawerOpen(false); }}>
              Try It Free
            </Button>
          </ListItem>
        </List>
      </Drawer>
    </>
  );
}

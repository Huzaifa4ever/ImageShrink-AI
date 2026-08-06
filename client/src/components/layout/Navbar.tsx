import { useState } from 'react';
import {
  AppBar, Toolbar, Typography, Button, IconButton, Avatar, Menu, MenuItem,
  Drawer, List, ListItem, ListItemButton, ListItemText, ListItemIcon,
  Box, Divider, useMediaQuery, useTheme, alpha,
} from '@mui/material';
import {
  Menu as MenuIcon, Close as CloseIcon, Settings as SettingsIcon,
  Logout as LogoutIcon, ExpandMore,
} from '@mui/icons-material';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const privateLinks = [
  { label: 'Workbench', path: '/workbench' },
  { label: 'History', path: '/history' },
];

const publicLinks = [
  { label: 'VS Code Extension', path: '/extension' },
  { label: 'Documentation', path: '/docs' },
];

export default function Navbar() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuth();

  const closeAll = () => { setMenuAnchor(null); setDrawerOpen(false); };

  const go = (path: string) => { closeAll(); navigate(path); };

  const handleLogout = async () => {
    closeAll();
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ px: { xs: 2, md: 4 }, minHeight: '64px !important' }}>
          <Box
            component={Link}
            to="/"
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none', flexGrow: 1 }}
          >
            <Box
              sx={{
                width: 32, height: 32, borderRadius: '8px',
                background: '#CCFF00',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.9rem', fontWeight: 800, color: '#000',
              }}
            >
              IS
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '1rem' }}>
              ImageShrink
              <Box component="span" sx={{ color: '#CCFF00', ml: 0.3 }}>.ai</Box>
            </Typography>
          </Box>

          {!isMobile && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {[...(isAuthenticated ? privateLinks : []), ...publicLinks].map((link) => (
                <Button
                  key={link.path}
                  onClick={() => navigate(link.path)}
                  sx={{
                    color: location.pathname === link.path ? '#CCFF00' : 'text.secondary',
                    fontSize: '0.8rem',
                    fontFamily: '"JetBrains Mono", monospace',
                    letterSpacing: '0.04em',
                    px: 2,
                    whiteSpace: 'nowrap',
                    '&:hover': { color: '#CCFF00', bgcolor: alpha('#CCFF00', 0.05) },
                  }}
                >
                  {link.label}
                </Button>
              ))}

              {isAuthenticated ? (
                <Button
                  onClick={(e) => setMenuAnchor(e.currentTarget)}
                  endIcon={<ExpandMore sx={{ fontSize: '1rem !important' }} />}
                  sx={{
                    ml: 1.5, pl: 0.75, pr: 1.25, py: 0.5, gap: 0.75,
                    color: 'text.primary', fontSize: '0.8rem', fontWeight: 600,
                    border: '1px solid', borderColor: alpha('#3F3F46', 0.6), borderRadius: 2,
                    '&:hover': { borderColor: alpha('#CCFF00', 0.4), bgcolor: alpha('#CCFF00', 0.04) },
                  }}
                >
                  <Avatar sx={{ width: 24, height: 24, bgcolor: '#CCFF00', color: '#000', fontSize: '0.7rem', fontWeight: 800 }}>
                    {user?.username.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box component="span" sx={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.username}
                  </Box>
                </Button>
              ) : (
                <>
                  <Button
                    onClick={() => navigate('/login')}
                    sx={{
                      color: 'text.secondary', fontSize: '0.8rem',
                      fontFamily: '"JetBrains Mono", monospace', px: 2,
                      '&:hover': { color: '#CCFF00', bgcolor: alpha('#CCFF00', 0.05) },
                    }}
                  >
                    Sign In
                  </Button>
                  <Button variant="contained" onClick={() => navigate('/signup')} sx={{ ml: 1.5, fontSize: '0.8rem' }}>
                    Get Started
                  </Button>
                </>
              )}
            </Box>
          )}

          {isMobile && (
            <IconButton onClick={() => setDrawerOpen(true)} sx={{ color: 'text.primary' }}>
              <MenuIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1, minWidth: 220, bgcolor: '#18181B',
              border: '1px solid', borderColor: alpha('#3F3F46', 0.6), borderRadius: 2,
            },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{user?.username}</Typography>
          <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }} noWrap>
            {user?.email}
          </Typography>
        </Box>
        <Divider sx={{ borderColor: alpha('#3F3F46', 0.5) }} />
        <MenuItem onClick={() => go('/settings')} sx={{ fontSize: '0.85rem', py: 1.1 }}>
          <ListItemIcon sx={{ minWidth: '32px !important' }}>
            <SettingsIcon sx={{ fontSize: '1.05rem', color: 'text.secondary' }} />
          </ListItemIcon>
          Settings
        </MenuItem>
        <MenuItem onClick={handleLogout} sx={{ fontSize: '0.85rem', py: 1.1, color: '#FF6B6B' }}>
          <ListItemIcon sx={{ minWidth: '32px !important' }}>
            <LogoutIcon sx={{ fontSize: '1.05rem', color: '#FF6B6B' }} />
          </ListItemIcon>
          Logout
        </MenuItem>
      </Menu>

      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{
          '& .MuiDrawer-paper': {
            width: 280, bgcolor: '#09090B',
            borderLeft: '1px solid', borderColor: alpha('#3F3F46', 0.4),
          },
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1.5 }}>
          <IconButton onClick={() => setDrawerOpen(false)} sx={{ color: 'text.secondary' }}>
            <CloseIcon />
          </IconButton>
        </Box>

        {isAuthenticated && (
          <Box sx={{ px: 2.5, pb: 2 }}>
            <DrawerIdentity username={user?.username ?? ''} email={user?.email ?? ''} />
          </Box>
        )}

        <List>
          {[...(isAuthenticated ? privateLinks : []), ...publicLinks].map((link) => (
            <ListItem key={link.path} disablePadding>
              <ListItemButton
                onClick={() => go(link.path)}
                selected={location.pathname === link.path}
                sx={{
                  '&.Mui-selected': { bgcolor: alpha('#CCFF00', 0.06), color: '#CCFF00' },
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <ListItemText primary={link.label} slotProps={{ primary: { sx: { fontSize: '0.85rem' } } }} />
              </ListItemButton>
            </ListItem>
          ))}

          {isAuthenticated ? (
            <>
              <ListItem disablePadding>
                <ListItemButton onClick={() => go('/settings')} selected={location.pathname === '/settings'}
                  sx={{ '&.Mui-selected': { bgcolor: alpha('#CCFF00', 0.06), color: '#CCFF00' } }}>
                  <ListItemIcon sx={{ minWidth: '34px !important' }}>
                    <SettingsIcon sx={{ fontSize: '1.05rem', color: 'text.secondary' }} />
                  </ListItemIcon>
                  <ListItemText primary="Settings" slotProps={{ primary: { sx: { fontSize: '0.85rem' } } }} />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding>
                <ListItemButton onClick={handleLogout}>
                  <ListItemIcon sx={{ minWidth: '34px !important' }}>
                    <LogoutIcon sx={{ fontSize: '1.05rem', color: '#FF6B6B' }} />
                  </ListItemIcon>
                  <ListItemText primary="Logout" slotProps={{ primary: { sx: { fontSize: '0.85rem', color: '#FF6B6B' } } }} />
                </ListItemButton>
              </ListItem>
            </>
          ) : (
            <>
              <ListItem disablePadding>
                <ListItemButton onClick={() => go('/login')}>
                  <ListItemText primary="Sign In" slotProps={{ primary: { sx: { fontSize: '0.85rem' } } }} />
                </ListItemButton>
              </ListItem>
              <ListItem sx={{ mt: 2, px: 2 }}>
                <Button variant="contained" fullWidth onClick={() => go('/signup')}>
                  Get Started
                </Button>
              </ListItem>
            </>
          )}
        </List>
      </Drawer>
    </>
  );
}

function DrawerIdentity({ username, email }: { username: string; email: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Avatar sx={{ width: 36, height: 36, bgcolor: '#CCFF00', color: '#000', fontSize: '0.95rem', fontWeight: 800 }}>
        {username.charAt(0).toUpperCase()}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{username}</Typography>
        <Typography className="mono" variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }} noWrap>
          {email}
        </Typography>
      </Box>
    </Box>
  );
}

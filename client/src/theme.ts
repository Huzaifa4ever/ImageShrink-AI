import { createTheme, alpha } from '@mui/material/styles';

const LIME = '#CCFF00';
const ZINC_950 = '#09090B';
const ZINC_900 = '#18181B';
const ZINC_800 = '#27272A';
const ZINC_700 = '#3F3F46';
const ZINC_400 = '#A1A1AA';
const ZINC_200 = '#E4E4E7';
const ZINC_50 = '#FAFAFA';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: LIME,
      light: '#E0FF4D',
      dark: '#A3CC00',
      contrastText: '#000',
    },
    secondary: {
      main: '#FF6B6B',
      light: '#FF9999',
      dark: '#CC5555',
    },
    error: { main: '#FF6B6B' },
    warning: { main: '#FBBF24' },
    success: { main: '#4ADE80' },
    background: {
      default: ZINC_950,
      paper: ZINC_900,
    },
    text: {
      primary: ZINC_50,
      secondary: ZINC_400,
    },
    divider: alpha(ZINC_700, 0.5),
  },
  typography: {
    fontFamily: '"Space Grotesk", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700, letterSpacing: '-0.04em' },
    h2: { fontWeight: 700, letterSpacing: '-0.03em' },
    h3: { fontWeight: 600, letterSpacing: '-0.02em' },
    h4: { fontWeight: 600, letterSpacing: '-0.01em' },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: '0.02em' },
    caption: { fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.04em' },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: ZINC_900,
          border: `1px solid ${alpha(ZINC_700, 0.4)}`,
          backdropFilter: 'blur(12px)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          padding: '10px 24px',
          fontSize: '0.875rem',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        },
      },
      variants: [
        {
          props: { variant: 'contained', color: 'primary' },
          style: {
            background: LIME,
            color: '#000',
            fontWeight: 700,
            boxShadow: `0 0 20px ${alpha(LIME, 0.3)}`,
            '&:hover': {
              background: '#E0FF4D',
              boxShadow: `0 0 32px ${alpha(LIME, 0.5)}`,
              transform: 'translateY(-1px)',
            },
          },
        },
        {
          props: { variant: 'outlined' },
          style: {
            borderColor: alpha(ZINC_700, 0.6),
            color: ZINC_200,
            '&:hover': {
              borderColor: LIME,
              color: LIME,
              backgroundColor: alpha(LIME, 0.05),
            },
          },
        },
      ],
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem', letterSpacing: '0.03em' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', backgroundColor: ZINC_900 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: alpha(ZINC_950, 0.8),
          backdropFilter: 'blur(24px)',
          borderBottom: `1px solid ${alpha(ZINC_700, 0.3)}`,
          boxShadow: 'none',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 4, height: 6 },
      },
    },
  },
});

export default theme;

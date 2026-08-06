import { Box, Container, Typography, Button } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Box sx={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
      <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
        <Typography className="accent-text" sx={{ fontSize: '8rem', fontWeight: 900, lineHeight: 1, fontFamily: '"Space Grotesk", sans-serif' }}>
          404
        </Typography>
        <Typography variant="h5" sx={{ mt: 2, mb: 1, fontWeight: 700 }}>Page not found</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
          The page you're looking for doesn't exist or has been moved.
        </Typography>
        <Button variant="contained" startIcon={<ArrowBack />} onClick={() => navigate('/')}>
          Back to Home
        </Button>
      </Container>
    </Box>
  );
}

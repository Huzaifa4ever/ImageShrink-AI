import type { ReactNode } from 'react';
import { Box, Card, CardContent, Container, Typography, alpha } from '@mui/material';

export default function AuthLayout({
  eyebrow, title, subtitle, children, footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <Container maxWidth="sm" sx={{ pt: { xs: 6, md: 10 }, pb: 12 }}>
        <Card sx={{ border: '1px solid', borderColor: alpha('#3F3F46', 0.5) }}>
          <CardContent sx={{ p: { xs: 3, md: 4.5 } }}>
            <Typography className="mono" sx={{ fontSize: '0.7rem', color: '#CCFF00', mb: 1, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {eyebrow}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.75, fontSize: { xs: '1.5rem', md: '1.8rem' } }}>
              {title}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3.5 }}>
              {subtitle}
            </Typography>

            {children}

            <Box sx={{ mt: 3, pt: 2.5, borderTop: '1px solid', borderColor: alpha('#3F3F46', 0.4), textAlign: 'center' }}>
              {footer}
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

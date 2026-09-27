/**
 * ProInspect Design Tokens & Theme Configuration
 * Extracted from proinspect.systems branding specification.
 * Western Australia Property Inspections & Scheduling.
 */

export const theme = {
  colors: {
    // Brand Primaries
    brandNavy: '#0A2540',
    brandNavyDark: '#071A2E',
    brandNavyLight: '#13355C',
    
    // Brand Accent & Actions
    accentBlue: '#0284C7',
    accentBlueHover: '#0369A1',
    accentBlueLight: '#E0F2FE',
    accentBlueSubtle: '#F0F9FF',
    
    // Neutrals & Surfaces
    pageBackground: '#F8FAFC',
    surfaceCard: '#FFFFFF',
    surfaceMuted: '#F1F5F9',
    
    // Text Hierarchy
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    textInverse: '#FFFFFF',
    
    // Borders
    borderSubtle: '#E2E8F0',
    borderMedium: '#CBD5E1',
    borderFocus: '#0284C7',
    
    // Feedback & Badges
    success: '#059669',
    successLight: '#ECFDF5',
    warning: '#D97706',
    warningLight: '#FFFBEB',
    danger: '#DC2626',
    dangerLight: '#FEF2F2',
  },
  typography: {
    fontSans: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
  borderRadius: {
    sm: '0.375rem', // 6px
    md: '0.5rem',   // 8px
    lg: '0.75rem',  // 12px
    xl: '1rem',     // 16px
    full: '9999px',
  },
  shadows: {
    card: '0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.04)',
    cardHover: '0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 2px 6px -2px rgba(15, 23, 42, 0.04)',
    elevated: '0 10px 25px -5px rgba(10, 37, 64, 0.12), 0 8px 10px -6px rgba(10, 37, 64, 0.08)',
  },
  dimensions: {
    containerWidth: 'max-w-4xl', // Centered ProInspect standard content container
    inputHeight: 'h-11',
    buttonHeight: 'h-11',
  },
  locale: {
    timezone: 'Australia/Perth',
    code: 'en-AU',
  }
} as const;

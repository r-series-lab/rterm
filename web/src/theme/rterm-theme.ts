import { alpha, createTheme } from '@mui/material/styles';

export type RTermStyleMode = 'dark' | 'light';

const fontFamily = [
  '"SF Pro Display"',
  '"Avenir Next"',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  'sans-serif',
].join(', ');

const darkTokens = {
  selection: 'rgba(245, 243, 238, 0.24)',
  appBackground: '#070c12',
  appBackgroundImage: 'none',
  paper: 'rgba(16, 24, 34, 0.86)',
  paperSolid: 'rgba(16, 24, 34, 0.82)',
  paperGradient: 'none',
  border: 'rgba(139,169,208,0.15)',
  borderStrong: 'rgba(139,169,208,0.28)',
  subtle: 'rgba(116,151,196,0.075)',
  subtleHover: 'rgba(116,151,196,0.12)',
  primaryText: '#f4f7fb',
  secondaryText: '#9daabc',
  buttonText: '#f7fbff',
  buttonBackground: '#3d7df4',
  buttonHoverBackground: '#4f8cff',
  shadow: '0 20px 46px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)',
  accent: '#4f8cff',
  accentHover: '#6aa0ff',
  accentText: '#cfe0ff',
  accentSoft: 'rgba(79,140,255,0.06)',
  accentBorder: 'rgba(79,140,255,0.22)',
  local: '#45c4ff',
  localSoft: 'rgba(69,196,255,0.045)',
  localBorder: 'rgba(69,196,255,0.2)',
  remote: '#6f8cff',
  remoteSoft: 'rgba(111,140,255,0.045)',
  remoteBorder: 'rgba(111,140,255,0.2)',
  success: '#54d98f',
  successSoft: 'rgba(84,217,143,0.075)',
  warning: '#f2bc5b',
  warningSoft: 'rgba(242,188,91,0.08)',
  danger: '#ff7d7d',
  dangerSoft: 'rgba(255,125,125,0.075)',
  panelHighlight: 'rgba(111,160,255,0.08)',
};

const lightTokens = {
  selection: 'rgba(34, 36, 40, 0.16)',
  appBackground: '#f2f6fb',
  appBackgroundImage: 'none',
  paper: 'rgba(255,255,255,0.9)',
  paperSolid: '#fbfdff',
  paperGradient: 'none',
  border: 'rgba(42,82,132,0.17)',
  borderStrong: 'rgba(37,99,235,0.28)',
  subtle: 'rgba(37,99,235,0.055)',
  subtleHover: 'rgba(37,99,235,0.09)',
  primaryText: '#172133',
  secondaryText: '#617087',
  buttonText: '#f8fbff',
  buttonBackground: '#2563eb',
  buttonHoverBackground: '#3778ff',
  shadow: '0 18px 40px rgba(46,83,126,0.09), inset 0 1px 0 rgba(255,255,255,0.82)',
  accent: '#2563eb',
  accentHover: '#3778ff',
  accentText: '#1f5bce',
  accentSoft: 'rgba(37,99,235,0.05)',
  accentBorder: 'rgba(37,99,235,0.2)',
  local: '#0284c7',
  localSoft: 'rgba(2,132,199,0.04)',
  localBorder: 'rgba(2,132,199,0.17)',
  remote: '#3157d5',
  remoteSoft: 'rgba(49,87,213,0.04)',
  remoteBorder: 'rgba(49,87,213,0.17)',
  success: '#138a56',
  successSoft: 'rgba(19,138,86,0.06)',
  warning: '#b7791f',
  warningSoft: 'rgba(183,121,31,0.065)',
  danger: '#c24141',
  dangerSoft: 'rgba(194,65,65,0.06)',
  panelHighlight: 'rgba(37,99,235,0.06)',
};

export function createRTermTheme(styleMode: RTermStyleMode) {
  const light = styleMode === 'light';
  const tokens = light ? lightTokens : darkTokens;
  const cssVariables = {
    '--rterm-app-bg': tokens.appBackground,
    '--rterm-app-bg-image': tokens.appBackgroundImage,
    '--rterm-surface': tokens.paperSolid,
    '--rterm-surface-raised': tokens.paper,
    '--rterm-panel-bg': tokens.paperGradient,
    '--rterm-panel-border': tokens.border,
    '--rterm-panel-border-strong': tokens.borderStrong,
    '--rterm-panel-highlight': tokens.panelHighlight,
    '--rterm-control-bg': tokens.subtle,
    '--rterm-control-hover-bg': tokens.subtleHover,
    '--rterm-accent': tokens.accent,
    '--rterm-accent-hover': tokens.accentHover,
    '--rterm-accent-text': tokens.accentText,
    '--rterm-accent-soft': tokens.accentSoft,
    '--rterm-accent-border': tokens.accentBorder,
    '--rterm-local': tokens.local,
    '--rterm-local-soft': tokens.localSoft,
    '--rterm-local-border': tokens.localBorder,
    '--rterm-remote': tokens.remote,
    '--rterm-remote-soft': tokens.remoteSoft,
    '--rterm-remote-border': tokens.remoteBorder,
    '--rterm-success': tokens.success,
    '--rterm-success-soft': tokens.successSoft,
    '--rterm-warning': tokens.warning,
    '--rterm-warning-soft': tokens.warningSoft,
    '--rterm-danger': tokens.danger,
    '--rterm-danger-soft': tokens.dangerSoft,
    '--rterm-muted-text': tokens.secondaryText,
  };

  return createTheme({
    shape: {
      borderRadius: 6,
    },
    palette: {
      mode: light ? 'light' : 'dark',
      primary: {
        main: tokens.accent,
        light: tokens.accentHover,
        dark: light ? '#1d4ed8' : '#2f6ff6',
        contrastText: tokens.buttonText,
      },
      secondary: {
        main: light ? '#0284c7' : '#45c4ff',
      },
      success: {
        main: tokens.success,
      },
      warning: {
        main: tokens.warning,
      },
      error: {
        main: tokens.danger,
      },
      background: {
        default: tokens.appBackground,
        paper: tokens.paper,
      },
      text: {
        primary: tokens.primaryText,
        secondary: tokens.secondaryText,
      },
      divider: tokens.border,
    },
    typography: {
      fontFamily,
      h4: {
        fontSize: '1.9rem',
        fontWeight: 700,
        letterSpacing: '-0.04em',
      },
      h5: {
        fontSize: '1.1rem',
        fontWeight: 700,
        letterSpacing: '-0.03em',
      },
      h6: {
        fontSize: '1rem',
        fontWeight: 700,
        letterSpacing: '-0.02em',
      },
      button: {
        fontWeight: 700,
        letterSpacing: 0,
        textTransform: 'none',
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '::selection': {
            backgroundColor: tokens.selection,
          },
          body: {
            ...cssVariables,
            backgroundColor: tokens.appBackground,
            backgroundImage: tokens.appBackgroundImage,
            color: tokens.primaryText,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: tokens.paperSolid,
            backgroundImage: tokens.paperGradient,
            border: `1px solid ${tokens.border}`,
            boxShadow: tokens.shadow,
            backdropFilter: light ? 'none' : 'blur(24px)',
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            minHeight: 42,
            borderRadius: 14,
            paddingInline: 16,
            fontSize: '0.94rem',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            '&.Mui-disabled': {
              color: light ? 'rgba(31,34,39,0.44)' : 'rgba(255,255,255,0.34)',
              borderColor: tokens.border,
              backgroundColor: tokens.subtle,
              boxShadow: 'none',
            },
          },
          contained: {
            color: tokens.buttonText,
            background: tokens.buttonBackground,
            boxShadow: light
              ? '0 12px 24px rgba(37,99,235,0.18), inset 0 1px 0 rgba(255,255,255,0.28)'
              : '0 16px 30px rgba(11,78,190,0.24), inset 0 1px 0 rgba(255,255,255,0.22)',
            '&:hover': {
              background: tokens.buttonHoverBackground,
            },
            '&.Mui-disabled': {
              color: light ? 'rgba(31,34,39,0.44)' : 'rgba(255,255,255,0.42)',
              background: tokens.subtle,
            },
          },
          outlined: {
            borderColor: tokens.borderStrong,
            backgroundColor: tokens.subtle,
            color: tokens.primaryText,
            '&:hover': {
              borderColor: tokens.borderStrong,
              backgroundColor: tokens.subtleHover,
            },
            '&.Mui-disabled': {
              color: light ? 'rgba(31,34,39,0.42)' : 'rgba(255,255,255,0.28)',
              backgroundColor: tokens.subtle,
            },
          },
          text: {
            color: tokens.secondaryText,
            '&:hover': {
              backgroundColor: tokens.subtleHover,
            },
            '&.Mui-disabled': {
              color: light ? 'rgba(31,34,39,0.38)' : 'rgba(255,255,255,0.26)',
              backgroundColor: 'transparent',
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: tokens.primaryText,
            borderColor: tokens.border,
            backgroundColor: tokens.subtle,
            '&:hover': {
              backgroundColor: tokens.subtleHover,
              borderColor: tokens.borderStrong,
            },
            '&.Mui-disabled': {
              color: light ? 'rgba(31,34,39,0.42)' : 'rgba(255,255,255,0.3)',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            minHeight: 28,
            borderRadius: 999,
            border: `1px solid ${tokens.border}`,
            backgroundColor: tokens.subtle,
            color: light ? '#2b2f36' : '#d9dde3',
            fontSize: '0.78rem',
          },
          label: {
            paddingInline: 8,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: tokens.paperSolid,
            backgroundImage: tokens.paperGradient,
            border: `1px solid ${tokens.border}`,
            boxShadow: tokens.shadow,
            backdropFilter: light ? 'none' : 'blur(24px)',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            backgroundColor: tokens.subtle,
            boxShadow: `inset 0 1px 0 ${alpha(light ? '#ffffff' : '#ffffff', light ? 0.7 : 0.02)}`,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: tokens.border,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: tokens.borderStrong,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: tokens.accentBorder,
              boxShadow: `0 0 0 2px ${tokens.accentSoft}`,
            },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderColor: tokens.border,
            color: tokens.secondaryText,
            '&:hover': {
              backgroundColor: tokens.subtleHover,
            },
            '&.Mui-selected': {
              color: tokens.accentText,
              borderColor: tokens.accentBorder,
              backgroundColor: tokens.accentSoft,
            },
            '&.Mui-selected:hover': {
              backgroundColor: tokens.accentSoft,
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            minHeight: 46,
            borderRadius: 10,
            border: '1px solid transparent',
            '&.Mui-selected': {
              backgroundColor: tokens.subtleHover,
              borderColor: tokens.borderStrong,
            },
            '&.Mui-selected:hover': {
              backgroundColor: tokens.subtleHover,
            },
          },
        },
      },
    },
  });
}

export const rTermTheme = createRTermTheme('dark');

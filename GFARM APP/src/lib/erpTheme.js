import {
  useCallback,
  useEffect,
  useState,
} from 'react';


const THEME_KEY = 'nh_erp_theme';
const MODE_KEY = 'nh_erp_mode';
const CHANGE_EVENT = 'nh-erp-theme-change';


export const ERP_THEMES = [
  {
    id: 'novo-horizonte',
    label: 'Novo Horizonte',
    shortLabel: 'Verde',
    swatch:
      'linear-gradient(135deg, #12362f 0%, #0b8062 100%)',
  },
  {
    id: 'sap-blue',
    label: 'SAP Azul',
    shortLabel: 'Azul',
    swatch:
      'linear-gradient(135deg, #0a2a43 0%, #0a6ed1 100%)',
  },
  {
    id: 'grafite',
    label: 'Grafite',
    shortLabel: 'Grafite',
    swatch:
      'linear-gradient(135deg, #202630 0%, #596579 100%)',
  },
  {
    id: 'terra',
    label: 'Terra',
    shortLabel: 'Terra',
    swatch:
      'linear-gradient(135deg, #4a2c20 0%, #b45f2c 100%)',
  },
];


const VALID_THEMES =
  new Set(
    ERP_THEMES.map(
      (item) => item.id
    )
  );

const VALID_MODES =
  new Set([
    'light',
    'dark',
  ]);


function safeGet(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}


function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferência visual local é opcional.
  }
}


function normalizeTheme(value) {
  return VALID_THEMES.has(value)
    ? value
    : 'novo-horizonte';
}


function normalizeMode(value) {
  return VALID_MODES.has(value)
    ? value
    : 'light';
}


export function getStoredErpTheme() {
  return normalizeTheme(
    safeGet(
      THEME_KEY,
      'novo-horizonte'
    )
  );
}


export function getStoredErpMode() {
  return normalizeMode(
    safeGet(
      MODE_KEY,
      'light'
    )
  );
}


export function applyErpTheme(
  theme,
  mode
) {
  if (typeof document === 'undefined') {
    return;
  }

  const nextTheme =
    normalizeTheme(theme);

  const nextMode =
    normalizeMode(mode);

  const root =
    document.documentElement;

  root.dataset.erpTheme =
    nextTheme;

  root.dataset.erpMode =
    nextMode;

  root.style.colorScheme =
    nextMode === 'dark'
      ? 'dark'
      : 'light';
}


function broadcastTheme(theme, mode) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(
      CHANGE_EVENT,
      {
        detail: {
          theme,
          mode,
        },
      }
    )
  );
}


if (typeof document !== 'undefined') {
  applyErpTheme(
    getStoredErpTheme(),
    getStoredErpMode()
  );
}


export function useErpTheme() {
  const [theme, setThemeState] =
    useState(getStoredErpTheme);

  const [mode, setModeState] =
    useState(getStoredErpMode);


  useEffect(() => {
    applyErpTheme(
      theme,
      mode
    );
  }, [theme, mode]);


  useEffect(() => {
    const handleChange =
      (event) => {
        const nextTheme =
          normalizeTheme(
            event.detail?.theme
          );

        const nextMode =
          normalizeMode(
            event.detail?.mode
          );

        setThemeState(nextTheme);
        setModeState(nextMode);

        applyErpTheme(
          nextTheme,
          nextMode
        );
      };

    window.addEventListener(
      CHANGE_EVENT,
      handleChange
    );

    return () => {
      window.removeEventListener(
        CHANGE_EVENT,
        handleChange
      );
    };
  }, []);


  const setTheme =
    useCallback(
      (value) => {
        const next =
          normalizeTheme(value);

        safeSet(
          THEME_KEY,
          next
        );

        setThemeState(next);

        applyErpTheme(
          next,
          mode
        );

        broadcastTheme(
          next,
          mode
        );
      },
      [mode]
    );


  const setMode =
    useCallback(
      (value) => {
        const next =
          normalizeMode(value);

        safeSet(
          MODE_KEY,
          next
        );

        setModeState(next);

        applyErpTheme(
          theme,
          next
        );

        broadcastTheme(
          theme,
          next
        );
      },
      [theme]
    );


  return {
    theme,
    mode,
    setTheme,
    setMode,
  };
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import flagFontUrl from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';
import { App } from './App';
import { applyInitialTheme } from './lib/theme';
import './index.css';

applyInitialTheme();
// Windows tidak punya emoji bendera; font kecil ini (dilayani dari server sendiri) hanya dimuat bila perlu.
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFontUrl);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

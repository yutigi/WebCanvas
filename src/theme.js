// This classic script runs before styles load to avoid a flash of the wrong theme.
(() => {
  const storageKey = 'webcanvas-themes-v1';
  const legacyKey = 'webcanvas-theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const colorKeys = ['accent', 'canvas', 'surface', 'text'];
  const presets = [
    { id: 'light', name: 'Light', mode: 'light', colors: { accent: '#7561d9', canvas: '#f8f9fc', surface: '#ffffff', text: '#303343' } },
    { id: 'dark', name: 'Dark', mode: 'dark', colors: { accent: '#a28aef', canvas: '#181820', surface: '#22212c', text: '#e8e5f1' } },
    { id: 'midnight', name: 'Midnight', mode: 'dark', colors: { accent: '#79b8ff', canvas: '#101927', surface: '#182638', text: '#e1edfc' } },
    { id: 'forest', name: 'Forest', mode: 'dark', colors: { accent: '#8bceab', canvas: '#14221d', surface: '#1e3028', text: '#e3efe7' } },
    { id: 'rose', name: 'Rose', mode: 'light', colors: { accent: '#a44570', canvas: '#fbf3f6', surface: '#fffafd', text: '#4b303e' } },
    { id: 'sand', name: 'Sand', mode: 'light', colors: { accent: '#97632e', canvas: '#f5f0e5', surface: '#fffaf0', text: '#453c30' } }
  ];
  const copy = value => JSON.parse(JSON.stringify(value));
  const validColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  function normalize(raw) {
    const customThemes = [], ids = new Set();
    for (const theme of Array.isArray(raw?.customThemes) ? raw.customThemes.slice(0, 12) : []) {
      if (!theme || !/^custom-[a-z0-9-]{1,80}$/.test(theme.id) || ids.has(theme.id)
        || !['light', 'dark'].includes(theme.mode) || !colorKeys.every(key => validColor(theme.colors?.[key]))) continue;
      ids.add(theme.id);
      customThemes.push({ id: theme.id, name: typeof theme.name === 'string' && theme.name.trim() ? theme.name.trim().slice(0, 40) : 'My theme', mode: theme.mode,
        colors: Object.fromEntries(colorKeys.map(key => [key, theme.colors[key].toLowerCase()])) });
    }
    const selected = raw?.selected;
    return { version: 1, selected: selected === 'system' || presets.some(p => p.id === selected) || ids.has(selected) ? selected : 'system', customThemes };
  }
  let settings = normalize(null), previewSettings = null;
  try {
    const saved = localStorage.getItem(storageKey);
    settings = saved ? normalize(JSON.parse(saved)) : normalize({ selected: localStorage.getItem(legacyKey) });
  } catch { /* Use the system appearance if stored settings cannot be read. */ }

  function resolve(state = settings) {
    const id = state.selected === 'system' ? (systemTheme.matches ? 'dark' : 'light') : state.selected;
    return copy(presets.find(p => p.id === id) || state.customThemes.find(t => t.id === id) || presets[0]);
  }
  const rgb = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
  const mix = (a, b, weight) => '#' + rgb(a).map((value, i) => Math.round(value * (1 - weight) + rgb(b)[i] * weight).toString(16).padStart(2, '0')).join('');
  function luminance(hex) {
    const channels = rgb(hex).map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  function apply() {
    const theme = resolve(previewSettings || settings), { accent, canvas, surface, text } = theme.colors;
    const root = document.documentElement;
    root.dataset.theme = theme.mode;
    root.dataset.themePreset = theme.id;
    let accentText = accent;
    for (let step = 1; contrast(accentText, surface) < 4.5 && step <= 10; step++) accentText = mix(accent, text, step / 10);
    const tokens = {
      purple: accent, line: mix(surface, text, .18),
      'theme-canvas': canvas, 'theme-surface': surface, 'theme-text': text,
      'theme-muted': mix(surface, text, .72), 'theme-accent-text': accentText,
      'theme-raised': mix(surface, text, .04), 'theme-input': mix(surface, canvas, .65),
      'theme-hover': mix(surface, accent, .12), 'theme-accent-soft': mix(surface, accent, .16),
      'theme-grid': mix(canvas, text, .18),
      'theme-map-browser': mix(surface, accent, .45), 'theme-map-text': mix(surface, text, .45),
      'theme-on-accent': contrast(accent, '#ffffff') >= contrast(accent, '#16131e') ? '#ffffff' : '#16131e'
    };
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty('--' + key, value);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(theme.mode === 'dark'));
      toggle.title = 'Switch to ' + (theme.mode === 'dark' ? 'light' : 'dark') + ' theme';
    }
    const label = document.getElementById('current-theme');
    if (label) label.textContent = (previewSettings || settings).selected === 'system' ? 'System' : theme.name;
  }
  function commit(state) {
    settings = normalize(state); previewSettings = null; apply();
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
      if (settings.selected === 'system') localStorage.removeItem(legacyKey);
      else localStorage.setItem(legacyKey, resolve().mode);
      return true;
    } catch { return false; }
  }
  window.canvasTheme = Object.freeze({
    getSettings: () => copy(settings), getPresets: () => copy(presets), resolve,
    preview: state => { previewSettings = normalize(state); apply(); },
    restore: () => { previewSettings = null; apply(); }, commit, validColor, contrast,
    onSystemChange: listener => {
      systemTheme.addEventListener('change', listener);
      return () => systemTheme.removeEventListener('change', listener);
    }
  });
  apply();
  systemTheme.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      commit({ ...settings, selected: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' });
    });
  });
})();

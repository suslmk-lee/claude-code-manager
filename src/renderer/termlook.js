'use strict';
/* global el, $, S */
// Terminal look: colour theme + font for every xterm in the app (Claude terminal and 셸). Saved in localStorage
// ("termLook"), applied live. Themes are the usual 16-colour palettes; the first one keeps xterm's defaults.

const TERM_THEMES = [
  { id: 'default', name: '기본', bg: '#111317', fg: '#ffffff', ansi: null },
  // the three tinted neutral ramps (same steps as the app themes): ramp steps for black/white, muted tinted ANSI so diffs still read
  { id: 'mauve', name: '모브 (회보라)', bg: '#17151c', fg: '#e2dde7', cursor: '#aaa2b3', sel: '#45404f', ansi: ['#292531', '#d78a8a', '#9bc4a0', '#d9c27a', '#8f9fd8', '#c4a0d4', '#8ec4c4', '#aaa2b3', '#716879', '#e6a0a0', '#b2d6b6', '#e8d59a', '#a9b7e6', '#d6b8e2', '#a8d6d6', '#e2dde7'] },
  { id: 'mocha', name: '모카 (갈색)', bg: '#211b1a', fg: '#e8d8ce', cursor: '#c1a094', sel: '#60433d', ansi: ['#382a28', '#d58a7a', '#a8b887', '#d9b36e', '#9aa6c0', '#c89ab0', '#93b8ae', '#c1a094', '#916b60', '#e4a392', '#bfcc9f', '#e6c98e', '#b3bdd2', '#d8b3c6', '#abcbc2', '#e8d8ce'] },
  { id: 'slate', name: '슬레이트 (청회색)', bg: '#111522', fg: '#dce3ef', cursor: '#98a9c4', sel: '#303d59', ansi: ['#1e263b', '#d4848e', '#93c0a3', '#d4bd7c', '#7f9ed6', '#b79bd3', '#83bfcc', '#98a9c4', '#536684', '#e39da5', '#abd3b8', '#e2d09b', '#9db7e6', '#ccb4e2', '#a0d2dc', '#dce3ef'] },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', fg: '#f8f8f2', sel: '#44475a', ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'] },
  { id: 'onedark', name: 'One Dark', bg: '#282c34', fg: '#abb2bf', cursor: '#528bff', sel: '#3e4451', ansi: ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf', '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'] },
  { id: 'tokyonight', name: 'Tokyo Night', bg: '#1a1b26', fg: '#c0caf5', sel: '#33467c', ansi: ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6', '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'] },
  { id: 'catppuccin', name: 'Catppuccin Mocha', bg: '#1e1e2e', fg: '#cdd6f4', cursor: '#f5e0dc', sel: '#585b70', ansi: ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de', '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'] },
  { id: 'nord', name: 'Nord', bg: '#2e3440', fg: '#d8dee9', sel: '#434c5e', ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0', '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'] },
  { id: 'gruvbox', name: 'Gruvbox Dark', bg: '#282828', fg: '#ebdbb2', sel: '#3c3836', ansi: ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'] },
  { id: 'monokai', name: 'Monokai', bg: '#272822', fg: '#f8f8f2', cursor: '#f8f8f0', sel: '#49483e', ansi: ['#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2', '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5'] },
  { id: 'solarized-dark', name: 'Solarized Dark', bg: '#002b36', fg: '#839496', cursor: '#93a1a1', sel: '#073642', ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'] },
  { id: 'solarized-light', name: 'Solarized Light', bg: '#fdf6e3', fg: '#657b83', cursor: '#586e75', sel: '#eee8d5', ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'] },
  { id: 'flexoki-dark', name: 'Flexoki Dark', bg: '#100f0f', fg: '#cecdc3', sel: '#282726', ansi: ['#100f0f', '#d14d41', '#879a39', '#d0a215', '#4385be', '#ce5d97', '#3aa99f', '#cecdc3', '#575653', '#af3029', '#66800b', '#ad8301', '#205ea6', '#a02f6f', '#24837b', '#fffcf0'] },
  { id: 'flexoki-light', name: 'Flexoki Light', bg: '#fffcf0', fg: '#100f0f', sel: '#e6e4d9', ansi: ['#100f0f', '#af3029', '#66800b', '#ad8301', '#205ea6', '#a02f6f', '#24837b', '#6f6e69', '#b7b5ac', '#d14d41', '#879a39', '#d0a215', '#4385be', '#ce5d97', '#3aa99f', '#cecdc3'] },
  { id: 'kanagawa-wave', name: 'Kanagawa Wave', bg: '#1f1f28', fg: '#dcd7ba', cursor: '#c8c093', sel: '#2d4f67', ansi: ['#090618', '#c34043', '#76946a', '#c0a36e', '#7e9cd8', '#957fb8', '#6a9589', '#c8c093', '#727169', '#e82424', '#98bb6c', '#e6c384', '#7fb4ca', '#938aa9', '#7aa89f', '#dcd7ba'] },
  { id: 'kanagawa-dragon', name: 'Kanagawa Dragon', bg: '#181616', fg: '#c5c9c5', cursor: '#c8c093', sel: '#2d4f67', ansi: ['#0d0c0c', '#c4746e', '#8a9a7b', '#c4b28a', '#8ba4b0', '#a292a3', '#8ea4a2', '#c8c093', '#a6a69c', '#e46876', '#87a987', '#e6c384', '#7fb4ca', '#938aa9', '#7aa89f', '#c5c9c5'] },
  { id: 'everforest-dark', name: 'Everforest Dark', bg: '#2d353b', fg: '#d3c6aa', sel: '#475258', ansi: ['#475258', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa', '#475258', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa'] },
  { id: 'everforest-light', name: 'Everforest Light', bg: '#fdf6e3', fg: '#5c6a72', sel: '#e0dcc7', ansi: ['#5c6a72', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#dfddc8', '#5c6a72', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#dfddc8'] },
  { id: 'nightowl', name: 'Night Owl', bg: '#011627', fg: '#d6deeb', cursor: '#80a4c2', sel: '#1d3b53', ansi: ['#011627', '#ef5350', '#22da6e', '#addb67', '#82aaff', '#c792ea', '#21c7a8', '#ffffff', '#575656', '#ef5350', '#22da6e', '#ffeb95', '#82aaff', '#c792ea', '#7fdbca', '#ffffff'] },
  { id: 'lightowl', name: 'Light Owl', bg: '#fbfbfb', fg: '#403f53', sel: '#e0e0e0', ansi: ['#403f53', '#de3d3b', '#08916a', '#e0af02', '#288ed7', '#d6438a', '#2aa298', '#f0f0f0', '#403f53', '#de3d3b', '#08916a', '#daaa01', '#288ed7', '#d6438a', '#2aa298', '#f0f0f0'] },
  { id: 'aura', name: 'Aura', bg: '#15141b', fg: '#edecee', cursor: '#a277ff', sel: '#29263c', ansi: ['#110f18', '#ff6767', '#61ffca', '#ffca85', '#a277ff', '#a277ff', '#61ffca', '#edecee', '#4d4d4d', '#ffca85', '#a277ff', '#ffca85', '#a277ff', '#a277ff', '#61ffca', '#edecee'] },
  { id: 'rosepine', name: 'Rosé Pine', bg: '#191724', fg: '#e0def4', cursor: '#524f67', sel: '#403d52', ansi: ['#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4', '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4'] },
  { id: 'rosepine-moon', name: 'Rosé Pine Moon', bg: '#232136', fg: '#e0def4', cursor: '#59546d', sel: '#44415a', ansi: ['#393552', '#eb6f92', '#3e8fb0', '#f6c177', '#9ccfd8', '#c4a7e7', '#ea9a97', '#e0def4', '#6e6a86', '#eb6f92', '#3e8fb0', '#f6c177', '#9ccfd8', '#c4a7e7', '#ea9a97', '#e0def4'] },
  { id: 'rosepine-dawn', name: 'Rosé Pine Dawn', bg: '#faf4ed', fg: '#575279', cursor: '#cecacd', sel: '#dfdad9', ansi: ['#f2e9e1', '#b4637a', '#286983', '#ea9d34', '#56949f', '#907aa9', '#d7827e', '#575279', '#9893a5', '#b4637a', '#286983', '#ea9d34', '#56949f', '#907aa9', '#d7827e', '#575279'] },
  { id: 'cobalt2', name: 'Cobalt2', bg: '#193549', fg: '#ffffff', cursor: '#f0cc09', sel: '#0050a4', ansi: ['#000000', '#ff0000', '#38de21', '#ffe50a', '#1460d2', '#ff005d', '#00bbbb', '#bbbbbb', '#555555', '#f40e17', '#3bd01d', '#edc809', '#5555ff', '#ff55ff', '#6ae3fa', '#ffffff'] },
  { id: 'github-dark', name: 'Octocat Dark', bg: '#0d1117', fg: '#c9d1d9', cursor: '#58a6ff', sel: '#264f78', ansi: ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4', '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc'] },
  { id: 'hacker-green', name: 'Hacker Green', bg: '#050a05', fg: '#5fd75f', cursor: '#5fd75f', sel: '#1b3d1b', ansi: ['#0a0f0a', '#ff5f5f', '#5fd75f', '#afd75f', '#5fafaf', '#af87d7', '#5fd7d7', '#c8e6c8', '#3d5a3d', '#ff8787', '#87ff87', '#d7ff87', '#87d7d7', '#d7afff', '#87ffff', '#e6ffe6'] },
  { id: 'hacker-blue', name: 'Hacker Blue', bg: '#050a14', fg: '#5fafff', cursor: '#5fafff', sel: '#17304d', ansi: ['#0a0f1a', '#ff5f5f', '#5fd75f', '#d7d75f', '#5fafff', '#af87ff', '#5fd7ff', '#c8d8f0', '#3d4f6e', '#ff8787', '#87ff87', '#ffff87', '#87c7ff', '#d7afff', '#87ffff', '#e6f0ff'] },
];
const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const DEFAULT_FONT_STACK = '"D2Coding", "NanumGothicCoding", Menlo, Consolas, "Cascadia Mono", ui-monospace, monospace';
// monospace families worth offering when installed (checked below); anything else goes in the free-text field
const FONT_CANDIDATES = ['D2Coding', 'D2CodingLigature', 'NanumGothicCoding', 'JetBrains Mono', 'JetBrainsMono Nerd Font', 'Fira Code', 'FiraCode Nerd Font', 'Cascadia Code', 'Cascadia Mono', 'SF Mono', 'Menlo', 'Monaco', 'Source Code Pro', 'IBM Plex Mono', 'Hack', 'Hack Nerd Font', 'MesloLGS NF', 'Inconsolata', 'Ubuntu Mono', 'Roboto Mono', 'Victor Mono', 'Iosevka', 'Consolas', 'Courier New', 'Pretendard Mono', 'Sarasa Mono K'];

const LOOK = (() => { try { return { app: 'default', theme: 'default', surface: 'glass', font: '', size: 13, alpha: 1, ...JSON.parse(localStorage.getItem('termLook') || '{}') }; } catch { return { app: 'default', theme: 'default', surface: 'glass', font: '', size: 13, alpha: 1 }; } })();
// card style (surface): how cards, tiles, tabs and stat blocks are drawn — style.css keys every rule off html[data-surface]
const SURFACES = [
  { id: 'glass', name: '리퀴드 글라스', hint: '반투명 유리 · 굴절 림 · 광택 · 색 번짐' },
  { id: 'mono', name: '모노라인 미니멀', hint: '1px 선 · 작은 반경 · 그림자 없음 · 간격과 글자로 위계' },
  { id: 'tonal', name: '플랫 톤 계층', hint: '테두리 없이 밝기 단계로 층 구분 · 알약 버튼 (Material 3)' },
  { id: 'neo', name: '네오모피즘', hint: '배경과 같은 색 · 밝은/어두운 그림자 두 개로 돌출, 눌린 상태는 함몰' },
  { id: 'paper', name: '레이어드 페이퍼', hint: '종이가 겹쳐 쌓인 느낌 · 아래로 겹치는 장 · 부드러운 깊이' },
  { id: 'glow', name: '아웃라인 글로우', hint: '얇은 테두리와 강조색 발광 · 활성 요소만 빛남 · 터미널 톤' },
  { id: 'aurora', name: '오로라', hint: '흐릿한 색 덩어리 배경 위 반투명 카드 · 림과 광택 없음' },
  { id: 'brutal', name: '브루탈리즘', hint: '굵은 단색 테두리 · 직각에 가까운 모서리 · 오프셋 그림자' },
];

// App (chrome) themes: base colours only — style.css derives buttons, hovers, selections, borders from them with color-mix.
const APP_THEMES = [
  { id: 'default', name: '기본 (그라파이트 · 주황)', bg: '#111317', panel: '#181b21', line: '#2a2f3a', fg: '#d7dae0', dim: '#8a919e', acc: '#d97757', ok: '#4caf7d', warn: '#e0b341', bad: '#e05d5d', field: '#0d0f13', link: '#8ab4f8' },
  { id: 'graphite-blue', name: '그라파이트 · 파랑', bg: '#111317', panel: '#181b21', line: '#2a2f3a', fg: '#d7dae0', dim: '#8a919e', acc: '#5b9cf6', ok: '#4caf7d', warn: '#e0b341', bad: '#e05d5d', field: '#0d0f13', link: '#8ab4f8' },
  { id: 'graphite-green', name: '그라파이트 · 초록', bg: '#101412', panel: '#161c18', line: '#27312b', fg: '#d6dfd8', dim: '#88968c', acc: '#4caf7d', ok: '#6fcf97', warn: '#e0b341', bad: '#e05d5d', field: '#0b0f0d', link: '#8fd3b0' },
  { id: 'mono', name: '모노크롬', bg: '#0e0e10', panel: '#161618', line: '#2a2a2e', fg: '#e4e4e7', dim: '#8e8e95', acc: '#c9c9cf', ok: '#9ad0a8', warn: '#d9c27a', bad: '#d97b7b', field: '#0a0a0b', link: '#b8c4ff', onAcc: '#111' },
  // tinted 6-step neutral ramps (bg → panel → line → · → dim → fg); the accent is the lightest step, status colours stay muted
  { id: 'mauve', name: '모브 (회보라)', bg: '#17151c', panel: '#292531', line: '#45404f', fg: '#e2dde7', dim: '#aaa2b3', acc: '#e2dde7', ok: '#9ad0a8', warn: '#d9c27a', bad: '#d97b7b', field: '#17151c', link: '#c4b5e0', onAcc: '#17151c' },
  { id: 'mocha', name: '모카 (갈색)', bg: '#211b1a', panel: '#382a28', line: '#60433d', fg: '#e8d8ce', dim: '#c1a094', acc: '#e8d8ce', ok: '#9ad0a8', warn: '#d9c27a', bad: '#d97b7b', field: '#211b1a', link: '#d9b48f', onAcc: '#211b1a' },
  { id: 'slate', name: '슬레이트 (청회색)', bg: '#111522', panel: '#1e263b', line: '#303d59', fg: '#dce3ef', dim: '#98a9c4', acc: '#dce3ef', ok: '#9ad0a8', warn: '#d9c27a', bad: '#d97b7b', field: '#111522', link: '#9fb4e0', onAcc: '#111522' },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', panel: '#21222c', line: '#44475a', fg: '#f8f8f2', dim: '#8d93b3', acc: '#bd93f9', ok: '#50fa7b', warn: '#f1fa8c', bad: '#ff5555', field: '#1e1f29', link: '#8be9fd', onAcc: '#1b1c26' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', panel: '#272c36', line: '#434c5e', fg: '#eceff4', dim: '#9aa5b5', acc: '#88c0d0', ok: '#a3be8c', warn: '#ebcb8b', bad: '#bf616a', field: '#242933', link: '#81a1c1', onAcc: '#1f252e' },
  { id: 'tokyonight', name: 'Tokyo Night', bg: '#1a1b26', panel: '#16161e', line: '#2f3549', fg: '#c0caf5', dim: '#7982a9', acc: '#7aa2f7', ok: '#9ece6a', warn: '#e0af68', bad: '#f7768e', field: '#13131a', link: '#7dcfff', onAcc: '#14151f' },
  { id: 'catppuccin', name: 'Catppuccin Mocha', bg: '#1e1e2e', panel: '#181825', line: '#313244', fg: '#cdd6f4', dim: '#a6adc8', acc: '#cba6f7', ok: '#a6e3a1', warn: '#f9e2af', bad: '#f38ba8', field: '#11111b', link: '#89b4fa', onAcc: '#1e1e2e' },
  { id: 'gruvbox', name: 'Gruvbox', bg: '#282828', panel: '#1d2021', line: '#3c3836', fg: '#ebdbb2', dim: '#a89984', acc: '#fe8019', ok: '#b8bb26', warn: '#fabd2f', bad: '#fb4934', field: '#1b1b1b', link: '#83a598', onAcc: '#1d2021' },
  { id: 'rosepine', name: 'Rosé Pine', bg: '#191724', panel: '#1f1d2e', line: '#403d52', fg: '#e0def4', dim: '#908caa', acc: '#ebbcba', ok: '#9ccfd8', warn: '#f6c177', bad: '#eb6f92', field: '#15131f', link: '#c4a7e7', onAcc: '#191724' },
  { id: 'solarized-dark', name: 'Solarized Dark', bg: '#002b36', panel: '#073642', line: '#12515f', fg: '#eee8d5', dim: '#93a1a1', acc: '#268bd2', ok: '#859900', warn: '#b58900', bad: '#dc322f', field: '#00242e', link: '#2aa198' },
  { id: 'light', name: '라이트 (주황)', light: true, bg: '#f6f7f9', panel: '#ffffff', line: '#d9dde3', fg: '#1f2329', dim: '#6b7380', acc: '#d97757', ok: '#2e9b5f', warn: '#b98900', bad: '#d64545', field: '#ffffff', link: '#1a56db', strong: '#000' },
  { id: 'solarized-light', name: 'Solarized Light', light: true, bg: '#fdf6e3', panel: '#eee8d5', line: '#d9d2bd', fg: '#073642', dim: '#657b83', acc: '#cb4b16', ok: '#859900', warn: '#b58900', bad: '#dc322f', field: '#fffdf5', link: '#268bd2', strong: '#002b36' },
  { id: 'latte', name: 'Catppuccin Latte', light: true, bg: '#eff1f5', panel: '#e6e9ef', line: '#ccd0da', fg: '#4c4f69', dim: '#6c6f85', acc: '#8839ef', ok: '#40a02b', warn: '#df8e1d', bad: '#d20f39', field: '#ffffff', link: '#1e66f5', strong: '#1e1e2e' },
];
const appTheme = () => APP_THEMES.find((t) => t.id === LOOK.app) || APP_THEMES[0];
function applyAppTheme() {
  const a = appTheme(), st = document.documentElement.style;
  for (const k of ['bg', 'panel', 'line', 'fg', 'dim', 'acc', 'ok', 'warn', 'bad', 'field', 'link']) st.setProperty(`--${k}`, a[k]);
  st.setProperty('--on-acc', a.onAcc || '#fff');
  st.setProperty('--strong', a.strong || '#fff');
  st.colorScheme = a.light ? 'light' : 'dark'; // scrollbars, form controls
}
// the 기본 terminal theme follows the app theme's background (so a light app theme gets a light terminal)
const termBase = (t) => (t.id === 'default' ? { bg: appTheme().bg, fg: appTheme().light ? appTheme().fg : '#ffffff' } : { bg: t.bg, fg: t.fg });
// terminal background transparency (macOS: the window is created transparent, so the desktop shows through the terminal only)
const alphaOn = () => isMac && LOOK.alpha < 1;
const withAlpha = (hex, a) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex; };
const saveLook = () => { try { localStorage.setItem('termLook', JSON.stringify(LOOK)); } catch { /* fine */ } };

function xtermTheme(t) {
  const base = termBase(t);
  const th = { background: base.bg, foreground: base.fg, cursor: t.cursor || base.fg, cursorAccent: base.bg, selectionBackground: t.sel || undefined };
  if (t.ansi) ANSI_KEYS.forEach((k, i) => { th[k] = t.ansi[i]; });
  const out = t.id === 'default' && !appTheme().light ? { background: base.bg } : th; // dark default: xterm's own colours for the rest
  if (alphaOn()) out.background = 'rgba(0, 0, 0, 0)'; // the pane paints the one translucent layer (--term-bg); xterm must not add a second one
  return out;
}
const currentTheme = () => TERM_THEMES.find((t) => t.id === LOOK.theme) || TERM_THEMES[0];
const fontFamily = () => (LOOK.font ? `${/^[a-z-]+$/.test(LOOK.font) ? LOOK.font : `"${LOOK.font.replace(/"/g, '')}"`}, ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK); // generic keywords (ui-monospace) stay unquoted
// what newXterm() passes to the Terminal constructor
function xtermOptions() { return { theme: xtermTheme(currentTheme()), fontFamily: fontFamily(), fontSize: Number(LOOK.size) || 13, allowTransparency: true }; }

// canvas width trick: a family is installed when text measures differently from the generic fallback alone
const hasFont = (() => {
  let ctx; const cache = new Map();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    ctx ||= document.createElement('canvas').getContext('2d');
    const w = (f) => { ctx.font = `48px ${f}`; return ctx.measureText('mmmmmmmmmmlli1O0WWW한글').width; };
    const ok = ['monospace', 'serif'].some((g) => w(`"${name}", ${g}`) !== w(g));
    cache.set(name, ok); return ok;
  };
})();

function applyLook() {
  const o = xtermOptions();
  applyAppTheme();
  document.documentElement.dataset.surface = SURFACES.some((x) => x.id === LOOK.surface) ? LOOK.surface : 'glass';
  const tbg = termBase(currentTheme()).bg;
  document.documentElement.style.setProperty('--term-bg', alphaOn() ? withAlpha(tbg, LOOK.alpha) : tbg);
  document.documentElement.classList.toggle('translucent', alphaOn()); // page chrome stays opaque, the terminal areas go see-through
  for (const t of [...(S.terms?.values() || []), ...(S.shells?.values() || [])]) {
    t.term.options.theme = o.theme; t.term.options.fontFamily = o.fontFamily; t.term.options.fontSize = o.fontSize;
    if (t.box.isConnected) t.fit.fit();
  }
  saveLook();
  $('#term-look')?.querySelectorAll('.theme-row[data-id]').forEach((r) => r.classList.toggle('sel', r.dataset.id === LOOK.theme));
  $('#term-look')?.querySelectorAll('.theme-row[data-app]').forEach((r) => r.classList.toggle('sel', r.dataset.app === LOOK.app));
  $('#term-look')?.querySelectorAll('.theme-row[data-surface]').forEach((r) => r.classList.toggle('sel', r.dataset.surface === LOOK.surface));
}
applyLook(); // the pane background follows the theme from the first paint

function swatch(t) { // mini preview like a theme gallery: two text bars, then green / fg / yellow blocks
  const c = (i, fb) => (t.ansi ? t.ansi[i] : fb), base = termBase(t);
  return el('span', { class: 'swatch', style: `background:${base.bg};border-color:${t.ansi ? c(8, '#444') : appTheme().line}` },
    el('i', { style: `background:${base.fg};width:70%` }), el('i', { style: `background:${c(8, appTheme().dim)};width:55%` }),
    el('b', {}, el('i', { style: `background:${c(2, appTheme().ok)};width:28%` }), el('i', { style: `background:${base.fg};width:34%` }), el('i', { style: `background:${c(3, appTheme().warn)};width:8%` })));
}
function uiSwatch(a) { // mini app window: header strip with the accent dot, body with text lines and an accent pill
  return el('span', { class: 'ui-swatch', style: `background:${a.bg};border-color:${a.line}` },
    el('span', { class: 'top', style: `background:${a.panel};border-bottom:1px solid ${a.line}` }, el('i', { style: `background:${a.acc}` }), el('i', { style: `background:${a.dim}` }), el('i', { style: `background:${a.dim}` })),
    el('span', { class: 'body' }, el('i', { style: `background:${a.fg};width:72%` }), el('i', { style: `background:${a.dim};width:50%` }), el('i', { style: `background:${a.acc};width:30%;height:5px` })));
}
let lookPage = 'app'; // the section last viewed; reopening lands there
function closeLook() { const d = $('#term-look'); if (d) { if (d.open) d.close(); d.remove(); } }
// 모양: a centred modal — sections down the left (앱 테마 · 카드 스타일 · 터미널 · 터미널 테마), the chosen one on the right
function openLook() {
  if ($('#term-look')) return closeLook();
  const fonts = FONT_CANDIDATES.filter(hasFont);
  const known = !LOOK.font || LOOK.font === 'ui-monospace' || fonts.includes(LOOK.font);
  const sel = el('select', { onchange: () => { if (sel.value === '__custom') { custom.hidden = false; custom.focus(); return; } custom.hidden = true; LOOK.font = sel.value; applyLook(); } },
    el('option', { value: '', text: '기본 (D2Coding → Menlo)' }),
    el('option', { value: 'ui-monospace', text: '시스템 고정폭 (macOS: SF Mono)', style: 'font-family:ui-monospace' }),
    ...fonts.map((f) => el('option', { value: f, text: f, style: `font-family:"${f}"` })),
    el('option', { value: '__custom', text: '직접 입력…' }));
  sel.value = known ? LOOK.font : '__custom';
  const custom = el('input', { class: 'look-custom', placeholder: '폰트 이름 (설치된 글꼴)', value: known ? '' : LOOK.font, hidden: known ? '' : null,
    onchange: () => { LOOK.font = custom.value.trim(); applyLook(); } });
  const size = el('input', { type: 'number', min: '9', max: '24', step: '1', value: String(LOOK.size), class: 'look-size', oninput: () => { const n = Number(size.value); if (n >= 9 && n <= 24) { LOOK.size = n; applyLook(); } } });
  const pct = el('span', { class: 'look-unit', text: `${Math.round(LOOK.alpha * 100)}%` });
  const alpha = el('input', { type: 'range', min: '30', max: '100', step: '5', value: String(Math.round(LOOK.alpha * 100)), class: 'look-alpha', oninput: () => { LOOK.alpha = Number(alpha.value) / 100; pct.textContent = `${alpha.value}%`; applyLook(); } });
  const PAGES = [
    ['app', '앱 테마', () => el('div', { class: 'theme-list' }, ...APP_THEMES.map((a) => el('div', { class: 'theme-row glass' + (a.id === LOOK.app ? ' sel' : ''), 'data-app': a.id, onclick: () => { LOOK.app = a.id; applyLook(); } },
      uiSwatch(a), el('span', { class: 'theme-name', text: a.name }))))],
    ['surface', '카드 스타일', () => el('div', { class: 'theme-list' }, ...SURFACES.map((x) => el('div', { class: 'theme-row glass' + (x.id === LOOK.surface ? ' sel' : ''), 'data-surface': x.id, onclick: () => { LOOK.surface = x.id; applyLook(); } },
      el('span', { class: `surf-swatch ${x.id}` }, el('i'), el('i')), el('span', {}, el('span', { class: 'theme-name', text: x.name }), el('span', { class: 'theme-hint', text: x.hint })))))],
    ['term', '터미널 글꼴 · 투명도', () => el('div', {},
      el('div', { class: 'look-row' }, el('span', { class: 'look-label', text: '글꼴' }), sel, size, el('span', { class: 'look-unit', text: 'px' })),
      custom,
      isMac ? el('div', { class: 'look-row', 'data-tip': '터미널 배경만 투명해지고 글자는 그대로입니다 · 뒤 창이 비쳐 보임' }, el('span', { class: 'look-label', text: '투명도' }), alpha, pct) : null,
      el('p', { class: 'hint', text: '글꼴과 크기는 모든 터미널(Claude · 셸)에 바로 적용됩니다.' }))],
    ['termTheme', '터미널 테마', () => el('div', { class: 'theme-list' }, ...TERM_THEMES.map((t) => el('div', { class: 'theme-row glass' + (t.id === LOOK.theme ? ' sel' : ''), 'data-id': t.id, onclick: () => { LOOK.theme = t.id; applyLook(); } },
      swatch(t), el('span', { class: 'theme-name', text: t.name }))))],
  ];
  const main = el('div', { class: 'look-main' });
  const side = el('div', { class: 'look-side' }, ...PAGES.map(([id, name]) => el('button', { class: 'look-nav glass', 'data-page': id, text: name, onclick: () => show(id) })));
  const show = (id) => { lookPage = id; const [, name, build] = PAGES.find((p) => p[0] === id) || PAGES[0]; side.querySelectorAll('.look-nav').forEach((b) => b.classList.toggle('active', b.dataset.page === id)); main.replaceChildren(el('h4', { text: name }), build()); main.scrollTop = 0; };
  const dlg = el('dialog', { id: 'term-look', class: 'look-dlg glass', onclose: () => dlg.remove(), onclick: (e) => { if (e.target === dlg) dlg.close(); } }, // a click on the backdrop closes
    el('div', { class: 'look-head' }, el('b', { text: '모양' }), el('button', { class: 'x', text: '×', onclick: () => dlg.close() })),
    el('div', { class: 'look-body' }, side, main));
  document.body.append(dlg);
  dlg.showModal();
  show(PAGES.some((p) => p[0] === lookPage) ? lookPage : 'app');
}
$('#btn-look').onclick = () => openLook(); // the gear menu is the one entry point
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#term-look')) closeLook(); }, true);

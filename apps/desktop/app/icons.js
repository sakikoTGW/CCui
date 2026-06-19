// SF Symbols 风格线性图标 — stroke 1.5，24×24 viewBox
const S = 'stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"'

export const ICONS = {
  chat: `<svg viewBox="0 0 24 24" ${S}><path d="M4 6h16v10H8l-4 4V6z"/></svg>`,
  presets: `<svg viewBox="0 0 24 24" ${S}><path d="M4 20V4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,
  templates: `<svg viewBox="0 0 24 24" ${S}><path d="M6 4h12v16H6z"/><path d="M8 8h8M8 12h6"/></svg>`,
  theme: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  studio: `<svg viewBox="0 0 24 24" ${S}><path d="M4 7h16M4 12h16M4 17h10"/></svg>`,
  console: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9h4M7 13h8"/></svg>`,
  plugins: `<svg viewBox="0 0 24 24" ${S}><path d="M10 4a2 2 0 1 1 4 0v2h3a1 1 0 0 1 1 1v3h2a2 2 0 1 1 0 4h-2v3a1 1 0 0 1-1 1h-3v-2a2 2 0 1 0-4 0v2H6a1 1 0 0 1-1-1v-3H4a2 2 0 1 1 0-4h1V7a1 1 0 0 1 1-1h4z"/></svg>`,
  files: `<svg viewBox="0 0 24 24" ${S}><path d="M4 4h7l3 3h6v13H4z"/></svg>`,
  orchestrate: `<svg viewBox="0 0 24 24" ${S}><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7 8l4 8M17 8l-4 8"/></svg>`,
  collab: `<svg viewBox="0 0 24 24" ${S}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/></svg>`,
  market: `<svg viewBox="0 0 24 24" ${S}><path d="M4 8h16l-2 10H6L4 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`,
  themeToggle: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg>`,
  themeSun: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" ${S}><path d="M4 7h16"/><circle cx="8" cy="7" r="2"/><path d="M4 12h16"/><circle cx="15" cy="12" r="2"/><path d="M4 17h16"/><circle cx="11" cy="17" r="2"/></svg>`,
  send: `<svg viewBox="0 0 24 24" ${S}><path d="M12 19V5M12 5l-5 5M12 5l5 5"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" ${S}><rect x="7" y="7" width="10" height="10" rx="1"/></svg>`,
  tool: `<svg viewBox="0 0 24 24" ${S}><path d="M14.5 6.5a4 4 0 0 0-5.6 4.8L4 16.2V20h3.8l4.9-4.9a4 4 0 0 0 4.8-5.6l-2.7 2.7-2.3-2.3 2-2.4z"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" ${S}><path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4M12 17.5v.5"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" ${S}><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" ${S}><path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" ${S}><path d="M3 6h6l2 2h10v11H3V6z"/></svg>`,
  projects: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/></svg>`,
  file: `<svg viewBox="0 0 24 24" ${S}><path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4"/></svg>`,
  search: `<svg viewBox="0 0 24 24" ${S}><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" ${S}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" ${S}><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" ${S}><path d="M4 12a8 8 0 0 1 13-6M20 12a8 8 0 0 1-13 6"/><path d="M17 3v4h-4M7 21v-4h4"/></svg>`,
  history: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  map: `<svg viewBox="0 0 24 24" ${S}><circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7.5 7.5l3 9M16.5 9l-3 7"/></svg>`,
  branch: `<svg viewBox="0 0 24 24" ${S}><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M8 6h8a4 4 0 0 1 4 4"/></svg>`,
  brief: `<svg viewBox="0 0 24 24" ${S}><path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>`,
  review: `<svg viewBox="0 0 24 24" ${S}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
}

export function mountNavIcons() {
  const map = {
    projects: 'projects', chat: 'chat', console: 'console', studio: 'studio', settings: 'settings', map: 'map', brief: 'brief',
  }
  document.querySelectorAll('.act[data-view]').forEach(btn => {
    const k = map[btn.dataset.view]
    if (k && ICONS[k]) btn.innerHTML = ICONS[k]
  })
  const tree = document.getElementById('treeToggle')
  if (tree) tree.innerHTML = ICONS.files
  const cp = document.getElementById('cmdPaletteBtn')
  if (cp) cp.innerHTML = ICONS.search
  const rv = document.getElementById('openReview')
  if (rv) rv.innerHTML = ICONS.review
  const ht = document.getElementById('histToggle')
  if (ht) ht.innerHTML = ICONS.history
}

export const LIMITS = Object.freeze({ nodes: 60, browsers: 8, minZoom: 0.25, maxZoom: 1.75, fileBytes: 24 * 1024 * 1024 });
export const KINDS = ['browser', 'note', 'text', 'shape', 'image'];
export const PALETTE = ['#fff0b3', '#e4dcff', '#d6eee4', '#ffdcd4', '#d9eaff'];
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (v, fallback, min, max) => typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
const string = (v, fallback = '', limit = 8000) => typeof v === 'string' ? v.slice(0, limit) : fallback;
export function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096) throw new Error('Enter a valid website address.');
  let value = input.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^[\w.-]+:\d+(?:\/|$)/.test(value)) value = `https://${value}`;
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid website address, such as https://example.com.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Only HTTP and HTTPS websites without embedded credentials are supported.');
  return url.href;
}
export function isWebUrl(input) { try { return ['https:', 'http:'].includes(new URL(input).protocol); } catch { return false; } }
export function validateImage(value) {
  return typeof value === 'string' && value.length <= 7_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
}
export function validateBoard(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.nodes)) throw new Error('This is not a supported Web Canvas board (version 1).');
  if (raw.nodes.length > LIMITS.nodes) throw new Error(`A board can contain at most ${LIMITS.nodes} objects.`);
  const ids = new Set();
  let browsers = 0;
  const nodes = raw.nodes.map((n) => {
    if (!n || !KINDS.includes(n.type) || typeof n.id !== 'string' || !/^[\w-]{1,80}$/.test(n.id) || ids.has(n.id)) throw new Error('The board contains an invalid or duplicate object.');
    ids.add(n.id);
    const node = { id: n.id, type: n.type, x: finite(n.x, 0, -100000, 100000), y: finite(n.y, 0, -100000, 100000), w: finite(n.w, 320, n.type === 'browser' ? 360 : 120, 1800), h: finite(n.h, 220, n.type === 'browser' ? 260 : 80, 1400), title: string(n.title, '', 200), text: string(n.text), color: PALETTE.includes(n.color) ? n.color : PALETTE[0] };
    if (n.type === 'browser') { node.url = normalizeUrl(n.url); if (++browsers > LIMITS.browsers) throw new Error(`A board can contain at most ${LIMITS.browsers} websites.`); }
    if (n.type === 'image') { if (!validateImage(n.src)) throw new Error('Images must be embedded PNG, JPEG, or WebP files (up to 5 MB).'); node.src = n.src; }
    return node;
  });
  const camera = raw.camera || {};
  const board = { version: 1, name: string(raw.name, 'Untitled canvas', 100), camera: { x: finite(camera.x, 90, -200000, 200000), y: finite(camera.y, 90, -200000, 200000), z: finite(camera.z, 0.8, LIMITS.minZoom, LIMITS.maxZoom) }, nodes };
  if (JSON.stringify(board).length > LIMITS.fileBytes) throw new Error('This board is too large. Use smaller images.');
  return board;
}
export function createNode(type, x, y, extra = {}) {
  if (!KINDS.includes(type)) throw new Error('Unknown canvas object.');
  return { id: globalThis.crypto.randomUUID(), type, x, y, w: type === 'browser' ? 620 : type === 'text' ? 420 : 290, h: type === 'browser' ? 490 : type === 'text' ? 110 : 230, title: type === 'browser' ? 'New website' : type === 'note' ? 'A little thought' : type === 'shape' ? 'New shape' : type === 'image' ? 'Image' : 'Text', text: type === 'note' ? 'Double-click to make this thought your own.' : type === 'text' ? 'Make room for your next idea.' : '', color: PALETTE[0], ...extra };
}
export function createBoard() {
  return { version: 1, name: 'A space for discovery', camera: { x: 80, y: 76, z: 0.8 }, nodes: [
    createNode('text', 0, -20, { w: 600, h: 120, title: 'Start here', text: 'Good ideas need\na little more space.' }),
    createNode('browser', 0, 135, { url: 'https://example.com/', title: 'Example Domain', w: 620, h: 470 }),
    createNode('note', 660, 135, { title: 'WELCOME TO YOUR CANVAS', text: 'Collect the web.\nConnect the dots.\nMake something new.\n\nAdd a website, leave a thought, and see where it takes you.', w: 300, h: 290 }),
    createNode('shape', 675, 470, { title: 'Room to explore', text: 'Follow your curiosity ↗', color: PALETTE[2], w: 280, h: 140 }),
    createNode('browser', 1005, 135, { url: 'https://www.wikipedia.org/', title: 'Wikipedia', w: 620, h: 470 })
  ] };
}
export const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export function contentRect(node, camera, viewport) {
  return { x: Math.round(viewport.x + camera.x + node.x * camera.z + camera.z), y: Math.round(viewport.y + camera.y + (node.y + 84) * camera.z), width: Math.max(1, Math.round((node.w - 2) * camera.z)), height: Math.max(1, Math.round((node.h - 85) * camera.z)) };
}
export function liveEligibility(node, index, board, viewport, blocked = false) {
  if (blocked || board.camera.z < 0.5) return false;
  const r = contentRect(node, board.camera, viewport);
  if (r.x < viewport.x || r.y < viewport.y || r.x + r.width > viewport.x + viewport.width || r.y + r.height > viewport.y + viewport.height) return false;
  const contentWorld = { x: node.x, y: node.y + 84, w: node.w, h: node.h - 84 };
  return !board.nodes.slice(index + 1).some(n => overlaps(contentWorld, n));
}
export function fitCamera(nodes, width, height, maxZoom = 1) {
  if (!nodes.length) return { x: width / 2, y: height / 2, z: 1 };
  const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
  const right = Math.max(...nodes.map(n => n.x + n.w)), bottom = Math.max(...nodes.map(n => n.y + n.h));
  const z = clamp(Math.min((width - 100) / (right - left), (height - 100) / (bottom - top), maxZoom), LIMITS.minZoom, LIMITS.maxZoom);
  return { x: (width - (right - left) * z) / 2 - left * z, y: (height - (bottom - top) * z) / 2 - top * z, z };
}

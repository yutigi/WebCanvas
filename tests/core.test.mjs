import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, createNode, validateBoard, normalizeUrl, validateImage, isWebUrl, fitCamera, contentRect, liveEligibility, overlaps, LIMITS } from '../src/core.mjs';

const boardWith = nodes => ({ version: 1, name: 'Research', nodes, camera: { x: 80, y: 60, z: 1 } });
const browser = extra => createNode('browser', 0, 0, { url: 'https://example.com/', ...extra });
const viewport = { x: 238, y: 141, width: 1200, height: 800 };

test('addresses default to HTTPS and retain explicit development ports', () => {
  assert.equal(normalizeUrl(' example.com/path?q=1 '), 'https://example.com/path?q=1');
  assert.equal(normalizeUrl('localhost:3000/demo'), 'https://localhost:3000/demo');
  assert.equal(normalizeUrl('http://127.0.0.1:4173/'), 'http://127.0.0.1:4173/');
});
test('non-web schemes, embedded credentials, and invalid input are rejected', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,test', 'file:///C:/secret', 'mailto:a@example.com', 'https://user:password@example.com', '', 'https://', null]) assert.throws(() => normalizeUrl(input));
  assert.equal(isWebUrl('file:///etc/passwd'), false);
  assert.equal(isWebUrl('https://example.com/'), true);
});
test('a saved board round-trips geometry, URLs, text, image bytes, and camera', () => {
  const image = createNode('image', -80, 900, { src: 'data:image/png;base64,AAAA', title: 'Reference' });
  const original = validateBoard(boardWith([browser({ x: -300, w: 777 }), createNode('note', 40, -80, { text: 'Research ไทย' }), image]));
  const restored = validateBoard(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored, original);
});
test('transient page state and prototype-pollution keys do not enter board files', () => {
  const raw = boardWith([browser({ cookies: 'secret', snapshot: 'private pixels', preload: 'dangerous.cjs' })]);
  raw.__proto__ = { dangerous: true };
  const clean = validateBoard(raw);
  assert.equal(clean.nodes[0].cookies, undefined);
  assert.equal(clean.nodes[0].preload, undefined);
  assert.equal(clean.dangerous, undefined);
});
test('unsupported versions, duplicate identities, and unknown node types fail', () => {
  const node = browser();
  assert.throws(() => validateBoard({ ...boardWith([]), version: 2 }));
  assert.throws(() => validateBoard(boardWith([node, node])));
  assert.throws(() => validateBoard(boardWith([{ ...node, id: '../secret' }])));
  assert.throws(() => validateBoard(boardWith([{ ...node, type: 'script' }])));
});
test('imported websites cannot bypass URL policy', () => {
  assert.throws(() => validateBoard(boardWith([browser({ url: 'file:///C:/Windows' })])));
});
test('board resource limits are enforced before creating native views', () => {
  assert.throws(() => validateBoard(boardWith(Array.from({ length: LIMITS.browsers + 1 }, () => browser()))));
  assert.throws(() => validateBoard(boardWith(Array.from({ length: LIMITS.nodes + 1 }, () => createNode('note', 0, 0)))));
});
test('nonfinite coordinates and dimensions are repaired; sizes and zoom are bounded', () => {
  const raw = boardWith([browser({ x: NaN, y: Infinity, w: -1, h: 9e8 })]);
  raw.camera.z = 1000;
  const clean = validateBoard(raw);
  assert.equal(clean.nodes[0].x, 0); assert.equal(clean.nodes[0].y, 0);
  assert.equal(clean.nodes[0].w, 360); assert.equal(clean.nodes[0].h, 1400);
  assert.equal(clean.camera.z, LIMITS.maxZoom);
});
test('images are restricted to bounded embedded raster data', () => {
  assert.equal(validateImage('data:image/png;base64,AAAA'), true);
  for (const value of ['https://tracker.example/image.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,<script>', `data:image/png;base64,${'A'.repeat(7_000_001)}`]) assert.equal(validateImage(value), false);
  assert.throws(() => validateBoard(boardWith([createNode('image', 0, 0, { src: 'file:///secret.png' })])));
});
test('untrusted labels are preserved as text, never interpreted by the board model', () => {
  const text = '<img src=x onerror=alert(1)>';
  assert.equal(validateBoard(boardWith([createNode('note', 0, 0, { text })])).nodes[0].text, text);
});
test('initial board is valid and identities are unique', () => {
  const board = createBoard();
  assert.equal(validateBoard(board).nodes.length, 5);
  assert.equal(new Set(board.nodes.map(n => n.id)).size, 5);
  assert.throws(() => createNode('unknown', 0, 0));
});
test('world-to-window geometry reserves card browsing controls', () => {
  assert.deepEqual(contentRect(browser({ w: 620, h: 490 }), { x: 80, y: 60, z: 1 }, viewport), { x: 319, y: 285, width: 618, height: 405 });
});
test('multiple fully contained sites can be live at the same time', () => {
  const a = browser({ w: 400, h: 350 }), b = browser({ x: 450, w: 400, h: 350 });
  const board = boardWith([a, b]);
  assert.equal(liveEligibility(a, 0, board, viewport), true);
  assert.equal(liveEligibility(b, 1, board, viewport), true);
});
test('overview zoom and modal interactions always suppress native views', () => {
  const node = browser(), board = boardWith([node]);
  assert.equal(liveEligibility(node, 0, board, viewport, true), false);
  board.camera.z = .49;
  assert.equal(liveEligibility(node, 0, board, viewport), false);
});
test('partially clipped native content cannot cover shell chrome', () => {
  const node = browser(), board = boardWith([node]);
  board.camera.x = -50;
  assert.equal(liveEligibility(node, 0, board, viewport), false);
  board.camera.x = 80; board.camera.y = -100;
  assert.equal(liveEligibility(node, 0, board, viewport), false);
});
test('overlapping notes suppress the website below; a lower note does not', () => {
  const node = browser(), note = createNode('note', 100, 200);
  assert.equal(liveEligibility(node, 0, boardWith([node, note]), viewport), false);
  assert.equal(liveEligibility(node, 1, boardWith([note, node]), viewport), true);
});
test('fit handles empty boards and frames negative world coordinates', () => {
  assert.deepEqual(fitCamera([], 1000, 800), { x: 500, y: 400, z: 1 });
  const node = createNode('note', -400, -500, { w: 300, h: 200 });
  const camera = fitCamera([node], 1000, 800);
  assert.equal(camera.x + node.x * camera.z + node.w * camera.z / 2, 500);
  assert.equal(camera.y + node.y * camera.z + node.h * camera.z / 2, 400);
});
test('objects that only touch at an edge do not occlude one another', () => {
  assert.equal(overlaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 50, h: 50 }), false);
});

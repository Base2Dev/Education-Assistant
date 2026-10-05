const frame = document.getElementById('frame');
let start, completed = false;
window.capture.data().then(data => { document.getElementById('screen').src = data.image; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.capture.cancel(); });
document.addEventListener('pointerdown', e => {
  e.preventDefault();
  document.body.setPointerCapture(e.pointerId);
  start = { x: e.clientX, y: e.clientY };
});
document.addEventListener('pointermove', e => {
  if (!start || completed) return;
  document.getElementById('dim').style.display = 'none';
  frame.style.display = 'block';
  Object.assign(frame.style, { left: Math.min(start.x, e.clientX) + 'px', top: Math.min(start.y, e.clientY) + 'px', width: Math.abs(e.clientX - start.x) + 'px', height: Math.abs(e.clientY - start.y) + 'px' });
});
document.addEventListener('pointerup', async e => {
  if (!start || completed) return;
  completed = true;
  if (document.body.hasPointerCapture(e.pointerId)) document.body.releasePointerCapture(e.pointerId);
  try { await window.capture.select({ x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y), pointX: e.clientX, pointY: e.clientY }); }
  catch { window.capture.cancel(); }
});

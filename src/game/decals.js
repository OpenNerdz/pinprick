// Writing on the walls that only shows up in scanner dots. Each decal is rasterised once into a
// small mask; when a scanner ray lands on that patch of wall, the dot takes the writing's colour.

const FACES = {n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0]};
const PX_PER_M = 56;

export function buildDecals(decals) {
  for (const d of decals) {
    const [nx, nz] = FACES[d.face];
    d.nx = nx; d.nz = nz;
    d.rx = nz; d.rz = -nx;           // text runs to the right of someone facing the wall
    d.mask = null;
    if (typeof document === 'undefined') continue;
    const mw = Math.max(8, Math.round(d.w * PX_PER_M)), mh = Math.max(8, Math.round(d.h * PX_PER_M));
    const c = document.createElement('canvas'); c.width = mw; c.height = mh;
    const g = c.getContext('2d');
    const lines = d.text.split('\n');
    let size = mh / lines.length * 0.78;
    g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`;
    const widest = Math.max(...lines.map(l => g.measureText(l).width));
    if (widest > mw * 0.94) { size *= mw * 0.94 / widest; g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`; }
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // hand-written look: each line a little crooked
    lines.forEach((l, i) => {
      g.save();
      g.translate(mw / 2, (i + 0.5) * mh / lines.length);
      g.rotate((Math.sin(i * 7.3 + d.text.length) * 0.04));
      g.lineWidth = size * 0.08; g.strokeStyle = '#fff'; g.lineJoin = 'round';
      g.strokeText(l, 0, 0);
      g.fillText(l, 0, 0);
      g.restore();
    });
    const px = g.getImageData(0, 0, mw, mh).data, mask = new Uint8Array(mw * mh);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 110 ? 1 : 0;
    d.mask = mask; d.mw = mw; d.mh = mh;
  }
  return decals;
}

/** True when a wall hit at (x, y, z) with normal (nx, nz) lands on a letter. */
export function decalAt(decals, x, y, z, nx, nz) {
  for (let i = 0; i < decals.length; i++) {
    const d = decals[i];
    if (!d.mask || nx !== d.nx || nz !== d.nz) continue;
    const px = x - d.x, pz = z - d.z;
    if (Math.abs(px * d.nx + pz * d.nz) > 0.08) continue;
    const u = (px * d.rx + pz * d.rz) / d.w + 0.5, v = 0.5 - (y - d.y) / d.h;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    if (d.mask[Math.floor(v * d.mh) * d.mw + Math.floor(u * d.mw)]) return true;
  }
  return false;
}

import * as THREE from 'three';
import { cssVar } from '../utils/css';

/**
 * Constant-size text label drawn on a canvas texture (no DOM, no extra React roots).
 * Styled from tokens: surface fill, border outline, mono or sans text.
 */
export function makeLabel(text: string, opts: { strong?: boolean } = {}): THREE.Sprite {
  const ratio = 2;
  const font = opts.strong
    ? `500 ${12 * ratio}px ${cssVar('--font-sans', 'sans-serif')}`
    : `400 ${11 * ratio}px ${cssVar('--font-mono', 'monospace')}`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const pad = 4 * ratio;
  let w = 80;
  if (ctx) {
    ctx.font = font;
    w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  }
  const h = 18 * ratio;
  canvas.width = w;
  canvas.height = h;
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = cssVar('--surface', '#ffffff');
    ctx.strokeStyle = cssVar('--border', '#cbd2d9');
    ctx.lineWidth = ratio;
    ctx.beginPath();
    ctx.roundRect(ratio / 2, ratio / 2, w - ratio, h - ratio, 4 * ratio);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = opts.strong ? cssVar('--text', '#1f2933') : cssVar('--muted', '#52606d');
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, h / 2 + ratio);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
    }),
  );
  // sizeAttenuation=false: scale is a fraction of the viewport height.
  const scaleY = 0.04;
  sprite.scale.set((scaleY * w) / h, scaleY, 1);
  sprite.center.set(0.5, -0.4);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeLabel(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

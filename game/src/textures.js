// Procedural textures: every surface the yard shows is drawn once on a small
// canvas and tiled, so the map reads as concrete, asphalt, brick and steel
// instead of flat colour — with no image files, no network and no extra bytes
// in the dossier beyond this one module. All albedo textures are sRGB.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

function tile(size, seed, draw, rx, ry) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const random = mulberry32(seed);
  draw(ctx, size, random);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(rx, ry);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, size, random, n, colors, a, b) {
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    const s = a + random() * (b - a);
    ctx.fillRect(random() * size, random() * size, s, s);
  }
}

export function makeTextures() {
  const concrete = tile(256, 11, (ctx, size, random) => {
    ctx.fillStyle = '#b9b3a4';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, 900, ['#a8a292', '#c8c2b2', '#9a9484'], 1, 3);
    ctx.strokeStyle = 'rgba(90, 84, 70, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      let x = random() * size;
      let y = random() * size;
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j += 1) {
        x += (random() - 0.5) * 60;
        y += (random() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, 6, 4);
  const asphalt = tile(256, 23, (ctx, size, random) => {
    ctx.fillStyle = '#6f7268';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, 1400, ['#5d6056', '#7e8178', '#4c4f46', '#8a8d80'], 1, 2);
    ctx.strokeStyle = 'rgba(40, 42, 38, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);
  }, 8, 6);
  const corrugated = tile(256, 37, (ctx, size, random) => {
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = (x / 16) % 2 === 0 ? '#8a7d4f' : '#6e6340';
      ctx.fillRect(x, 0, 16, size);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, 0, 2, size);
    }
    speckle(ctx, size, random, 260, ['#8a5a2e', '#5d4a26'], 2, 8);
  }, 2, 1);
  const hazard = tile(128, 41, (ctx, size) => {
    ctx.fillStyle = '#e8b62a';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#1e2228';
    for (let x = -size; x < size * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 16 + size, size);
      ctx.lineTo(x + size, size);
      ctx.closePath();
      ctx.fill();
    }
  }, 4, 1);
  const brick = tile(256, 53, (ctx, size, random) => {
    ctx.fillStyle = '#8a4a30';
    ctx.fillRect(0, 0, size, size);
    const bh = 16;
    const bw = 42;
    for (let y = 0; y < size; y += bh) {
      const off = (y / bh) % 2 === 0 ? 0 : bw / 2;
      for (let x = -bw; x < size + bw; x += bw) {
        ctx.fillStyle = ['#a05a3c', '#93523a', '#ab6242'][Math.floor(random() * 3)];
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
  }, 4, 2);
  return { concrete, asphalt, corrugated, hazard, brick };
}

// A painted site sign: big letter, small name, on a dark plate.
export function labelTexture(letter, name, fg = '#f0a830') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e2228';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = fg;
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 66);
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(name, 118, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

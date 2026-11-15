// Deadlock Yard: an original 46 x 32 m daylight yard, not a copy of any real
// map. Vanguard (the player) spawns south and attacks; Sentinel bots spawn
// north and hold two bomb sites, Foundry (A, west, brick and furnace) and Silo
// (B, east, steel tanks and pipes), joined by a mid lane, two side lanes and a
// back corridor. Every box is a collider and a surface bullets stop on. The
// waypoint graph is the map bots think with: nodes at every lane, corner and
// site, edges where a bot can walk straight between two nodes.
import * as THREE from 'three';
import { colour } from './palette.js';
import { makeTextures, labelTexture } from './textures.js';

function siteTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e2228';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#f0a830';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.fillStyle = '#f0a830';
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const textures = makeTextures();

  const materials = {
    asphalt: new THREE.MeshStandardMaterial({ map: textures.asphalt, roughness: 0.95, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: textures.concrete, roughness: 0.9, metalness: 0 }),
    corrugated: new THREE.MeshStandardMaterial({ map: textures.corrugated, roughness: 0.75, metalness: 0.25 }),
    hazard: new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.8, metalness: 0.05 }),
    brick: new THREE.MeshStandardMaterial({ map: textures.brick, roughness: 0.9, metalness: 0 }),
    steel: new THREE.MeshStandardMaterial({ color: colour('steel'), roughness: 0.55, metalness: 0.25 }),
    silo: new THREE.MeshStandardMaterial({ color: colour('silo'), roughness: 0.5, metalness: 0.25 }),
    rust: new THREE.MeshStandardMaterial({ color: colour('rust'), roughness: 0.8, metalness: 0.15 }),
    accent: new THREE.MeshStandardMaterial({ color: colour('accent'), roughness: 0.55, metalness: 0.2 }),
    ink: new THREE.MeshStandardMaterial({ color: colour('ink'), roughness: 0.85, metalness: 0.03 }),
  };

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // A cylinder prop with a box collider of the same footprint, so bots walk
  // around it and bullets stop on it. Decorative pipes high on the walls use
  // no collider: they are out of every path and sightline that matters.
  function cylinder(r, h, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3(new THREE.Vector3(x - r, y - h / 2, z - r), new THREE.Vector3(x + r, y + h / 2, z + r)));
      shootables.push(mesh);
    }
    return mesh;
  }

  function decal(letter, x, z) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 6.4),
      new THREE.MeshStandardMaterial({ map: siteTexture(letter), roughness: 0.9, metalness: 0 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function sign(letter, name, x, y, z, fg) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 2.5),
      new THREE.MeshStandardMaterial({ map: labelTexture(letter, name, fg), roughness: 0.85, metalness: 0 }),
    );
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  // Floor and the outer shell, 46 x 32 m, 5 m walls, open to the sky.
  box(46.6, 0.4, 32.6, 0, -0.2, 0, 'asphalt');
  box(0.6, 5, 32.6, -23.2, 2.5, 0, 'concrete');
  box(0.6, 5, 32.6, 23.2, 2.5, 0, 'concrete');
  box(46.6, 5, 0.6, 0, 2.5, -16.2, 'concrete');
  box(46.6, 5, 0.6, 0, 2.5, 16.2, 'concrete');
  // Hazard trim along the wall tops and the mid lane, so the yard reads at a glance.
  box(46.6, 0.18, 0.7, 0, 5.05, -16.2, 'hazard');
  box(46.6, 0.18, 0.7, 0, 5.05, 16.2, 'hazard');
  box(1.8, 0.12, 0.7, -2.1, 3.26, 0, 'hazard');
  box(1.8, 0.12, 0.7, 2.1, 3.26, 0, 'hazard');

  // Mid dividers: west and east walls with one connector gap each (z -4..-1).
  box(0.6, 3.4, 10, -8, 1.7, -9, 'concrete');
  box(0.6, 3.4, 15, -8, 1.7, 6.5, 'concrete');
  box(0.6, 3.4, 10, 8, 1.7, -9, 'concrete');
  box(0.6, 3.4, 15, 8, 1.7, 6.5, 'concrete');
  // Mid wall at z = 0 with a centre doorway.
  box(1.8, 3.2, 0.6, -2.1, 1.6, 0, 'concrete');
  box(1.8, 3.2, 0.6, 2.1, 1.6, 0, 'concrete');

  // Cover: crates to crouch behind, tall containers that block sightlines.
  box(1.2, 1.1, 1.2, -18, 0.55, 6, 'corrugated');
  box(1.2, 1.1, 1.2, -14, 0.55, -1, 'corrugated');
  box(1.2, 2.6, 1.2, -19, 1.3, -8, 'concrete');
  box(1.2, 1.1, 1.2, 18, 0.55, 6, 'corrugated');
  box(1.2, 1.1, 1.2, 14, 0.55, -1, 'corrugated');
  box(1.2, 2.6, 1.2, 19, 1.3, -8, 'concrete');
  box(3.0, 2.6, 1.6, 0, 1.3, -8, 'concrete');
  box(1.2, 1.1, 1.2, 2.5, 0.55, 8, 'corrugated');
  box(1.2, 1.1, 1.2, -2.5, 0.55, 8, 'corrugated');
  box(3.2, 1.0, 1.2, -5, 0.5, 12, 'corrugated');
  box(3.2, 1.0, 1.2, 5, 0.5, 12, 'corrugated');
  box(1.6, 0.7, 1.6, -12, 0.35, -12, 'corrugated');
  box(1.6, 0.7, 1.6, 12, 0.35, -12, 'corrugated');
  // Pallets and drums, kept clear of every waypoint and edge.
  box(1.6, 0.18, 1.2, -12, 0.09, 10.5, 'rust');
  box(1.6, 0.18, 1.2, 12, 0.09, 10.5, 'rust');
  cylinder(0.45, 1.1, -21, 0.55, 10, 'rust');
  cylinder(0.45, 1.1, -21, 0.55, 3, 'steel');
  cylinder(0.45, 1.1, 21, 0.55, 10, 'rust');
  cylinder(0.45, 1.1, 21, 0.55, -2, 'steel');
  // Overhead pipes along the north wall: decoration only, above head height.
  const pipeN = cylinder(0.16, 44, 0, 4.2, -15.8, 'steel', false);
  pipeN.rotation.z = Math.PI / 2;
  const pipeS = cylinder(0.16, 44, 0, 4.2, 15.8, 'rust', false);
  pipeS.rotation.z = Math.PI / 2;

  // Foundry (site A, west): brick back wall, a furnace with a chimney, orange trim.
  box(10.4, 5, 0.5, -18, 2.5, -15.9, 'brick');
  cylinder(1.7, 3.2, -20.5, 1.6, -12.5, 'rust');
  cylinder(0.5, 4.6, -20.5, 2.3, -12.5, 'steel');
  box(0.5, 0.5, 6, -21.5, 0.25, -9, 'hazard');
  sign('A', 'FOUNDRY', -16, 3.4, -15.6, '#f0a830');
  // Silo (site B, east): two steel tanks, a horizontal feed pipe, blue trim.
  cylinder(1.5, 4.4, 20.2, 2.2, -12.5, 'silo');
  cylinder(1.5, 4.4, 20.2, 2.2, -6.2, 'steel');
  const feed = cylinder(0.22, 7, 20.2, 4.6, -9.3, 'steel', false);
  feed.rotation.x = Math.PI / 2;
  box(0.5, 0.5, 6, 21.5, 0.25, -9, 'hazard');
  sign('B', 'SILO', 16, 3.4, -15.85, '#7fb8d8');

  // Bomb sites: floor decals and accent corner posts.
  decal('A', -16, -9);
  decal('B', 16, -9);
  for (const [x, z] of [[-19.4, -12.4], [-12.6, -12.4], [12.6, -12.4], [19.4, -12.4]]) {
    box(0.3, 1.4, 0.3, x, 0.7, z, 'accent');
  }

  const sites = [
    { name: 'A', label: 'Foundry', center: new THREE.Vector3(-16, 0, -9), box: new THREE.Box3(new THREE.Vector3(-19.5, 0, -12.5), new THREE.Vector3(-12.5, 3, -5.5)) },
    { name: 'B', label: 'Silo', center: new THREE.Vector3(16, 0, -9), box: new THREE.Box3(new THREE.Vector3(12.5, 0, -12.5), new THREE.Vector3(19.5, 3, -5.5)) },
  ];
  const spawns = {
    vanguard: { x: 0, z: 13.5, yaw: 0 },
    sentinel: { x: 0, z: -13.5, yaw: Math.PI },
    bots: [[-4, -13.5], [4, -13.5], [-10, -13.5], [10, -13.5]],
  };

  // Waypoint graph: [x, z] nodes and undirected edges between walkable neighbours.
  const nodes = [
    [0, 13.5], [0, 8], [0, 2], [0, -2], [0, -11], [0, -13.5],
    [-15, 13], [-15, 8], [-15, 0], [-16, -9], [-15, -14.5],
    [15, 13], [15, 8], [15, 0], [16, -9], [15, -14.5],
    [-8, -2.5], [8, -2.5],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 6], [6, 7], [7, 8], [8, 9],
    [9, 10], [10, 5], [0, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 5],
    [2, 16], [16, 8], [2, 17], [17, 13], [4, 9], [4, 14],
  ];
  const adjacency = nodes.map(() => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const dx = nodes[i][0] - x;
      const dz = nodes[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // Breadth-first route between two nodes; returns node indices, start excluded.
  function findPath(from, to) {
    if (from === to) return [];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adjacency[cur]) {
        if (prev[next] !== -1) continue;
        prev[next] = cur;
        if (next === to) {
          const path = [to];
          let at = to;
          while (at !== from) {
            at = prev[at];
            path.unshift(at);
          }
          return path.slice(1);
        }
        queue.push(next);
      }
    }
    return [];
  }

  // Light: a warm sun from the south-east, a cool sky fill from the north-west,
  // and a pale sky behind it all — bright walls, darker recesses, readable bots.
  const sky = new THREE.HemisphereLight(colour('fill'), colour('concrete'), 0.85);
  scene.add(sky);
  const key = new THREE.DirectionalLight(colour('sun'), 3.0);
  key.position.set(14, 18, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(colour('fill'), 0.5);
  fill.position.set(-12, 10, -12);
  scene.add(fill);

  return { colliders, shootables, group, sites, spawns, nodes, adjacency, nearestNode, findPath };
}

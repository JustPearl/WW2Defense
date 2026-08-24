// ── Steel & Tactics — Three.js engine ───────────────────────────────────────
import * as THREE from "three";
import {
  TOWER_DEFS, TOWER_ORDER, ENEMY_DEFS, WAVES, TowerKind, EnemyKind, TowerDef, EnemyDef, WaveDef, WaveEntry,
  SELL_RATIO, CP_MAX, ARTY_COST, BASE_MAX, ENDLESS_LABELS,
} from "./defs";
import { sfx } from "./audio";

// ── UI contracts ────────────────────────────────────────────────────────────
export interface HudData {
  rp: number; cp: number; baseHp: number; baseMax: number;
  wave: number; waveTotal: number; hostiles: number; kills: number; score: number;
  time: number; speed: number; between: boolean; nextIn: number; muted: boolean;
}
export interface SelData {
  id: number; kind: TowerKind; name: string; hp: number; maxHp: number;
  ammo: number; maxAmmo: number; tier: number; range: number; minRange: number;
  upgradeName: string | null; upgradeCost: number; upgradeDesc: string;
  targetMode: string; structure: boolean; sellValue: number; carrier: boolean;
}
export interface Stats { kills: number; score: number; wave: number; time: number }
export type Screen = "menu" | "playing" | "paused" | "over" | "won";
export type UiMsg =
  | { t: "hud"; hud: HudData; sel: SelData | null; build: TowerKind | null; ability: string | null }
  | { t: "screen"; screen: Screen; stats: Stats }
  | { t: "banner"; text: string; sub: string; tone: "warn" | "good" | "info" }
  | { t: "flash"; p: number }
  | { t: "dmg" }
  | { t: "toast"; text: string };

// ── tiny helpers ────────────────────────────────────────────────────────────
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const angLerp = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
};
const TARGET_MODES = ["FIRST", "NEAR", "STRONG", "AIR PRIORITY"];

// ── entity types ────────────────────────────────────────────────────────────
interface Tower {
  id: number; kind: TowerKind; def: TowerDef;
  group: THREE.Group; turret: THREE.Group; barrel: THREE.Group; muzzle: THREE.Object3D;
  elevNode: THREE.Object3D;
  breech: THREE.Mesh | null; loader: THREE.Object3D | null; hitMesh: THREE.Mesh;
  pos: THREE.Vector3; hp: number; maxHp: number; ammo: number; maxAmmo: number;
  cooldown: number; reloadT: number; reloadMax: number; aiT: number;
  tier: number; dmgMul: number; penMul: number; rofMul: number; rangeMul: number;
  splashMul: number; travMul: number;
  targetMode: number; target: Enemy | null; recoil: number; flashT: number;
  elev: number;
  dead: boolean; invested: number; hpBar: THREE.Group | null;
  // CAS post state (airpost only)
  airT: number; airPhase: number; airRunT: number; airGone: boolean; airActive: number;
  airPlane: THREE.Group | null; airPlane2: THREE.Group | null;
  airA: THREE.Vector3; airB: THREE.Vector3; airTick: number; airRocketed: number; airSnd: number;
}
interface Enemy {
  id: number; kind: EnemyKind; def: EnemyDef;
  group: THREE.Group; soldiers: THREE.Object3D[]; pos: THREE.Vector3; vel: THREE.Vector3;
  heading: number; dist: number; hp: number; maxHp: number; flashT: number;
  dead: boolean; flying: boolean; lane: number; flyY: number; bombDropped: boolean; sirenPlayed: boolean;
  targetId: number; falling: boolean; fallVy: number; hpBar: THREE.Group | null;
  phase: number; bombs: number; strafeT: number; armorMul: number;
  burnT: number; markT: number; markMul: number;
}
interface Proj {
  mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3;
  dmg: number; pen: number; splash: number; splashDmg: number;
  kind: "tracer" | "shell" | "flak" | "bomb" | "arty";
  life: number; manual: boolean; dead: boolean;
}
interface Particle {
  pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number;
  size: number; grow: number; grav: number; drag: number;
}
interface Truck { group: THREE.Group; pos: THREE.Vector3; towerId: number; state: "go" | "unload" | "back"; unloadT: number }
interface Wreck { group: THREE.Group; life: number; smokeT: number }
interface Crater { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; maxLife: number; s0: number }
interface Gib { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; rotV: THREE.Vector3; life: number; maxLife: number; s: number }

const GRAV = 22;
const SPARK_MAX = 260;
const SMOKE_MAX = 170;

// ── Engine ──────────────────────────────────────────────────────────────────
export class Engine {
  private canvas: HTMLCanvasElement;
  private onUi: (m: UiMsg) => void;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  // world
  private terrain!: THREE.Mesh;
  private dyn!: THREE.Group;
  private hq!: THREE.Group;
  private hqBarFg!: THREE.Mesh;
  private hqFlag: THREE.Mesh | null = null;
  private pathPts: THREE.Vector3[] = [];
  private pathCum: number[] = [];
  private pathTotal = 0;
  private chevrons: THREE.Mesh[] = [];
  private chevT = 0;

  // camera control
  private camTarget = new THREE.Vector3(-6, 0, -2);
  private camDist = 58;
  private camPitch = 0.94;
  private camDistGoal = 58;
  private camPitchGoal = 0.94;
  private shake = 0;
  shakeScale = 0.7;

  // input
  private keys: Record<string, boolean> = {};
  private mouse = new THREE.Vector2();
  private mousePx = { x: 0, y: 0 };
  private downPx = { x: 0, y: 0 };
  private dragging = false;
  private raycaster = new THREE.Raycaster();
  private hoverPoint = new THREE.Vector3();
  private hoverOk = false;

  // pools & fx
  private sparkMesh!: THREE.InstancedMesh;
  private smokeMesh!: THREE.InstancedMesh;
  private sparks: Particle[] = [];
  private smokes: Particle[] = [];
  private dummy = new THREE.Object3D();
  private flashLights: THREE.PointLight[] = [];
  private craters: Crater[] = [];
  private craterGeo = new THREE.CircleGeometry(1, 26);
  private craterTex!: THREE.Texture;
  private gibs: Gib[] = [];
  private gibGeos: THREE.BoxGeometry[] = [];
  private gibColors = [0x4a4f38, 0x3a3e2c, 0x2c2e24, 0x57503a];
  private sparkTex!: THREE.Texture;
  private smokeTex!: THREE.Texture;

  // game state
  state: Screen = "menu";
  private paused = false;
  private speed = 1;
  private rp = 400;
  private cp = 2;
  private baseHp = BASE_MAX;
  private kills = 0;
  private score = 0;
  private playT = 0;
  private waveIdx = -1;
  private waveT = 0;
  private between = true;
  private nextIn = 12;
  private waveHpMul = 1;
  private burnDps = 6;
  private waveDamageTaken = false;
  private spawnQueue: { kind: EnemyKind; t: number }[] = [];
  private endT = -1;
  private endScreen: Screen = "over";

  private towers: Tower[] = [];
  private enemies: Enemy[] = [];
  private projs: Proj[] = [];
  private trucks: Truck[] = [];
  private wrecks: Wreck[] = [];
  private nextId = 1;

  private selected: Tower | null = null;
  private selRing!: THREE.Group;
  private ghost: THREE.Group | null = null;
  private ghostMatOk!: THREE.MeshBasicMaterial;
  private ghostMatBad!: THREE.MeshBasicMaterial;
  private ghostValid = false;
  private buildKind: TowerKind | null = null;
  private abilityMode: "artillery" | null = null;
  private artyMarker: THREE.Mesh | null = null;
  private hudT = 0;

  // shared assets
  private mats: Record<string, THREE.Material> = {};
  private geos: Record<string, THREE.BufferGeometry> = {};

  constructor(canvas: HTMLCanvasElement, onUi: (m: UiMsg) => void) {
    this.canvas = canvas;
    this.onUi = onUi;
    this.initThree();
    this.initWorld();
    this.initPools();
    this.bindInput();
    this.clock.start();
    this.loop();
  }

  // ── three setup ───────────────────────────────────────────────────────────
  private initThree() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9aa48b);
    this.scene.fog = new THREE.Fog(0x9aa48b, 70, 250);

    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.5, 500);

    const hemi = new THREE.HemisphereLight(0xd8dcc4, 0x3c422c, 1.05);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
    sun.position.set(58, 74, -26);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    const sc = sun.shadow.camera;
    sc.left = -85; sc.right = 85; sc.top = 70; sc.bottom = -70; sc.far = 220;
    sun.shadow.bias = -0.0007;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fb4c8, 0.4);
    rim.position.set(-50, 30, 60);
    this.scene.add(rim);

    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb257, 0, 34, 1.8);
      this.scene.add(l);
      this.flashLights.push(l);
    }

    this.dyn = new THREE.Group();
    this.scene.add(this.dyn);

    // shared materials
    const M = THREE.MeshLambertMaterial;
    this.mats = {
      grassDark: new M({ color: 0x46522e }),
      olive: new M({ color: 0x5d6544 }),
      oliveDark: new M({ color: 0x49523a }),
      steel: new M({ color: 0x6c7276 }),
      steelDark: new M({ color: 0x3f4447 }),
      gunmetal: new M({ color: 0x2e3234 }),
      sandbag: new M({ color: 0x8a7a52 }),
      dirt: new M({ color: 0x5e5138 }),
      concrete: new M({ color: 0x9a978a }),
      wood: new M({ color: 0x6b4f33 }),
      dark: new M({ color: 0x22241d }),
      track: new M({ color: 0x33352c }),
      uniform: new M({ color: 0x4a4f3a }),
      helmet: new M({ color: 0x33372a }),
      burnt: new M({ color: 0x1e1d18 }),
      burntDark: new M({ color: 0x141310 }),
      amber: new M({ color: 0xf2b23e, emissive: 0x8a5c10 }),
      red: new M({ color: 0xb03a3a }),
      wire: new M({ color: 0x41453f }),
      hull: new M({ color: 0x61664f }),
      hullDark: new M({ color: 0x4c5140 }),
      plane: new M({ color: 0x3f4348 }),
      planeAccent: new M({ color: 0xc9a227 }),
      skin: new M({ color: 0xc9a37e }),
      black: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false }),
      barAmber: new THREE.MeshBasicMaterial({ color: 0xf2b23e, depthWrite: false }),
      barRed: new THREE.MeshBasicMaterial({ color: 0xe5484d, depthWrite: false }),
    };
    this.geos = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
      sphere: new THREE.SphereGeometry(1, 8, 8),
      capsule: new THREE.CapsuleGeometry(1, 1, 3, 8),
      cone: new THREE.ConeGeometry(1, 1, 8),
    };
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.geos.box, mat);
    m.scale.set(w, h, d); m.position.set(x, y, z);
    return m;
  }
  private cyl(r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.geos.cyl, mat);
    m.scale.set(r, h, r); m.position.set(x, y, z);
    return m;
  }

  // ── world ─────────────────────────────────────────────────────────────────
  private initWorld() {
    // path
    const pts: [number, number][] = [
      [-84, 6], [-56, 0], [-36, -20], [-10, -27], [12, -8], [32, 12], [52, 22], [66, 22],
    ];
    this.pathPts = pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.pathCum = [0];
    for (let i = 1; i < this.pathPts.length; i++) {
      this.pathCum.push(this.pathCum[i - 1] + this.pathPts[i].distanceTo(this.pathPts[i - 1]));
    }
    this.pathTotal = this.pathCum[this.pathCum.length - 1];

    // terrain
    const W = 176, D = 124;
    const geo = new THREE.PlaneGeometry(W, D, 148, 104);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cA = new THREE.Color(0x4c5a31), cB = new THREE.Color(0x6d7a44), cDirt = new THREE.Color(0x6d5b3e), cTmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      const n = sstep(-1.5, 4, h);
      cTmp.copy(cA).lerp(cB, n * 0.85 + Math.sin(x * 0.9) * Math.cos(z * 0.8) * 0.08 + 0.08);
      const dRoad = this.distToPath(x, z);
      const dirtMix = 1 - sstep(4.2, 8.5, dRoad);
      cTmp.lerp(cDirt, dirtMix);
      colors[i * 3] = cTmp.r; colors[i * 3 + 1] = cTmp.g; colors[i * 3 + 2] = cTmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    // HQ
    this.hq = this.buildHQ();
    this.hq.position.set(66, this.heightAt(66, 22), 22);
    this.scene.add(this.hq);

    // road chevrons (intel markers)
    const chevGeo = new THREE.ConeGeometry(0.8, 1.6, 4);
    chevGeo.rotateX(Math.PI / 2);
    const chevMat = new THREE.MeshBasicMaterial({ color: 0xd84a3a, transparent: true, opacity: 0.4, depthWrite: false });
    for (let d = 6; d < this.pathTotal - 8; d += 16) {
      const s = this.pathPoint(d);
      const m = new THREE.Mesh(chevGeo, chevMat);
      m.position.set(s.x, this.heightAt(s.x, s.z) + 4.2, s.z);
      m.rotation.y = Math.atan2(s.dx, s.dz);
      this.scene.add(m);
      this.chevrons.push(m);
    }

    this.scatterDecor();
    this.selRing = this.makeRangeRing(10);
    this.selRing.visible = false;
    this.scene.add(this.selRing);

    // ambient burning wreck for atmosphere
    this.spawnAmbientWreck(-30, -4);
    this.spawnAmbientWreck(24, 30);
  }

  heightAt(_x: number, _z: number): number {
    // perfectly flat battlefield — clean sightlines, honest ballistics
    return 0;
  }

  distToPath(x: number, z: number): number {
    let best = 1e9;
    for (let i = 0; i < this.pathPts.length - 1; i++) {
      const a = this.pathPts[i], b = this.pathPts[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
      const dx = x - (a.x + abx * t), dz = z - (a.z + abz * t);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  }

  pathPoint(d: number): { x: number; z: number; dx: number; dz: number } {
    const dd = clamp(d, 0, this.pathTotal - 0.001);
    let i = 0;
    while (i < this.pathCum.length - 2 && this.pathCum[i + 1] < dd) i++;
    const a = this.pathPts[i], b = this.pathPts[i + 1];
    const t = (dd - this.pathCum[i]) / (this.pathCum[i + 1] - this.pathCum[i]);
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: a.x + dx * t, z: a.z + dz * t, dx: dx / len, dz: dz / len };
  }

  private scatterDecor() {
    // pines
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6);
    trunkGeo.translate(0, 0.8, 0);
    const folGeo = new THREE.ConeGeometry(1, 1, 7);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a26 });
    const folMat = new THREE.MeshLambertMaterial({ color: 0x2f4427 });
    const spots: { x: number; z: number; s: number }[] = [];
    let tries = 0;
    while (spots.length < 130 && tries < 900) {
      tries++;
      const x = rand(-84, 84), z = rand(-58, 58);
      if (this.distToPath(x, z) < 11 || Math.hypot(x - 66, z - 22) < 16) continue;
      spots.push({ x, z, s: rand(0.8, 1.9) });
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const fols = new THREE.InstancedMesh(folGeo, folMat, spots.length * 2);
    trunks.castShadow = true; fols.castShadow = true;
    const d = this.dummy;
    spots.forEach((s, i) => {
      const y = this.heightAt(s.x, s.z) - 0.2;
      d.position.set(s.x, y, s.z); d.rotation.set(0, rand(0, 6.28), 0);
      d.scale.setScalar(s.s); d.updateMatrix();
      trunks.setMatrixAt(i, d.matrix);
      d.position.set(s.x, y + 1.5 * s.s, s.z); d.scale.set(2.1 * s.s, 3.2 * s.s, 2.1 * s.s);
      d.updateMatrix(); fols.setMatrixAt(i * 2, d.matrix);
      d.position.set(s.x, y + 3.1 * s.s, s.z); d.scale.set(1.4 * s.s, 2.4 * s.s, 1.4 * s.s);
      d.updateMatrix(); fols.setMatrixAt(i * 2 + 1, d.matrix);
    });
    this.scene.add(trunks, fols);

    // rocks
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x6e6f63 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 46);
    rocks.castShadow = true;
    for (let i = 0; i < 46; i++) {
      const x = rand(-82, 82), z = rand(-56, 56);
      if (this.distToPath(x, z) < 7) { d.scale.setScalar(0.0001); d.position.set(0, -50, 0); d.updateMatrix(); rocks.setMatrixAt(i, d.matrix); continue; }
      d.position.set(x, this.heightAt(x, z) + 0.1, z);
      d.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      d.scale.setScalar(rand(0.3, 1.1)); d.updateMatrix();
      rocks.setMatrixAt(i, d.matrix);
    }
    this.scene.add(rocks);

    // grass tufts
    const tuftGeo = new THREE.ConeGeometry(0.16, 0.9, 4);
    tuftGeo.translate(0, 0.45, 0);
    const tuftMat = new THREE.MeshLambertMaterial({ color: 0x5d7038 });
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 240);
    for (let i = 0; i < 240; i++) {
      const x = rand(-80, 80), z = rand(-54, 54);
      if (this.distToPath(x, z) < 5.5) { d.scale.setScalar(0.0001); d.position.set(0, -50, 0); d.updateMatrix(); tufts.setMatrixAt(i, d.matrix); continue; }
      d.position.set(x, this.heightAt(x, z), z);
      d.rotation.set(0, rand(0, 6.28), 0);
      d.scale.set(rand(0.7, 1.4), rand(0.6, 1.5), rand(0.7, 1.4)); d.updateMatrix();
      tufts.setMatrixAt(i, d.matrix);
    }
    this.scene.add(tufts);
  }

  private buildHQ(): THREE.Group {
    const g = new THREE.Group();
    const bunker = this.box(6, 2.6, 5, this.mats.concrete, 0, 1.3, 0);
    bunker.castShadow = true;
    g.add(bunker);
    g.add(this.box(6.4, 0.7, 5.4, this.mats.dirt, 0, 0.2, 0));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const bag = this.box(1.1, 0.42, 0.6, this.mats.sandbag, Math.cos(a) * 4.4, 0.25, Math.sin(a) * 3.7);
      bag.rotation.y = -a;
      g.add(bag);
    }
    const pole = this.cyl(0.07, 6, this.mats.steelDark, -2.2, 3, -1.6);
    g.add(pole);
    const flag = this.box(1.6, 1, 0.05, this.mats.amber, -1.35, 5.4, -1.6);
    g.add(flag);
    this.hqFlag = flag;
    const ant = this.cyl(0.04, 4.4, this.mats.gunmetal, 2.4, 4.6, 1.6);
    g.add(ant);
    // hp bar
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.5), this.mats.black);
    this.hqBarFg = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.5), this.mats.barAmber);
    this.hqBarFg.position.z = 0.01;
    bar.add(bg, this.hqBarFg);
    bar.position.y = 7.4;
    g.add(bar);
    g.userData.bar = bar;
    return g;
  }

  private spawnAmbientWreck(x: number, z: number) {
    const g = this.makeWreckMesh("panzer");
    g.position.set(x, this.heightAt(x, z), z);
    g.rotation.y = rand(0, 6.28);
    this.scene.add(g);
    this.wrecks.push({ group: g, life: 1e9, smokeT: 0 });
  }

  private makeWreckMesh(kind: EnemyKind): THREE.Group {
    const g = new THREE.Group();
    if (kind === "stuka") {
      // smouldering aircraft carcass
      const fuse = this.box(0.8, 0.8, 4.4, this.mats.burnt, 0, 0.45, 0);
      fuse.castShadow = true;
      fuse.rotation.z = rand(-0.25, 0.25);
      const wing = this.box(6.6, 0.1, 1.5, this.mats.burntDark, 0, 0.55, 0.25);
      wing.rotation.z = rand(-0.12, 0.12);
      g.add(fuse, wing);
      g.add(this.box(0.62, 0.55, 0.62, this.mats.burntDark, 0, 0.95, 0.35));
      g.add(this.box(0.12, 0.9, 1.0, this.mats.burnt, 0, 0.9, -1.9));
      return g;
    }
    const hull = this.box(2.2, 0.9, 4.2, this.mats.burnt, 0, 0.75, 0);
    hull.castShadow = true;
    g.add(hull);
    g.add(this.box(2.5, 0.7, 4.5, this.mats.burntDark, 0, 0.4, 0));
    if (kind !== "infantry") {
      const tur = this.box(1.6, 0.6, 1.9, this.mats.burntDark, 0.2, 1.4, -0.3);
      tur.rotation.z = 0.12; tur.rotation.y = rand(0, 1);
      g.add(tur);
    }
    return g;
  }

  // ── particles / fx pools ─────────────────────────────────────────────────
  private makeGlowTex(inner: string, outer: string): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, inner);
    g.addColorStop(0.4, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  private initPools() {
    this.sparkTex = this.makeGlowTex("rgba(255,255,240,1)", "rgba(255,160,60,0.8)");
    this.smokeTex = this.makeGlowTex("rgba(120,116,105,0.85)", "rgba(70,68,60,0.4)");
    const planeGeo = new THREE.PlaneGeometry(1, 1);

    const sparkMat = new THREE.MeshBasicMaterial({
      map: this.sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.sparkMesh = new THREE.InstancedMesh(planeGeo, sparkMat, SPARK_MAX);
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    for (let i = 0; i < SPARK_MAX; i++) {
      this.sparks.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, grow: 0, grav: 0, drag: 1 });
      this.dummy.position.set(0, -999, 0); this.dummy.scale.setScalar(0.0001); this.dummy.updateMatrix();
      this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
      this.sparkMesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.scene.add(this.sparkMesh);

    const smokeMat = new THREE.MeshBasicMaterial({
      map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0.85,
    });
    this.smokeMesh = new THREE.InstancedMesh(planeGeo, smokeMat, SMOKE_MAX);
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smokeMesh.frustumCulled = false;
    for (let i = 0; i < SMOKE_MAX; i++) {
      this.smokes.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, grow: 1, grav: 0, drag: 1 });
      this.dummy.position.set(0, -999, 0); this.dummy.scale.setScalar(0.0001); this.dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.dummy.matrix);
      this.smokeMesh.setColorAt(i, new THREE.Color(0.5, 0.5, 0.5));
    }
    this.scene.add(this.smokeMesh);

    // crater texture — charred core, churned dirt ring, radial scorch streaks
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const cx = cv.getContext("2d")!;
    const grad = cx.createRadialGradient(128, 128, 4, 128, 128, 128);
    grad.addColorStop(0, "rgba(10,7,4,0.98)");
    grad.addColorStop(0.32, "rgba(24,17,9,0.94)");
    grad.addColorStop(0.55, "rgba(52,38,20,0.82)");
    grad.addColorStop(0.72, "rgba(74,58,34,0.55)");
    grad.addColorStop(0.88, "rgba(88,70,42,0.22)");
    grad.addColorStop(1, "rgba(88,70,42,0)");
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), len = rand(0.5, 1.02);
      cx.strokeStyle = `rgba(14,10,5,${rand(0.18, 0.4).toFixed(2)})`;
      cx.lineWidth = rand(2, 6);
      cx.beginPath();
      cx.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30);
      cx.lineTo(128 + Math.cos(a) * 128 * len, 128 + Math.sin(a) * 128 * len);
      cx.stroke();
    }
    for (let i = 0; i < 420; i++) {
      const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * 124;
      const x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr;
      const dark = Math.random() < 0.62;
      cx.fillStyle = dark ? `rgba(10,7,3,${rand(0.1, 0.4).toFixed(2)})` : `rgba(120,96,58,${rand(0.06, 0.2).toFixed(2)})`;
      cx.fillRect(x, y, rand(1, 3.4), rand(1, 3.4));
    }
    this.craterTex = new THREE.CanvasTexture(cv);

    // crater pool — flat baked-texture decals, no geometry
    this.craterGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.craterTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      });
      const mesh = new THREE.Mesh(this.craterGeo, mat);
      mesh.position.y = 0.07;
      mesh.visible = false;
      this.scene.add(mesh);
      this.craters.push({ mesh, mat, life: 0, maxLife: 1, s0: 1 });
    }

    // debris pool (vehicles burst into parts that scatter, bounce and fade)
    this.gibGeos = [
      new THREE.BoxGeometry(0.5, 0.35, 0.7),
      new THREE.BoxGeometry(0.85, 0.25, 0.4),
      new THREE.BoxGeometry(0.32, 0.32, 0.32),
    ];
    for (let i = 0; i < 90; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: 0x4a4f38, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(this.gibGeos[i % this.gibGeos.length], mat);
      mesh.visible = false;
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.gibs.push({
        mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rotV: new THREE.Vector3(),
        life: 0, maxLife: 1, s: 1,
      });
    }

    this.ghostMatOk = new THREE.MeshBasicMaterial({ color: 0xa4c94e, transparent: true, opacity: 0.45, depthWrite: false });
    this.ghostMatBad = new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.45, depthWrite: false });
  }

  private spawnSpark(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: THREE.Color, grav = 8) {
    let p = this.sparks.find((s) => s.life <= 0);
    if (!p) p = this.sparks[0];
    p.pos.copy(pos); p.vel.copy(vel); p.life = life; p.maxLife = life; p.size = size; p.grav = grav; p.drag = 0.985; p.grow = 0;
    const i = this.sparks.indexOf(p);
    this.sparkMesh.setColorAt(i, color);
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
  }

  private spawnSmoke(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, gray = 0.42, grow = 2.4) {
    let p = this.smokes.find((s) => s.life <= 0);
    if (!p) p = this.smokes[0];
    p.pos.copy(pos); p.vel.copy(vel); p.life = life; p.maxLife = life; p.size = size; p.grav = -0.6; p.drag = 0.97; p.grow = grow;
    const i = this.smokes.indexOf(p);
    this.smokeMesh.setColorAt(i, new THREE.Color(gray, gray * 0.97, gray * 0.9));
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
  }

  private burst(pos: THREE.Vector3, n: number, speed: number, life: number, size: number, color: THREE.Color, grav = 8) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(rand(-1, 1), rand(0.15, 1.2), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
      this.spawnSpark(pos, v, life * rand(0.6, 1.2), size * rand(0.7, 1.4), color, grav);
    }
  }

  private flashAt(pos: THREE.Vector3, intensity: number) {
    let l = this.flashLights[0];
    for (const fl of this.flashLights) if (fl.intensity < l.intensity) l = fl;
    l.position.copy(pos).add(new THREE.Vector3(0, 2, 0));
    l.intensity = intensity;
  }

  private addDecal(pos: THREE.Vector3, r: number) {
    let d = this.craters.find((x) => x.life <= 0);
    if (!d) d = this.craters.reduce((a, b) => (a.life < b.life ? a : b));
    const size = Math.max(0.8, r);
    d.mesh.visible = true;
    d.mesh.position.set(pos.x, this.heightAt(pos.x, pos.z) + 0.07, pos.z);
    d.mesh.rotation.y = rand(0, 6.28);
    d.s0 = size * 1.3;
    d.mesh.scale.setScalar(d.s0);
    d.mat.opacity = 0.95;
    d.life = rand(26, 38);
    d.maxLife = d.life;
    // kicked-out dirt clods around the lip
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2);
      this.spawnSpark(
        new THREE.Vector3(pos.x + Math.cos(a) * size * 0.5, pos.y + 0.2, pos.z + Math.sin(a) * size * 0.5),
        new THREE.Vector3(Math.cos(a) * rand(4, 9), rand(5, 10), Math.sin(a) * rand(4, 9)),
        0.7, rand(0.25, 0.5), new THREE.Color(0.32, 0.24, 0.13), 22,
      );
    }
  }

  // destroyed vehicles burst into scattering, bouncing parts that fade out
  private spawnGibs(e: Enemy, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      let g = this.gibs.find((x) => x.life <= 0);
      if (!g) g = this.gibs.reduce((a, b) => (a.life < b.life ? a : b));
      g.mesh.visible = true;
      const mat = g.mesh.material as THREE.MeshLambertMaterial;
      mat.color.setHex(this.gibColors[Math.floor(rand(0, this.gibColors.length))]);
      g.pos.set(e.pos.x + rand(-1, 1), e.pos.y + rand(0.6, 2.2), e.pos.z + rand(-1, 1));
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.35, 1) * power;
      g.vel.set(Math.cos(a) * sp, rand(3, 7 + power * 0.5), Math.sin(a) * sp);
      g.rotV.set(rand(-7, 7), rand(-7, 7), rand(-7, 7));
      g.s = rand(0.3, 0.8) * (e.def.radius / 1.9 + 0.35);
      g.life = rand(2.2, 4.2);
      g.maxLife = g.life;
      g.mesh.position.copy(g.pos);
      g.mesh.scale.setScalar(g.s);
      (g.mesh.material as THREE.MeshLambertMaterial).opacity = 1;
      g.mesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    }
  }

  private updateGibs(dt: number) {
    for (const g of this.gibs) {
      if (g.life <= 0) continue;
      g.life -= dt;
      g.vel.y -= 26 * dt;
      g.pos.addScaledVector(g.vel, dt);
      const ground = this.heightAt(g.pos.x, g.pos.z) + g.s * 0.3;
      if (g.pos.y <= ground) {
        g.pos.y = ground;
        g.vel.y = Math.abs(g.vel.y) > 2 ? -g.vel.y * 0.38 : 0;
        g.vel.x *= 0.72;
        g.vel.z *= 0.72;
        g.rotV.multiplyScalar(0.8);
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.rotV.x * dt;
      g.mesh.rotation.y += g.rotV.y * dt;
      g.mesh.rotation.z += g.rotV.z * dt;
      const k = g.life / g.maxLife;
      if (k < 0.4) {
        const f = k / 0.4;
        g.mesh.scale.setScalar(g.s * (0.25 + 0.75 * f));
        (g.mesh.material as THREE.MeshLambertMaterial).opacity = f;
      }
      if (g.life <= 0) {
        g.mesh.visible = false;
        (g.mesh.material as THREE.MeshLambertMaterial).opacity = 0;
      }
    }
  }

  private addShake(n: number) {
    this.shake = Math.min(2.4, this.shake + n * this.shakeScale);
  }

  // ── explosions & damage ──────────────────────────────────────────────────
  private explode(pos: THREE.Vector3, r: number, dmg: number, opts: { big?: boolean; hurtsTowers?: boolean; crater?: number }) {
    const { big = false, hurtsTowers = false, crater = 1 } = opts;
    this.burst(pos, big ? 26 : 14, big ? 16 : 10, 0.6, big ? 1.5 : 0.9, new THREE.Color(1, 0.72, 0.3), 10);
    this.burst(pos, big ? 14 : 6, 8, 0.35, 0.5, new THREE.Color(1, 0.95, 0.7), 6);
    for (let i = 0; i < (big ? 6 : 3); i++) {
      this.spawnSmoke(
        pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1))),
        new THREE.Vector3(rand(-1.4, 1.4), rand(2.5, 4.5), rand(-1.4, 1.4)),
        rand(1.2, 2.2), rand(1.4, 2.6), rand(0.28, 0.45),
      );
    }
    this.flashAt(pos, big ? 90 : 40);
    this.addShake(big ? 1.1 : 0.45);
    if (crater > 0) this.addDecal(pos, r * 0.55 * crater);
    sfx.play(big ? "boomBig" : "boom");
    if (big) {
      this.onUi({ t: "flash", p: 1 });
      sfx.play("tinnitus");
    }
    // damage enemies
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = e.pos.distanceTo(pos);
      if (d < r + e.def.radius) {
        const fall = 1 - clamp(d / (r + e.def.radius), 0, 1) * 0.7;
        const mult = e.kind === "infantry" ? 1.8 : 1;
        this.damageEnemy(e, dmg * fall * mult, 999, e.pos, new THREE.Vector3(e.pos.x - pos.x, 0.4, e.pos.z - pos.z));
      }
    }
    if (hurtsTowers) {
      for (const t of this.towers) {
        if (t.dead) continue;
        const d = t.pos.distanceTo(pos);
        if (d < r + 1.6) this.damageTower(t, dmg * (1 - (d / (r + 1.6)) * 0.6));
      }
      const hd = this.hq.position.distanceTo(pos);
      if (hd < r + 5) this.damageBase(Math.ceil(dmg / 40));
    }
  }

  private damageEnemy(e: Enemy, dmg: number, pen: number, hitPoint: THREE.Vector3, velDir: THREE.Vector3) {
    if (e.dead || e.falling) return;
    let finalDmg = dmg;
    // forward-observer target designation
    if (e.markT > 0) finalDmg *= e.markMul;
    if (pen < 900) {
      const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
      const d = velDir.clone().normalize();
      const c = d.x * fx + d.z * fz;
      const armor = (c < -0.5 ? e.def.armorF : c > 0.5 ? e.def.armorR : e.def.armorS) * e.armorMul;
      if (pen >= armor) {
        this.burst(hitPoint, 6, 9, 0.3, 0.45, new THREE.Color(1, 0.8, 0.4));
      } else {
        finalDmg = dmg * 0.22;
        if (Math.random() < 0.45) {
          // ricochet
          const rv = velDir.clone().normalize().multiplyScalar(rand(14, 24));
          rv.y = rand(6, 14);
          rv.x += rand(-8, 8); rv.z += rand(-8, 8);
          this.spawnSpark(hitPoint, rv, 0.55, 0.4, new THREE.Color(1, 0.9, 0.5), 14);
          sfx.play("ricochet");
        } else {
          sfx.play("clang");
          this.burst(hitPoint, 4, 6, 0.25, 0.35, new THREE.Color(0.9, 0.9, 0.85));
        }
      }
    }
    e.hp -= finalDmg;
    e.flashT = 0.13;
    if (!e.hpBar && e.hp < e.maxHp) this.showEnemyBar(e);
    if (e.hp <= 0) this.killEnemy(e);
  }

  private showEnemyBar(e: Enemy) {
    const bar = new THREE.Group();
    const w = e.def.radius * 1.7;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.22), this.mats.black);
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.22), this.mats.barAmber);
    fg.position.z = 0.01;
    bar.add(bg, fg);
    bar.position.y = e.def.radius + (e.flying ? 1.2 : 1.5);
    e.group.add(bar);
    e.hpBar = bar;
  }

  private killEnemy(e: Enemy) {
    if (e.dead || e.falling) return;
    this.kills++;
    this.rp += e.def.reward;
    this.score += e.def.reward;
    sfx.play("coin");
    if (e.kind === "infantry") {
      e.dead = true;
      this.burst(e.pos.clone().setY(e.pos.y + 0.8), 12, 8, 0.5, 0.5, new THREE.Color(0.55, 0.25, 0.18), 12);
      this.burst(e.pos.clone().setY(e.pos.y + 0.6), 6, 5, 0.4, 0.4, new THREE.Color(0.35, 0.38, 0.25), 10);
      this.dyn.remove(e.group);
    } else if (e.flying) {
      // MAYDAY — crippled aircraft, spiral down in flames (stays alive until it crashes)
      e.falling = true; e.fallVy = -1;
      sfx.play("whistle");
      this.onUi({ t: "toast", text: "ENEMY AIRCRAFT CRIPPLED — MAYDAY, MAYDAY" });
      this.burst(e.pos, 16, 10, 0.55, 0.85, new THREE.Color(1, 0.55, 0.2));
      this.spawnSmoke(e.pos.clone(), new THREE.Vector3(0, 1, 0), 1.8, 2.4, 0.28);
    } else {
      e.dead = true;
      const heavy = e.kind === "panther" || e.kind === "panzer" || e.kind === "tiger";
      this.explode(e.pos.clone().setY(e.pos.y + 1), e.def.radius * 1.7, 0, { big: heavy });
      // vehicle bursts into scattering parts — the road stays clear
      this.spawnGibs(e, Math.round(5 + e.def.radius * 3.2), 4 + e.def.radius * 2.4);
      for (let i = 0; i < 2; i++) {
        this.spawnSmoke(e.pos.clone().add(new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1))), new THREE.Vector3(rand(-1, 1), 2.4, rand(-1, 1)), rand(1, 1.8), rand(1.4, 2.2), 0.25);
      }
      this.dyn.remove(e.group);
    }
    if (e.hpBar) e.hpBar = null;
  }

  private damageTower(t: Tower, dmg: number) {
    if (t.dead) return;
    t.hp -= dmg;
    t.flashT = 0.15;
    if (t.hp <= 0) {
      t.dead = true;
      if (this.selected === t) this.deselect();
      this.explode(t.pos.clone().setY(t.pos.y + 1.2), 4.5, 0, { big: true });
      this.dyn.remove(t.group);
      this.dyn.remove(t.hitMesh);
      this.clearAirPost(t);
      const rubble = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const b = this.box(rand(0.6, 1.4), rand(0.3, 0.8), rand(0.6, 1.4), Math.random() < 0.5 ? this.mats.burnt : this.mats.burntDark, rand(-1.4, 1.4), rand(0.15, 0.4), rand(-1.4, 1.4));
        b.rotation.y = rand(0, 3);
        rubble.add(b);
      }
      rubble.position.copy(t.pos);
      this.dyn.add(rubble);
      this.wrecks.push({ group: rubble, life: 60, smokeT: 0 });
      this.onUi({ t: "toast", text: `${t.def.short} DESTROYED` });
      this.onUi({ t: "dmg" });
    }
  }

  private damageBase(n: number) {
    if (this.state !== "playing" || this.endT >= 0) return;
    this.baseHp = Math.max(0, this.baseHp - n);
    this.waveDamageTaken = true;
    this.addShake(0.8);
    this.onUi({ t: "dmg" });
    sfx.play("alarm");
    if (this.baseHp <= 0) {
      this.explode(this.hq.position.clone().setY(this.hq.position.y + 2), 8, 0, { big: true });
      this.explode(this.hq.position.clone().add(new THREE.Vector3(2, 3, 1)), 6, 0, { big: true });
      this.endT = 1.6;
      this.endScreen = "over";
    }
  }

  // ── towers ────────────────────────────────────────────────────────────────
  private buildTowerVisual(kind: TowerKind): {
    group: THREE.Group; turret: THREE.Group; barrel: THREE.Group; muzzle: THREE.Object3D;
    elevNode: THREE.Object3D;
    breech: THREE.Mesh | null; loader: THREE.Object3D | null;
  } {
    const group = new THREE.Group();
    const turret = new THREE.Group();
    const barrel = new THREE.Group();
    const muzzle = new THREE.Object3D();
    let elevNode: THREE.Object3D = barrel;
    let breech: THREE.Mesh | null = null;
    let loader: THREE.Object3D | null = null;

    const soldier = (x: number, z: number, seated = false): THREE.Group => {
      const s = new THREE.Group();
      const body = new THREE.Mesh(this.geos.capsule, this.mats.uniform);
      body.scale.set(0.17, seated ? 0.28 : 0.34, 0.17);
      body.position.y = seated ? 0.55 : 0.75;
      const head = new THREE.Mesh(this.geos.sphere, this.mats.helmet);
      head.scale.setScalar(0.15);
      head.position.y = seated ? 1.0 : 1.28;
      s.add(body, head);
      s.position.set(x, 0, z);
      return s;
    };

    if (kind === "mg") {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const bag = this.box(1.0, 0.4, 0.55, this.mats.sandbag, Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5);
        bag.rotation.y = -a;
        group.add(bag);
      }
      group.add(this.cyl(1.3, 0.14, this.mats.dirt, 0, 0.07, 0));
      turret.position.y = 0.62;
      const tripod = this.cyl(0.06, 0.6, this.mats.gunmetal, 0, 0.3, 0);
      const body = this.box(0.34, 0.3, 1.15, this.mats.gunmetal, 0, 0.66, 0.1);
      barrel.add(body);
      const tube = new THREE.Mesh(this.geos.cyl, this.mats.steelDark);
      tube.scale.set(0.06, 1.5, 0.06);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.66, 1.3);
      barrel.add(tube);
      muzzle.position.set(0, 0.66, 2.1);
      barrel.add(muzzle);
      turret.add(tripod, barrel);
      group.add(turret, soldier(0, -1.1), soldier(1.15, -0.4));
      loader = group.children[group.children.length - 1] as THREE.Object3D;
    } else if (kind === "at") {
      // the whole towed carriage — wheels, axle, trails, spade, shield & barrel — traverses as one
      turret.position.y = 0;
      const w1 = this.cyl(0.55, 0.26, this.mats.track, -0.85, 0.55, 0);
      w1.rotation.z = Math.PI / 2;
      const w2 = w1.clone(); w2.position.x = 0.85;
      const axle = this.cyl(0.11, 1.85, this.mats.steelDark, 0, 0.55, 0);
      axle.rotation.z = Math.PI / 2;
      const trail = this.box(1.5, 0.45, 2.7, this.mats.hullDark, 0, 0.42, -0.75);
      const spade = this.box(1.5, 0.7, 0.16, this.mats.steelDark, 0, 0.32, -2.1);
      const shield = this.box(1.7, 1.05, 0.1, this.mats.hull, 0, 1.45, 0.5);
      shield.rotation.x = -0.14;
      barrel.position.y = 1.37; // trunnion height: elevation pivots here
      const tube = new THREE.Mesh(this.geos.cyl, this.mats.gunmetal);
      tube.scale.set(0.085, 3.1, 0.085);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0, 1.8);
      barrel.add(tube);
      muzzle.position.set(0, 0, 3.4);
      barrel.add(muzzle);
      breech = this.box(0.42, 0.4, 0.5, this.mats.steelDark, 0, 0, 0.1);
      barrel.add(breech);
      turret.add(w1, w2, axle, trail, spade, shield, barrel);
      // crew rides with the carriage
      const gunner = soldier(0, -1.6, true);
      const load = soldier(1.1, -0.7);
      turret.add(gunner, load);
      group.add(turret);
      loader = load;
    } else if (kind === "flak") {
      for (let i = 0; i < 4; i++) {
        const arm = this.box(0.5, 0.24, 3.4, this.mats.hullDark, 0, 0.12, 0);
        arm.rotation.y = (i * Math.PI) / 2;
        arm.position.set(Math.sin((i * Math.PI) / 2) * 1.3, 0.12, Math.cos((i * Math.PI) / 2) * 1.3);
        group.add(arm);
      }
      group.add(this.cyl(0.7, 0.7, this.mats.hull, 0, 0.55, 0));
      turret.position.y = 1.1;
      const pivot = new THREE.Group();
      pivot.rotation.x = -0.55;
      const cradle = this.box(0.5, 0.5, 1.4, this.mats.hull, 0, 0, -0.2);
      const tube = new THREE.Mesh(this.geos.cyl, this.mats.gunmetal);
      tube.scale.set(0.1, 4.4, 0.1);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0, 2.2);
      barrel.add(cradle, tube);
      muzzle.position.set(0, 0, 4.5);
      barrel.add(muzzle);
      const shield = this.box(1.4, 1.0, 0.1, this.mats.hull, 0, 0.3, 0.2);
      barrel.add(shield);
      pivot.add(barrel);
      turret.add(pivot);
      elevNode = pivot;
      group.add(turret, soldier(1.3, -0.8), soldier(-1.3, -0.8), soldier(0, -1.5));
      loader = group.children[group.children.length - 2] as THREE.Object3D;
    } else if (kind === "arty") {
      // M114-style trailer mount: two wheels, split trails with spades, gun on a pedestal
      turret.position.y = 0;
      const w1 = this.cyl(0.62, 0.3, this.mats.track, -1.05, 0.62, 0);
      w1.rotation.z = Math.PI / 2;
      const w2 = w1.clone(); w2.position.x = 1.05;
      const axle = this.cyl(0.13, 2.25, this.mats.steelDark, 0, 0.62, 0);
      axle.rotation.z = Math.PI / 2;
      const trailL = this.box(0.34, 0.3, 3.3, this.mats.hullDark, -0.6, 0.4, -1.5);
      trailL.rotation.y = 0.2;
      const trailR = this.box(0.34, 0.3, 3.3, this.mats.hullDark, 0.6, 0.4, -1.5);
      trailR.rotation.y = -0.2;
      const spadeL = this.box(0.5, 0.55, 0.16, this.mats.steelDark, -0.92, 0.3, -3.05);
      const spadeR = this.box(0.5, 0.55, 0.16, this.mats.steelDark, 0.92, 0.3, -3.05);
      const mount = this.cyl(0.72, 0.8, this.mats.hull, 0, 0.9, 0);
      turret.add(w1, w2, axle, trailL, trailR, spadeL, spadeR, mount);
      const pivot = new THREE.Group();
      pivot.position.y = 1.55;
      pivot.rotation.x = -1.0; // high-angle howitzer mount
      const cradle = this.box(0.64, 0.64, 1.6, this.mats.hull, 0, 0, -0.35);
      const tube = new THREE.Mesh(this.geos.cyl, this.mats.gunmetal);
      tube.scale.set(0.14, 3.9, 0.14);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0, 2.05);
      const brake = this.cyl(0.2, 0.34, this.mats.steelDark, 0, 0, 3.95);
      brake.rotation.x = Math.PI / 2;
      barrel.add(cradle, tube, brake);
      muzzle.position.set(0, 0, 4.35);
      barrel.add(muzzle);
      barrel.add(this.box(1.5, 1.05, 0.1, this.mats.hull, 0, -0.2, 0.3));
      breech = this.box(0.56, 0.56, 0.72, this.mats.steelDark, 0, 0, -0.6);
      barrel.add(breech);
      pivot.add(barrel);
      turret.add(pivot);
      elevNode = pivot;
      const load = soldier(1.6, -0.9);
      turret.add(load, soldier(-1.6, -0.9), soldier(0, -2.0));
      group.add(turret);
      loader = load;
    } else if (kind === "airpost") {
      // forward air-control post: sandbag ring, radio mast, signal panels
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const bag = this.box(1.0, 0.4, 0.55, this.mats.sandbag, Math.cos(a) * 1.7, 0.2, Math.sin(a) * 1.7);
        bag.rotation.y = -a;
        group.add(bag);
      }
      group.add(this.cyl(1.4, 0.14, this.mats.dirt, 0, 0.07, 0));
      // radio mast with crossbars + beacon
      group.add(this.cyl(0.06, 5.4, this.mats.steelDark, -1.1, 2.7, -0.9));
      for (const yy of [3.6, 4.4]) {
        group.add(this.box(1.3, 0.05, 0.05, this.mats.steelDark, -1.1, yy, -0.9));
      }
      group.add(this.box(0.22, 0.22, 0.22, this.mats.red, -1.1, 5.5, -0.9));
      // orange signal panel with stripe (air recognition)
      const panel = this.box(1.5, 0.06, 1.1, this.mats.planeAccent, 1.3, 0.28, 0.6);
      panel.rotation.z = 0.12;
      group.add(panel);
      group.add(this.box(0.5, 0.07, 1.12, this.mats.barRed, 1.3, 0.34, 0.6));
      group.add(soldier(-0.2, 0.6), soldier(0.7, -0.5));
    } else if (kind === "flame") {
      // M2 flamethrower: skid mount, twin fuel tanks, hose-fed nozzle
      group.add(this.box(2.2, 0.24, 1.5, this.mats.steelDark, 0, 0.12, 0));
      group.add(this.box(1.9, 0.16, 1.2, this.mats.hullDark, 0, 0.3, 0));
      const tankL = this.cyl(0.42, 1.5, this.mats.olive, -0.55, 1.1, -0.15);
      const tankR = this.cyl(0.42, 1.5, this.mats.olive, 0.55, 1.1, -0.15);
      tankL.castShadow = tankR.castShadow = true;
      const capL = this.cyl(0.44, 0.1, this.mats.steelDark, -0.55, 1.9, -0.15);
      const capR = this.cyl(0.44, 0.1, this.mats.steelDark, 0.55, 1.9, -0.15);
      turret.position.y = 0.95;
      const cradle = this.box(0.42, 0.36, 0.8, this.mats.hullDark, 0, 0, 0.1);
      const tube = new THREE.Mesh(this.geos.cyl, this.mats.gunmetal);
      tube.scale.set(0.09, 1.7, 0.09);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.05, 0.9);
      barrel.add(cradle, tube);
      muzzle.position.set(0, 0.05, 1.85);
      barrel.add(muzzle);
      // hose from tanks to nozzle
      const hose = this.cyl(0.05, 1.1, this.mats.dark, -0.3, 0.5, 0.5);
      hose.rotation.x = 1.1;
      turret.add(barrel, hose);
      group.add(tankL, tankR, capL, capR, turret, soldier(0, -1.5));
      loader = group.children[group.children.length - 1] as THREE.Object3D;
    } else if (kind === "atrifle") {
      // PzB 39 anti-tank rifle team: prone gunner, long rifle on bipod
      const pad = this.box(1.7, 0.1, 2.4, this.mats.dirt, 0, 0.05, 0);
      group.add(pad);
      turret.position.y = 0.42;
      const stock = this.box(0.14, 0.16, 1.0, this.mats.wood, 0, 0, -0.55);
      const tube = new THREE.Mesh(this.geos.cyl, this.mats.gunmetal);
      tube.scale.set(0.05, 2.6, 0.05);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.04, 0.75);
      barrel.add(stock, tube);
      muzzle.position.set(0, 0.04, 2.1);
      barrel.add(muzzle);
      const bipodL = this.cyl(0.03, 0.5, this.mats.steelDark, -0.14, -0.2, 1.4);
      const bipodR = this.cyl(0.03, 0.5, this.mats.steelDark, 0.14, -0.2, 1.4);
      bipodL.rotation.z = 0.3; bipodR.rotation.z = -0.3;
      turret.add(barrel, bipodL, bipodR);
      // prone gunner behind the rifle
      const body = new THREE.Mesh(this.geos.capsule, this.mats.uniform);
      body.scale.set(0.2, 0.34, 0.2);
      body.rotation.x = Math.PI / 2 - 0.15;
      body.position.set(0, 0.24, -1.4);
      body.castShadow = true;
      const head = new THREE.Mesh(this.geos.sphere, this.mats.helmet);
      head.scale.setScalar(0.16);
      head.position.set(0, 0.42, -1.0);
      group.add(turret, body, head, soldier(1.0, -1.1));
      loader = group.children[group.children.length - 1] as THREE.Object3D;
    } else if (kind === "observer") {
      // forward observer: map table, tripod spotting scope, radio antenna
      const table = this.box(1.5, 0.08, 1.0, this.mats.wood, -0.9, 0.85, 0.7);
      const leg1 = this.cyl(0.04, 0.85, this.mats.wood, -1.4, 0.42, 0.4);
      const leg2 = this.cyl(0.04, 0.85, this.mats.wood, -0.4, 0.42, 0.4);
      const leg3 = this.cyl(0.04, 0.85, this.mats.wood, -0.9, 0.42, 1.0);
      const map = this.box(0.8, 0.02, 0.55, this.mats.barAmber, -0.9, 0.9, 0.7);
      group.add(table, leg1, leg2, leg3, map);
      group.add(this.cyl(0.05, 4.6, this.mats.steelDark, 1.2, 2.3, -0.8));
      group.add(this.box(1.0, 0.04, 0.04, this.mats.steelDark, 1.2, 3.4, -0.8));
      turret.position.y = 1.25;
      const tripod = this.cyl(0.05, 1.25, this.mats.steelDark, 0, -0.62, 0);
      const scope = new THREE.Mesh(this.geos.cyl, this.mats.gunmetal);
      scope.scale.set(0.1, 1.0, 0.1);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.12, 0.35);
      barrel.add(scope);
      muzzle.position.set(0, 0.12, 0.9);
      barrel.add(muzzle);
      turret.add(tripod, barrel);
      group.add(turret, soldier(-0.9, 1.6), soldier(0.7, 0.9));
      loader = group.children[group.children.length - 1] as THREE.Object3D;
    } else if (kind === "sapper") {
      // sapper repair post: workbench, vise, spare parts, fuel/parts drums
      const bench = this.box(2.4, 0.12, 1.1, this.mats.wood, 0, 0.95, -0.6);
      const bleg1 = this.box(0.14, 0.95, 0.14, this.mats.wood, -1.05, 0.47, -0.6);
      const bleg2 = this.box(0.14, 0.95, 0.14, this.mats.wood, 1.05, 0.47, -0.6);
      const vise = this.box(0.3, 0.34, 0.3, this.mats.steelDark, -0.7, 1.2, -0.6);
      const toolbox = this.box(0.6, 0.3, 0.4, this.mats.olive, 0.5, 1.16, -0.6);
      const drum1 = this.cyl(0.34, 0.8, this.mats.oliveDark, 1.6, 0.4, 0.5);
      const drum2 = this.cyl(0.34, 0.8, this.mats.hullDark, -1.6, 0.4, 0.4);
      const trackPart = this.box(0.9, 0.2, 0.5, this.mats.track, 0, 0.1, 1.1);
      group.add(bench, bleg1, bleg2, vise, toolbox, drum1, drum2, trackPart);
      // repair crane arm (turret) that swings toward damaged emplacements
      turret.position.y = 0;
      const post = this.cyl(0.09, 2.6, this.mats.steelDark, 0, 1.3, 0.2);
      const arm = this.box(0.12, 0.12, 1.9, this.mats.steelDark, 0, 2.5, 1.0);
      const hook = this.cyl(0.03, 0.7, this.mats.steelDark, 0, 2.15, 1.85);
      turret.add(post, arm, hook);
      group.add(turret, soldier(-0.4, 1.5), soldier(0.6, 1.3));
      loader = group.children[group.children.length - 1] as THREE.Object3D;
    } else if (kind === "hedgehog") {
      for (let i = 0; i < 3; i++) {
        const beam = this.box(0.3, 0.3, 3.4, this.mats.steel, 0, 0.9, 0);
        beam.rotation.y = (i * Math.PI) / 3;
        beam.rotation.x = i === 1 ? 0.5 : i === 2 ? -0.5 : 0;
        const pivotG = new THREE.Group();
        pivotG.rotation.y = (i * Math.PI) / 3;
        const b = this.box(0.3, 0.3, 3.4, this.mats.steel, 0, 0, 0);
        b.rotation.x = i === 0 ? 0 : i === 1 ? 0.9 : -0.9;
        b.position.y = 0.95;
        b.castShadow = true;
        pivotG.add(b);
        group.add(pivotG);
        void beam;
      }
    } else if (kind === "wire") {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const post = this.cyl(0.06, 1.0, this.mats.wood, Math.cos(a) * 1.5, 0.5, Math.sin(a) * 1.5);
        post.rotation.z = rand(-0.15, 0.15);
        group.add(post);
      }
      for (let i = 0; i < 4; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.035, 5, 14), this.mats.wire);
        coil.position.set(rand(-0.7, 0.7), 0.5 + rand(-0.15, 0.25), rand(-0.7, 0.7));
        coil.rotation.set(rand(0.9, 1.9), rand(0, 3), 0);
        group.add(coil);
      }
    } else if (kind === "mines") {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const mine = this.cyl(0.42, 0.14, this.mats.hullDark, Math.cos(a) * rand(1.0, 1.8), 0.05, Math.sin(a) * rand(1.0, 1.8));
        group.add(mine);
        const cap = this.cyl(0.16, 0.06, this.mats.red, mine.position.x, 0.14, mine.position.z);
        group.add(cap);
      }
    }
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; }
    });
    return { group, turret, barrel, muzzle, elevNode, breech, loader };
  }

  private makeGhost(kind: TowerKind): THREE.Group {
    const v = this.buildTowerVisual(kind);
    v.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.material = this.ghostMatOk; m.castShadow = false; }
    });
    return v.group;
  }

  private makeRangeRing(r: number): THREE.Group {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.3, r, 64),
      new THREE.MeshBasicMaterial({ color: 0xf2b23e, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.5 - 0.12, r * 0.5, 48),
      new THREE.MeshBasicMaterial({ color: 0xf2b23e, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = -0.02;
    g.add(ring, inner);
    return g;
  }

  canPlaceAt(x: number, z: number, kind: TowerKind): boolean {
    if (Math.abs(x) > 76 || Math.abs(z) > 52) return false;
    // defensive structures may be laid directly ON the road; guns need clear ground
    const roadMin = TOWER_DEFS[kind].structure ? 0 : 7.5;
    if (this.distToPath(x, z) < roadMin) return false;
    if (Math.hypot(x - 66, z - 22) < 9) return false;
    const minSep = kind === "hedgehog" || kind === "wire" || kind === "mines" ? 3.6 : 5;
    for (const t of this.towers) if (!t.dead && Math.hypot(t.pos.x - x, t.pos.z - z) < minSep) return false;
    return true;
  }

  private placeTower(kind: TowerKind, x: number, z: number): boolean {
    const def = TOWER_DEFS[kind];
    if (this.rp < def.cost) {
      sfx.play("denied");
      this.onUi({ t: "toast", text: "INSUFFICIENT REQUISITION POINTS" });
      return false;
    }
    this.rp -= def.cost;
    const v = this.buildTowerVisual(kind);
    const y = this.heightAt(x, z);
    v.group.position.set(x, y, z);
    // group stays axis-aligned: turret yaw is world-space (360° traverse)
    v.turret.rotation.y = Math.atan2(66 - x, 22 - z);
    this.dyn.add(v.group);
    const hitGeo = new THREE.CylinderGeometry(2.1, 2.1, 3.4, 8);
    const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hitMesh.position.set(x, y + 1.6, z);
    this.dyn.add(hitMesh);
    const t: Tower = {
      id: this.nextId++, kind, def,
      group: v.group, turret: v.turret, barrel: v.barrel, muzzle: v.muzzle, elevNode: v.elevNode,
      breech: v.breech, loader: v.loader, hitMesh,
      pos: new THREE.Vector3(x, y, z),
      hp: def.hp, maxHp: def.hp, ammo: def.ammo, maxAmmo: def.ammo,
      cooldown: 0, reloadT: 0, reloadMax: def.rof > 0 ? 1 / def.rof : 0, aiT: Math.random() * 0.12,
      tier: 0, dmgMul: 1, penMul: 1, rofMul: 1, rangeMul: 1, splashMul: 1, travMul: 1,
      targetMode: 0, target: null, recoil: 0, flashT: 0,
      elev: kind === "flak" ? 0.55 : kind === "arty" ? 1.05 : 0,
      dead: false, invested: def.cost, hpBar: null,
      airT: 4, airPhase: 0, airRunT: 0, airGone: false, airActive: 0,
      airPlane: null, airPlane2: null,
      airA: new THREE.Vector3(), airB: new THREE.Vector3(),
      airTick: 0, airRocketed: 0, airSnd: 0,
    };
    if (kind === "airpost") {
      t.airPlane = this.makeFriendlyPlane();
      this.dyn.add(t.airPlane as THREE.Group);
    }
    this.towers.push(t);
    sfx.play("build");
    this.burst(new THREE.Vector3(x, y + 0.4, z), 10, 6, 0.5, 0.7, new THREE.Color(0.55, 0.48, 0.32), 9);
    for (let i = 0; i < 3; i++) this.spawnSmoke(new THREE.Vector3(x + rand(-1, 1), y + 0.4, z + rand(-1, 1)), new THREE.Vector3(0, 1.6, 0), 0.9, 1.1, 0.55);
    this.pushHud();
    return true;
  }

  // ── close air support (airpost) ───────────────────────────────────────────
  private makeFriendlyPlane(): THREE.Group {
    const g = new THREE.Group();
    const star = new THREE.MeshLambertMaterial({ color: 0xe4e6d8 });
    const fuse = this.box(0.95, 1.05, 5.6, this.mats.olive, 0, 0, 0);
    fuse.castShadow = true;
    const nose = this.cyl(0.44, 1.1, this.mats.gunmetal, 0, 0, 3.1);
    nose.rotation.x = Math.PI / 2;
    const canopy = this.box(0.62, 0.5, 1.3, this.mats.gunmetal, 0, 0.72, 0.4);
    const wing = this.box(7.8, 0.15, 2.15, this.mats.olive, 0, -0.18, 0.5);
    wing.castShadow = true;
    const tail = this.box(3.1, 0.11, 1.25, this.mats.olive, 0, 0.18, -2.5);
    const fin = this.box(0.13, 1.3, 1.25, this.mats.olive, 0, 0.88, -2.5);
    // wing roundels
    const starL = this.box(0.95, 0.03, 0.95, star, -2.4, -0.08, 0.5);
    const starR = this.box(0.95, 0.03, 0.95, star, 2.4, -0.08, 0.5);
    // stub rocket rails
    const railL = this.box(0.12, 0.12, 1.5, this.mats.steelDark, -1.6, -0.42, 0.5);
    const railR = this.box(0.12, 0.12, 1.5, this.mats.steelDark, 1.6, -0.42, 0.5);
    g.add(fuse, nose, canopy, wing, tail, fin, starL, starR, railL, railR);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    return g;
  }

  private clearAirPost(t: Tower) {
    if (t.airPlane) { this.dyn.remove(t.airPlane); t.airPlane = null; }
    if (t.airPlane2) { this.dyn.remove(t.airPlane2); t.airPlane2 = null; }
  }

  private findAirTarget(t: Tower): { a: THREE.Vector3; b: THREE.Vector3 } | null {
    let best: Enemy | null = null;
    let bestScore = 0;
    for (const e of this.enemies) {
      if (e.dead || e.flying || e.falling) continue;
      if (e.pos.distanceTo(t.pos) > t.def.range * t.rangeMul + 10) continue;
      let score = e.def.radius * 2;
      for (const o of this.enemies) {
        if (o === e || o.dead || o.flying || o.falling) continue;
        if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 9) score += o.def.radius;
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best || bestScore < 3) return null;
    const s = this.pathPoint(best.dist);
    const tan = new THREE.Vector3(s.dx, 0, s.dz);
    const c = new THREE.Vector3(best.pos.x, 0, best.pos.z);
    return { a: c.clone().addScaledVector(tan, -22), b: c.clone().addScaledVector(tan, 22) };
  }

  private updateAirPost(t: Tower, dt: number) {
    const secondPlane = t.tier >= 3;
    if (secondPlane && !t.airPlane2) {
      t.airPlane2 = this.makeFriendlyPlane();
      this.dyn.add(t.airPlane2 as THREE.Group);
    }
    const planes = [t.airPlane, t.airPlane2].filter(Boolean) as THREE.Group[];

    // out of sorties → planes hold away
    if (t.ammo <= 0) {
      if (!t.airGone) {
        t.airGone = true;
        for (const p of planes) p.visible = false;
      }
      return;
    }
    if (t.airGone) {
      t.airGone = false;
      for (const p of planes) p.visible = true;
    }

    const orbitY = 27;
    const nPlanes = secondPlane ? 2 : 1;
    // orbiting planes (all except the one currently on a run)
    for (let pi = 0; pi < nPlanes; pi++) {
      const p = planes[pi];
      if (!p || (t.airPhase === 1 && t.airActive === pi)) continue;
      const ang = this.playT * 0.5 + pi * Math.PI;
      p.position.set(
        t.pos.x + Math.cos(ang) * 15,
        orbitY + Math.sin(this.playT * 1.3 + pi) * 0.6,
        t.pos.z + Math.sin(ang) * 15,
      );
      p.rotation.set(0, -ang, -0.3);
    }

    // sortie timer
    t.airT -= dt * t.rofMul;
    if (t.airPhase === 0 && t.airT <= 0) {
      const spot = this.findAirTarget(t);
      if (!spot) {
        t.airT = 1.6;
      } else {
        t.ammo--;
        t.airPhase = 1;
        t.airRunT = 0;
        t.airTick = 0;
        t.airRocketed = 0;
        t.airSnd = 0;
        t.airActive = secondPlane ? 1 - t.airActive : 0;
        t.airA.copy(spot.a);
        t.airB.copy(spot.b);
        sfx.play("flyby");
        this.pushHud();
      }
    }

    if (t.airPhase === 1) {
      const p = (t.airActive === 0 ? t.airPlane : t.airPlane2) as THREE.Group | null;
      if (!p) { t.airPhase = 0; t.airT = 5; return; }
      t.airRunT += dt;
      const dur = 3.6;
      const k = clamp(t.airRunT / dur, 0, 1);
      const A11 = new THREE.Vector3(t.airA.x, 11.5, t.airA.z);
      const B11 = new THREE.Vector3(t.airB.x, 11.5, t.airB.z);
      const back = new THREE.Vector3().subVectors(t.airA, t.airB).normalize();
      const E = A11.clone().addScaledVector(back, 20); E.y = 24;
      const F = B11.clone().addScaledVector(back, -24); F.y = 27;
      let pos = new THREE.Vector3();
      let pitch = 0;
      if (k < 0.18) {
        const u = k / 0.18;
        pos.lerpVectors(E, A11, u);
        pitch = 0.18;
      } else if (k < 0.82) {
        const u = (k - 0.18) / 0.64;
        pos.lerpVectors(A11, B11, u);
        pitch = 0.07;
        this.airStrafe(t, p, pos, dt, u);
      } else {
        const u = (k - 0.82) / 0.18;
        pos.lerpVectors(B11, F, u);
        pitch = -0.25;
      }
      p.position.copy(pos);
      const heading = Math.atan2(t.airB.x - t.airA.x, t.airB.z - t.airA.z);
      p.rotation.set(pitch, heading, 0);
      if (k >= 1) {
        t.airPhase = 0;
        t.airT = 13;
        this.pushHud();
      }
    }
  }

  private airStrafe(t: Tower, p: THREE.Group, pos: THREE.Vector3, dt: number, u: number) {
    t.airTick -= dt;
    while (t.airTick <= 0) {
      t.airTick += 0.065;
      // wing tracers
      for (const sx of [-1.6, 1.6]) {
        this.spawnSpark(
          pos.clone().add(new THREE.Vector3(sx, -0.3, 0)),
          new THREE.Vector3(rand(-2, 2), -30, rand(-2, 2)),
          0.22, 0.35, new THREE.Color(1, 0.85, 0.45), 20,
        );
      }
      // gun burst audio
      t.airSnd -= 0.065;
      if (t.airSnd <= 0) { t.airSnd = 0.13; sfx.play("mg"); }
      // damage enemies near the gun line
      for (const e of this.enemies) {
        if (e.dead || e.flying || e.falling) continue;
        const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
        if (Math.hypot(dx, dz) < 2.6) {
          this.damageEnemy(e, 8, 28, e.pos, new THREE.Vector3(dx, -0.5, dz));
        }
      }
      this.addShake(0.025);
    }
    // rocket rails (tier 1+): two HE rockets per pass
    if (t.tier >= 1 && t.airRocketed < 2 && u > 0.35 + 0.3 * t.airRocketed) {
      t.airRocketed++;
      const gp = new THREE.Vector3(pos.x, 0.5, pos.z);
      this.explode(gp, 4.6, 85, { big: false, crater: 0.9 });
      sfx.play("cannon");
      this.burst(gp, 10, 10, 0.4, 0.8, new THREE.Color(1, 0.8, 0.4), 12);
    }
  }

  // ── enemies ───────────────────────────────────────────────────────────────
  private buildEnemyMesh(kind: EnemyKind): { group: THREE.Group; soldiers: THREE.Object3D[] } {
    const g = new THREE.Group();
    const soldiers: THREE.Object3D[] = [];
    if (kind === "infantry") {
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Group();
        const body = new THREE.Mesh(this.geos.capsule, this.mats.uniform);
        body.scale.set(0.17, 0.34, 0.17);
        body.position.y = 0.72;
        body.castShadow = true;
        const head = new THREE.Mesh(this.geos.sphere, this.mats.helmet);
        head.scale.setScalar(0.15);
        head.position.y = 1.24;
        const rifle = this.box(0.05, 0.05, 0.9, this.mats.wood, 0.14, 0.95, 0.25);
        s.add(body, head, rifle);
        const a = (i / 5) * Math.PI * 2;
        s.position.set(Math.cos(a) * rand(0.4, 1.0), 0, Math.sin(a) * rand(0.4, 1.0));
        soldiers.push(s);
        g.add(s);
      }
      return { group: g, soldiers };
    }
    if (kind === "stuka") {
      const fuse = this.box(0.8, 0.9, 5.0, this.mats.plane, 0, 0, 0);
      fuse.castShadow = true;
      const nose = this.cyl(0.34, 0.9, this.mats.planeAccent, 0, 0, 2.85);
      nose.rotation.x = Math.PI / 2;
      const wing = this.box(9.4, 0.12, 1.9, this.mats.plane, 0, 0.1, 0.4);
      wing.castShadow = true;
      const tail = this.box(3.0, 0.1, 1.1, this.mats.plane, 0, 0.15, -2.2);
      const fin = this.box(0.12, 1.3, 1.2, this.mats.plane, 0, 0.8, -2.3);
      const canopy = this.box(0.6, 0.4, 1.1, this.mats.gunmetal, 0, 0.6, 0.9);
      g.add(fuse, nose, wing, tail, fin, canopy);
      return { group: g, soldiers };
    }
    if (kind === "heinkel") {
      const fuse = this.box(1.1, 1.15, 7.2, this.mats.plane, 0, 0, 0);
      fuse.castShadow = true;
      const nose = this.box(0.9, 0.85, 1.3, this.mats.gunmetal, 0, -0.05, 4.1);
      const wing = this.box(13.0, 0.14, 2.4, this.mats.plane, 0, 0.2, 0.6);
      wing.castShadow = true;
      const tail = this.box(4.4, 0.1, 1.4, this.mats.plane, 0, 0.3, -3.3);
      const fin1 = this.box(0.12, 1.3, 1.1, this.mats.plane, -1.1, 0.95, -3.3);
      const fin2 = this.box(0.12, 1.3, 1.1, this.mats.plane, 1.1, 0.95, -3.3);
      for (const sx of [-2.5, 2.5]) {
        const nac = this.cyl(0.3, 1.7, this.mats.planeAccent, sx, 0.05, 1.4);
        nac.rotation.x = Math.PI / 2;
        g.add(nac);
      }
      g.add(fuse, nose, wing, tail, fin1, fin2);
      return { group: g, soldiers };
    }
    // vehicles
    if (kind === "bike") {
      for (const sz of [-0.75, 0.75]) {
        const w = this.cyl(0.28, 0.1, this.mats.track, 0, 0.28, sz);
        w.rotation.z = Math.PI / 2;
        g.add(w);
      }
      const frame = this.box(0.24, 0.3, 1.3, this.mats.hullDark, 0, 0.5, 0);
      const tank = this.box(0.26, 0.22, 0.5, this.mats.hull, 0, 0.68, 0.15);
      const bar = this.box(0.6, 0.06, 0.06, this.mats.steelDark, 0, 0.85, 0.6);
      g.add(frame, tank, bar);
      const rider = new THREE.Group();
      const body = new THREE.Mesh(this.geos.capsule, this.mats.uniform);
      body.scale.set(0.16, 0.3, 0.16);
      body.position.y = 1.05;
      body.rotation.x = 0.35;
      const head = new THREE.Mesh(this.geos.sphere, this.mats.helmet);
      head.scale.setScalar(0.14);
      head.position.set(0, 1.42, -0.12);
      rider.add(body, head);
      soldiers.push(rider);
      g.add(rider);
    } else if (kind === "stug") {
      // casemate tank destroyer — low silhouette, fixed forward gun
      const hull = this.box(2.3, 0.95, 4.4, this.mats.hull, 0, 0.85, 0);
      hull.castShadow = true;
      const casemate = this.box(2.1, 0.75, 2.6, this.mats.hullDark, 0, 1.65, 0.3);
      const glacis = this.box(2.3, 0.7, 0.9, this.mats.hull, 0, 0.95, 2.35);
      glacis.rotation.x = 0.5;
      const mantlet = this.box(0.7, 0.5, 0.5, this.mats.steelDark, 0, 1.65, 1.7);
      const gun = this.cyl(0.08, 3.0, this.mats.gunmetal, 0, 1.65, 3.2);
      gun.rotation.x = Math.PI / 2;
      for (const sx of [-1.25, 1.25]) {
        const tr = this.box(0.4, 0.8, 4.6, this.mats.track, sx, 0.45, 0);
        g.add(tr);
      }
      g.add(hull, casemate, glacis, mantlet, gun);
    } else if (kind === "scout") {
      const hull = this.box(1.7, 0.95, 2.7, this.mats.hull, 0, 0.85, 0);
      hull.castShadow = true;
      const tur = this.box(1.0, 0.5, 1.2, this.mats.hullDark, 0, 1.55, -0.1);
      const gun = this.cyl(0.05, 1.3, this.mats.gunmetal, 0, 1.55, 1.1);
      gun.rotation.x = Math.PI / 2;
      g.add(hull, tur, gun);
      for (const sx of [-0.85, 0.85]) for (const sz of [-0.9, 0.9]) {
        const w = this.cyl(0.36, 0.24, this.mats.track, sx, 0.36, sz);
        w.rotation.z = Math.PI / 2;
        g.add(w);
      }
    } else if (kind === "halftrack") {
      const cab = this.box(1.7, 1.15, 1.6, this.mats.hull, 0, 0.95, 1.3);
      cab.castShadow = true;
      const bed = this.box(1.8, 1.0, 2.4, this.mats.hullDark, 0, 0.85, -0.8);
      const gun = this.cyl(0.05, 1.1, this.mats.gunmetal, 0, 1.6, -0.8);
      gun.rotation.x = Math.PI / 2;
      g.add(cab, bed, gun);
      for (const sx of [-0.9, 0.9]) {
        const w = this.cyl(0.4, 0.24, this.mats.track, sx, 0.4, 1.5);
        w.rotation.z = Math.PI / 2;
        g.add(w);
        const tr = this.box(0.3, 0.7, 2.4, this.mats.track, sx, 0.45, -0.8);
        g.add(tr);
      }
    } else {
      const heavy = kind === "panther" || kind === "tiger";
      const tiger = kind === "tiger";
      const hull = this.box(tiger ? 2.7 : heavy ? 2.5 : 2.2, 1.0, tiger ? 5.3 : heavy ? 4.9 : 4.2, this.mats.hull, 0, 0.95, 0);
      hull.castShadow = true;
      const glacis = this.box(tiger ? 2.7 : heavy ? 2.5 : 2.2, 0.7, 1.0, this.mats.hull, 0, 0.95, tiger ? 2.8 : heavy ? 2.6 : 2.3);
      glacis.rotation.x = heavy ? 0.6 : 0.35;
      for (const sx of [-(tiger ? 1.5 : heavy ? 1.35 : 1.2), tiger ? 1.5 : heavy ? 1.35 : 1.2]) {
        const tr = this.box(0.5, 0.9, tiger ? 5.5 : heavy ? 5.1 : 4.5, this.mats.track, sx, 0.52, 0);
        g.add(tr);
      }
      const tur = this.box(tiger ? 2.0 : heavy ? 1.9 : 1.7, tiger ? 0.85 : 0.72, tiger ? 2.3 : heavy ? 2.5 : 2.0, this.mats.hullDark, 0, tiger ? 1.9 : 1.8, -0.25);
      tur.castShadow = true;
      const gun = this.cyl(tiger ? 0.1 : heavy ? 0.08 : 0.07, tiger ? 3.2 : heavy ? 3.4 : 2.5, this.mats.gunmetal, 0, tiger ? 1.95 : 1.85, tiger ? 2.7 : heavy ? 2.5 : 1.9);
      gun.rotation.x = Math.PI / 2;
      g.add(hull, glacis, tur, gun);
      if (tiger) {
        // muzzle brake + commander's cupola
        const brake = this.cyl(0.16, 0.4, this.mats.steelDark, 0, 1.95, 4.3);
        brake.rotation.x = Math.PI / 2;
        const cupola = this.cyl(0.3, 0.3, this.mats.hullDark, -0.55, 2.45, -0.6);
        g.add(brake, cupola);
      }
    }
    return { group: g, soldiers };
  }

  private spawnEnemy(kind: EnemyKind) {
    const def = ENEMY_DEFS[kind];
    const { group, soldiers } = this.buildEnemyMesh(kind);
    const laneW = kind === "bike" ? 3.4 : kind === "tiger" ? 1.1 : kind === "infantry" ? 2.8 : 1.6;
    const e: Enemy = {
      id: this.nextId++, kind, def, group, soldiers,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      heading: 0, dist: rand(0, 1.5), hp: def.hp * this.waveHpMul, maxHp: def.hp * this.waveHpMul, flashT: 0,
      dead: false, flying: def.flying, lane: rand(-laneW, laneW),
      flyY: kind === "heinkel" ? 34 : 27, bombDropped: false, sirenPlayed: false, targetId: -1,
      falling: false, fallVy: 0, hpBar: null,
      phase: rand(0, 2.2), bombs: kind === "heinkel" ? 3 : 0, strafeT: rand(0.4, 1.2),
      armorMul: 1 + (this.waveHpMul - 1) * 0.5,
      burnT: 0, markT: 0, markMul: 1,
    };
    if (kind === "stuka") {
      e.pos.set(-100, 27, rand(-42, 42));
      e.targetId = this.pickStukaTarget();
      group.rotation.z = 0.06;
    } else if (kind === "heinkel") {
      e.pos.set(105, 34, rand(-34, 34));
      e.targetId = this.pickStukaTarget();
    } else {
      const s = this.pathPoint(e.dist);
      e.pos.set(s.x + -s.dz * e.lane, this.heightAt(s.x, s.z), s.z + s.dx * e.lane);
    }
    group.position.copy(e.pos);
    this.dyn.add(group);
    this.enemies.push(e);
  }

  private pickStukaTarget(): number {
    let best: Tower | null = null;
    for (const t of this.towers) {
      if (t.dead) continue;
      if (!best || t.def.cost > best.def.cost) best = t;
    }
    return best ? best.id : -1;
  }

  // ── projectiles ──────────────────────────────────────────────────────────
  private projGeoTracer = new THREE.CylinderGeometry(0.045, 0.045, 1.5, 5);
  private projGeoShell = new THREE.CylinderGeometry(0.11, 0.11, 1.25, 6);
  private projMatTracer = new THREE.MeshBasicMaterial({ color: 0xffd27a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  private projMatShell = new THREE.MeshBasicMaterial({ color: 0xffbe62, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  private bombGeo = new THREE.SphereGeometry(0.32, 8, 8);
  private bombMat = new THREE.MeshLambertMaterial({ color: 0x2b2d28 });

  private fireTower(t: Tower, aimPoint: THREE.Vector3, manual: boolean) {
    if (t.ammo <= 0 || t.dead) return;
    t.ammo--;
    t.cooldown = 1 / (t.def.rof * t.rofMul);
    t.reloadT = t.reloadMax / this.rofMulOf(t);
    t.recoil = 1;
    const muzzlePos = new THREE.Vector3();
    t.muzzle.getWorldPosition(muzzlePos);
    const def = t.def;
    // exact ballistic solution: compensate gravity so the round arrives on the predicted point
    const to = aimPoint.clone().sub(muzzlePos);
    const g = def.kind === "mg" ? GRAV * 0.35 : GRAV;
    const tFlight = Math.max(0.08, (to.length() / def.projSpeed) * (1 + def.lob * 0.02));
    const vel = to.divideScalar(tFlight);
    vel.y += 0.5 * g * tFlight;
    let mesh: THREE.Mesh;
    let kind: Proj["kind"] = "shell";
    if (def.kind === "mg") {
      mesh = new THREE.Mesh(this.projGeoTracer, this.projMatTracer);
      kind = "tracer";
      sfx.play("mg");
      this.addShake(0.05);
    } else if (def.kind === "at") {
      mesh = new THREE.Mesh(this.projGeoShell, this.projMatShell);
      sfx.play("cannon");
      this.addShake(0.32);
      this.spawnSmoke(muzzlePos.clone(), new THREE.Vector3(rand(-2, 2), rand(0.5, 1.5), rand(-2, 2)), 1.1, 1.6, 0.6);
    } else if (def.kind === "arty") {
      mesh = new THREE.Mesh(this.projGeoShell, this.projMatShell);
      sfx.play("cannon");
      sfx.play("whistle");
      this.addShake(0.55);
      for (let i = 0; i < 3; i++) {
        this.spawnSmoke(muzzlePos.clone(), new THREE.Vector3(rand(-2.5, 2.5), rand(1.5, 3), rand(-2.5, 2.5)), rand(1.4, 2), rand(1.8, 2.6), 0.55);
      }
      this.burst(muzzlePos, 12, 10, 0.2, 2.2, new THREE.Color(1, 0.85, 0.55), 3);
    } else {
      mesh = new THREE.Mesh(this.projGeoShell, this.projMatShell);
      kind = "flak";
      sfx.play("flakShot");
      this.addShake(0.3);
      this.spawnSmoke(muzzlePos.clone(), new THREE.Vector3(rand(-2, 2), rand(1, 2), rand(-2, 2)), 1.2, 1.8, 0.6);
    }
    mesh.position.copy(muzzlePos);
    this.dyn.add(mesh);
    const spread = def.kind === "mg" ? 2.6 : def.kind === "flak" ? 1.9 : 1.0;
    vel.x += rand(-spread, spread);
    vel.z += rand(-spread, spread);
    const p: Proj = {
      mesh, pos: muzzlePos.clone(), vel,
      dmg: def.dmg * t.dmgMul * (manual ? 1.35 : 1), pen: def.pen * t.penMul,
      splash: def.splash * (def.kind === "flak" || def.kind === "arty" ? t.splashMul : 1),
      splashDmg: def.splashDmg * (def.kind === "flak" || def.kind === "arty" ? t.splashMul : 1) * (manual ? 1.35 : 1),
      kind, life: 4, manual, dead: false,
    };
    this.projs.push(p);
    if (this.projs.length > 150) {
      const old = this.projs.shift();
      if (old) { this.dyn.remove(old.mesh); }
    }
    // muzzle flash
    this.burst(muzzlePos, def.kind === "mg" ? 3 : 7, def.kind === "mg" ? 5 : 8, 0.14, def.kind === "mg" ? 0.7 : 1.5, new THREE.Color(1, 0.85, 0.5), 2);
    this.flashAt(muzzlePos, def.kind === "mg" ? 14 : 46);
    if (def.kind !== "mg") {
      for (let i = 0; i < 2; i++) {
        this.spawnSmoke(new THREE.Vector3(t.pos.x + rand(-1.4, 1.4), t.pos.y + 0.3, t.pos.z + rand(-1.4, 1.4)), new THREE.Vector3(rand(-1, 1), 1.2, rand(-1, 1)), 1.4, 1.3, 0.62, 1.6);
      }
    }
    if (t.ammo === 0) this.onUi({ t: "toast", text: `${def.short} OUT OF AMMO — CARRIER DISPATCHED FROM HQ` });
  }

  private rofMulOf(t: Tower): number {
    return t.rofMul;
  }

  private aimPrediction(t: Tower, e: Enemy): THREE.Vector3 {
    const muzzle = new THREE.Vector3();
    t.muzzle.getWorldPosition(muzzle);
    const dist = muzzle.distanceTo(e.pos);
    const tFly = dist / t.def.projSpeed;
    return e.pos.clone().add(e.vel.clone().multiplyScalar(tFly * 0.85));
  }

  // ── input ────────────────────────────────────────────────────────────────
  private onKeyDown = (ev: KeyboardEvent) => {
    this.keys[ev.code] = true;
    if (ev.code === "Space") { ev.preventDefault(); this.togglePause(); }
    if (ev.code === "Escape") { this.cancelModes(); }
    if (ev.code === "KeyF") this.toggleSpeed();
    if (ev.code === "KeyM") this.toggleMute();
    if (ev.code === "KeyU") this.upgradeSelected();
    if (ev.code === "KeyT") this.cycleTargetMode();
    if (ev.code === "KeyB") this.startAbility("artillery");
    const codeOf = (h: string) => (h === "-" ? "Minus" : h === "=" ? "Equal" : `Digit${h}`);
    const hot = TOWER_ORDER.find((k) => codeOf(TOWER_DEFS[k].hotkey) === ev.code);
    if (hot) this.selectBuild(this.buildKind === hot ? null : hot);
    if (ev.code === "Enter" && this.state === "menu") this.startGame();
  };
  private onKeyUp = (ev: KeyboardEvent) => { this.keys[ev.code] = false; };
  private onMouseMove = (ev: MouseEvent) => {
    this.mousePx = { x: ev.clientX, y: ev.clientY };
    this.mouse.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
  };
  private onMouseDown = (ev: MouseEvent) => {
    if (ev.button === 1) { this.dragging = true; ev.preventDefault(); }
    if (ev.button === 0) this.downPx = { x: ev.clientX, y: ev.clientY };
  };
  private onMouseUp = (ev: MouseEvent) => {
    if (ev.button === 1) this.dragging = false;
    if (ev.button === 0) {
      const dx = ev.clientX - this.downPx.x, dy = ev.clientY - this.downPx.y;
      if (Math.hypot(dx, dy) < 7) this.handleClick();
    }
  };
  private onContext = (ev: Event) => { ev.preventDefault(); this.cancelModes(); };
  private onWheel = (ev: WheelEvent) => {
    this.camDistGoal = clamp(this.camDistGoal + ev.deltaY * 0.045, 20, 95);
  };
  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private bindInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("contextmenu", this.onContext);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("resize", this.onResize);
  }

  private cancelModes() {
    if (this.buildKind) this.selectBuild(null);
    else if (this.abilityMode) this.startAbility(null);
    else this.deselect();
  }

  private handleClick() {
    if (this.state !== "playing" && this.state !== "paused") return;
    if (!this.hoverOk) return;
    if (this.buildKind) {
      const gx = Math.round(this.hoverPoint.x / 2) * 2;
      const gz = Math.round(this.hoverPoint.z / 2) * 2;
      if (this.canPlaceAt(gx, gz, this.buildKind) && this.rp >= TOWER_DEFS[this.buildKind].cost) {
        this.placeTower(this.buildKind, gx, gz);
      } else {
        sfx.play("denied");
      }
      return;
    }
    if (this.abilityMode === "artillery") {
      this.callArtillery(this.hoverPoint.clone());
      return;
    }
    // pick tower
    const hits = this.raycaster.intersectObjects(this.towers.filter((t) => !t.dead).map((t) => t.hitMesh), false);
    if (hits.length > 0) {
      const t = this.towers.find((tt) => tt.hitMesh === hits[0].object);
      if (t) { this.selectTower(t); return; }
    }
    if (this.selected && !this.selected.dead && !this.selected.def.structure) {
      this.manualFire(this.hoverPoint.clone());
      return;
    }
    this.deselect();
  }

  private manualFire(point: THREE.Vector3) {
    const t = this.selected;
    if (!t) return;
    if (t.kind === "airpost" || t.kind === "observer" || t.kind === "sapper" || t.kind === "flame") return;
    const dist = t.pos.distanceTo(point);
    const range = t.def.range * t.rangeMul;
    if (dist > range * 1.06) {
      sfx.play("denied");
      this.onUi({ t: "toast", text: "OUT OF RANGE" });
      this.spawnRingPulse(point, 0xe5484d);
      return;
    }
    if (t.def.minRange > 0 && dist < t.def.minRange) {
      sfx.play("denied");
      this.onUi({ t: "toast", text: "INSIDE MINIMUM RANGE — NO FIRE" });
      this.spawnRingPulse(point, 0xe5484d);
      return;
    }
    if (t.cooldown > 0 || t.ammo <= 0) {
      sfx.play("click");
      return;
    }
    const aim = point.clone();
    aim.y = this.heightAt(point.x, point.z) + 0.5;
    const want = Math.atan2(aim.x - t.pos.x, aim.z - t.pos.z);
    t.turret.rotation.y = want;
    const muzzleY = t.pos.y + (t.kind === "flak" ? 1.1 : t.kind === "at" ? 1.37 : 1.28);
    const hd = Math.hypot(aim.x - t.pos.x, aim.z - t.pos.z);
    const rawE = Math.atan2(aim.y - muzzleY, Math.max(1, hd));
    const maxE = t.kind === "flak" ? 1.3 : 0.5;
    const minE = t.kind === "flak" ? -0.1 : -0.28;
    t.elev = clamp(rawE, minE, maxE);
    t.elevNode.rotation.x = -t.elev;
    this.fireTower(t, aim, true);
    this.spawnRingPulse(point, 0xf2b23e);
  }

  private ringPulses: { mesh: THREE.Mesh; life: number }[] = [];
  private spawnRingPulse(pos: THREE.Vector3, color: number) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.9, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, this.heightAt(pos.x, pos.z) + 0.25, pos.z);
    this.dyn.add(m);
    this.ringPulses.push({ mesh: m, life: 0.5 });
  }

  // ── public API (UI) ──────────────────────────────────────────────────────
  startGame() {
    sfx.ensure();
    this.resetGame();
    this.state = "playing";
    this.paused = false;
    sfx.play("click");
    this.onUi({ t: "screen", screen: "playing", stats: this.getStats() });
    this.onUi({ t: "banner", text: "BUILD YOUR DEFENSES", sub: "First convoy approaching — dig in.", tone: "info" });
    this.pushHud();
  }

  private resetGame() {
    while (this.dyn.children.length) this.dyn.remove(this.dyn.children[0]);
    for (const w of this.wrecks) this.scene.remove(w.group);
    this.towers = []; this.enemies = []; this.projs = []; this.trucks = []; this.wrecks = [];
    this.ringPulses.forEach((r) => this.dyn.remove(r.mesh));
    this.ringPulses = [];
    for (const s of this.sparks) s.life = 0;
    for (const s of this.smokes) s.life = 0;
    for (const c of this.craters) { c.life = 0; c.mesh.visible = false; c.mat.opacity = 0; }
    for (const g of this.gibs) { g.life = 0; g.mesh.visible = false; }
    this.rp = 400; this.cp = 2; this.baseHp = BASE_MAX; this.kills = 0; this.score = 0; this.playT = 0;
    this.waveIdx = -1; this.waveT = 0; this.between = true; this.nextIn = 12;
    this.spawnQueue = []; this.endT = -1;
    this.selected = null; this.selRing.visible = false;
    this.buildKind = null; this.abilityMode = null;
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (this.artyMarker) { this.scene.remove(this.artyMarker); this.artyMarker = null; }
    this.hqBarFg.scale.x = 1;
    this.shake = 0;
    this.camDist = 58; this.camDistGoal = 58; this.camPitchGoal = 0.94;
    this.camTarget.set(-6, 0, -2);
    this.spawnAmbientWreck(-30, -4);
    this.spawnAmbientWreck(24, 30);
  }

  backToMenu() {
    this.resetGame();
    this.state = "menu";
    this.onUi({ t: "screen", screen: "menu", stats: this.getStats() });
    this.pushHud();
  }

  togglePause() {
    if (this.state !== "playing" && this.state !== "paused") return;
    this.paused = !this.paused;
    this.state = this.paused ? "paused" : "playing";
    sfx.ensure();
    sfx.play("click");
    this.onUi({ t: "screen", screen: this.state, stats: this.getStats() });
  }

  toggleSpeed() {
    this.speed = this.speed === 1 ? 2 : 1;
    sfx.play("click");
    this.pushHud();
  }

  toggleMute() {
    sfx.setMuted(!sfx.muted);
    this.pushHud();
  }

  setShakeScale(v: number) { this.shakeScale = clamp(v, 0, 1.5); }

  selectBuild(kind: TowerKind | null) {
    if (this.state !== "playing" && this.state !== "paused") return;
    this.abilityMode = null;
    if (this.artyMarker) { this.scene.remove(this.artyMarker); this.artyMarker = null; }
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this.buildKind = kind;
    if (kind) {
      this.deselect();
      this.ghost = this.makeGhost(kind);
      this.scene.add(this.ghost);
      sfx.play("click");
    }
    this.pushHud();
  }

  startAbility(a: "artillery" | null) {
    if (this.state !== "playing" && this.state !== "paused") return;
    this.selectBuild(null);
    this.abilityMode = a;
    if (a === "artillery") {
      if (this.cp < ARTY_COST) {
        this.abilityMode = null;
        sfx.play("denied");
        this.onUi({ t: "toast", text: "NOT ENOUGH COMMAND POINTS" });
        this.pushHud();
        return;
      }
      const m = new THREE.Mesh(
        new THREE.RingGeometry(5.4, 6, 40),
        new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      this.artyMarker = m;
      this.scene.add(m);
      sfx.play("click");
    }
    this.pushHud();
  }

  private callArtillery(point: THREE.Vector3) {
    if (this.cp < ARTY_COST) {
      sfx.play("denied");
      this.onUi({ t: "toast", text: "NOT ENOUGH COMMAND POINTS" });
      this.startAbility(null);
      return;
    }
    this.cp -= ARTY_COST;
    sfx.play("whistle");
    this.onUi({ t: "toast", text: "ARTILLERY BARRAGE INBOUND" });
    this.spawnRingPulse(point, 0xe5484d);
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0, 5.5);
      const x = clamp(point.x + Math.cos(a) * r, -80, 80);
      const z = clamp(point.z + Math.sin(a) * r, -55, 55);
      const mesh = new THREE.Mesh(this.projGeoShell, this.projMatShell);
      const pos = new THREE.Vector3(x, 74, z);
      mesh.position.copy(pos);
      this.dyn.add(mesh);
      this.projs.push({
        mesh, pos, vel: new THREE.Vector3(rand(-2, 2), -34, rand(-2, 2)),
        dmg: 72, pen: 999, splash: 5, splashDmg: 72, kind: "arty",
        life: 6, manual: false, dead: false,
      });
    }
    this.startAbility(null);
  }

  callEarly() {
    if (!this.between || this.state !== "playing") return;
    this.nextIn = 0;
    this.rp += 40;
    sfx.play("coin");
    this.onUi({ t: "toast", text: "WAVE CALLED EARLY  +40 RP" });
    this.pushHud();
  }

  selectTower(t: Tower) {
    this.selected = t;
    this.selRing.visible = true;
    sfx.play("click");
    this.pushHud();
  }

  deselect() {
    this.selected = null;
    this.selRing.visible = false;
    this.pushHud();
  }

  upgradeSelected() {
    const t = this.selected;
    if (!t || t.dead || t.tier >= 3) return;
    const up = t.def.upgrades[t.tier];
    if (!up) return;
    if (this.rp < up.cost) {
      sfx.play("denied");
      this.onUi({ t: "toast", text: "INSUFFICIENT REQUISITION POINTS" });
      return;
    }
    this.rp -= up.cost;
    t.invested += up.cost;
    if (t.kind === "mg") {
      if (t.tier === 0) { t.dmgMul *= 1.6; t.penMul *= 1.8; }
      else if (t.tier === 1) { t.maxHp += 120; t.hp = t.maxHp; }
      else { t.rangeMul *= 1.3; t.rofMul *= 1.25; }
    } else if (t.kind === "at") {
      if (t.tier === 0) { t.penMul *= 1.6; t.dmgMul *= 1.25; }
      else if (t.tier === 1) { t.maxHp += 160; t.hp = t.maxHp; }
      else { t.rofMul *= 1.4; t.travMul *= 1.4; }
    } else if (t.kind === "flak") {
      if (t.tier === 0) { t.splashMul *= 1.7; }
      else if (t.tier === 1) { t.rofMul *= 1.3; t.travMul *= 1.3; }
      else { t.rangeMul *= 1.25; t.dmgMul *= 1.2; t.rofMul *= 1.25; }
    } else if (t.kind === "arty") {
      if (t.tier === 0) { t.splashMul *= 1.6; }
      else if (t.tier === 1) { t.maxHp += 180; t.hp = t.maxHp; }
      else { t.rangeMul *= 1.25; t.rofMul *= 1.35; }
    } else if (t.kind === "airpost") {
      // tier0 → rocket rails (fired once tier >= 1), tier1 → veteran pilot, tier2 → second plane
      if (t.tier === 1) { t.rofMul *= 1.45; }
    } else if (t.kind === "flame") {
      if (t.tier === 0) { this.burnDps = 10; }                       // napalm
      else if (t.tier === 1) { t.maxAmmo += 80; t.ammo = t.maxAmmo; } // fuel tanks
      else { t.maxHp += 140; t.hp = t.maxHp; t.rangeMul *= 1.25; }     // shielding
    } else if (t.kind === "atrifle") {
      if (t.tier === 0) { t.penMul *= 1.7; t.dmgMul *= 1.25; }
      else if (t.tier === 1) { t.rofMul *= 1.45; }
      else { t.maxHp += 120; t.hp = t.maxHp; t.rangeMul *= 1.2; }
    } else if (t.kind === "sapper") {
      if (t.tier === 1) { t.maxHp += 150; t.hp = t.maxHp; }
    }
    t.tier++;
    sfx.play("upgrade");
    this.burst(t.pos.clone().setY(t.pos.y + 2), 12, 6, 0.5, 0.5, new THREE.Color(1, 0.85, 0.4), 4);
    this.onUi({ t: "toast", text: `${up.name} INSTALLED` });
    this.pushHud();
  }

  private logT = 0;
  // autonomous logistics: ammunition carriers haul rounds from HQ to low emplacements
  private updateLogistics(dt: number) {
    this.logT -= dt;
    if (this.logT > 0) return;
    this.logT = 1.1;
    if (this.trucks.filter((tr) => tr.state !== "back").length >= 3) return;
    let best: Tower | null = null;
    let bestRatio = 1;
    for (const t of this.towers) {
      if (t.dead || t.def.ammo === 0) continue;
      if (this.trucks.some((tr) => tr.towerId === t.id)) continue;
      const ratio = t.ammo / t.maxAmmo;
      if (ratio < 0.32 && ratio < bestRatio) { bestRatio = ratio; best = t; }
    }
    if (best) {
      this.spawnTruck(best.id);
      sfx.play("horn");
      this.onUi({ t: "toast", text: `AMMUNITION CARRIER → ${best.def.short}` });
      this.pushHud();
    }
  }

  sellSelected() {
    const t = this.selected;
    if (!t || t.dead) return;
    const refund = Math.round(t.invested * SELL_RATIO);
    this.rp += refund;
    sfx.play("sell");
    this.dyn.remove(t.group);
    this.dyn.remove(t.hitMesh);
    this.clearAirPost(t);
    t.dead = true;
    this.towers = this.towers.filter((x) => x !== t);
    this.deselect();
    this.onUi({ t: "toast", text: `SALVAGED  +${refund} RP` });
    this.pushHud();
  }

  cycleTargetMode() {
    const t = this.selected;
    if (!t || t.dead || t.def.structure) return;
    t.targetMode = (t.targetMode + 1) % (t.def.antiAir ? 4 : 3);
    sfx.play("click");
    this.onUi({ t: "toast", text: `TARGETING: ${TARGET_MODES[t.targetMode]}` });
    this.pushHud();
  }

  private spawnTruck(towerId: number) {
    const g = new THREE.Group();
    const cab = this.box(1.5, 1.2, 1.4, this.mats.olive, 0, 1.0, 1.1);
    cab.castShadow = true;
    const bed = this.box(1.7, 0.9, 2.4, this.mats.oliveDark, 0, 0.85, -0.7);
    // ammunition crates with stencil stripes
    const crate1 = this.box(0.85, 0.62, 0.85, this.mats.oliveDark, -0.38, 1.62, -0.7);
    const stripe1 = this.box(0.87, 0.12, 0.87, this.mats.amber, -0.38, 1.62, -0.7);
    const crate2 = this.box(0.7, 0.55, 0.7, this.mats.olive, 0.45, 1.58, -0.55);
    const stripe2 = this.box(0.72, 0.1, 0.72, this.mats.amber, 0.45, 1.58, -0.55);
    g.add(cab, bed, crate1, stripe1, crate2, stripe2);
    for (const sx of [-0.8, 0.8]) for (const sz of [-1.4, 0.9]) {
      const w = this.cyl(0.34, 0.22, this.mats.dark, sx, 0.34, sz);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
    const start = this.hq.position.clone();
    g.position.copy(start);
    this.dyn.add(g);
    this.trucks.push({ group: g, pos: start.clone(), towerId, state: "go", unloadT: 0 });
  }

  private getStats(): Stats {
    return { kills: this.kills, score: this.score, wave: Math.max(0, this.waveIdx + 1), time: this.playT };
  }

  private pushHud() {
    const sel = this.selected && !this.selected.dead ? this.selected : null;
    let selData: SelData | null = null;
    if (sel) {
      const up = sel.tier < 3 ? sel.def.upgrades[sel.tier] : null;
      selData = {
        id: sel.id, kind: sel.kind, name: sel.def.name,
        hp: Math.max(0, Math.ceil(sel.hp)), maxHp: sel.maxHp,
        ammo: sel.ammo, maxAmmo: sel.maxAmmo, tier: sel.tier,
        range: Math.round(sel.def.range * sel.rangeMul),
        upgradeName: up ? up.name : null, upgradeCost: up ? up.cost : 0,
        upgradeDesc: up ? up.desc : "",
        targetMode: TARGET_MODES[sel.targetMode], structure: sel.def.structure,
        sellValue: Math.round(sel.invested * SELL_RATIO),
        minRange: sel.def.minRange,
        carrier: this.trucks.some((tr) => tr.towerId === sel.id && tr.state !== "back"),
      };
    }
    const hostiles = this.spawnQueue.length + this.enemies.filter((e) => !e.dead).length;
    this.onUi({
      t: "hud",
      hud: {
        rp: Math.floor(this.rp), cp: this.cp, baseHp: this.baseHp, baseMax: BASE_MAX,
        wave: Math.max(0, this.waveIdx + 1), waveTotal: WAVES.length, hostiles,
        kills: this.kills, score: this.score, time: this.playT, speed: this.speed,
        between: this.between, nextIn: Math.ceil(this.nextIn), muted: sfx.muted,
      },
      sel: selData,
      build: this.buildKind,
      ability: this.abilityMode,
    });
  }

  // ── waves (scripted, then endless) ───────────────────────────────────────
  nextWaveInfo(): { label: string; intel: string } {
    const w = this.waveDefFor(this.waveIdx + 1);
    return { label: w.label, intel: w.intel };
  }

  private waveDefFor(i: number): WaveDef {
    if (i < WAVES.length) return WAVES[i];
    const n = i - WAVES.length + 1; // 1-based endless wave number
    const w = WAVES.length;
    const cap = (v: number, m: number) => Math.min(m, v);
    const entries: WaveEntry[] = [
      { kind: "infantry", count: cap(10 + n * 2, 30), gap: Math.max(0.7, 1.4 - n * 0.04), delay: 4 },
      { kind: "bike", count: cap(4 + n, 14), gap: 1.3, delay: 0 },
      { kind: "scout", count: cap(2 + Math.floor(n / 2), 8), gap: 5, delay: 8 },
      { kind: "halftrack", count: cap(2 + Math.floor(n / 2), 9), gap: 5.5, delay: 12 },
      { kind: "panzer", count: cap(2 + Math.floor(n / 2), 10), gap: 7, delay: 16 },
      { kind: "stug", count: cap(1 + Math.floor(n / 2), 8), gap: 8, delay: 20 },
      { kind: "stuka", count: cap(1 + Math.floor(n / 3), 5), gap: 8, delay: 26 },
    ];
    if (n >= 2) entries.push({ kind: "panther", count: cap(1 + Math.floor(n / 3), 7), gap: 10, delay: 22 });
    if (n >= 3 && n % 2 === 1) entries.push({ kind: "heinkel", count: cap(Math.floor(n / 3), 3), gap: 14, delay: 30 });
    if (n >= 4) entries.push({ kind: "tiger", count: cap(Math.floor(n / 3), 5), gap: 14, delay: 6 });
    return {
      label: ENDLESS_LABELS[(i - w) % ENDLESS_LABELS.length],
      intel: `The offensive does not end. Reinforcements every wave — armor scales +${Math.round(n * 16)}%.`,
      entries,
    };
  }

  private startWave() {
    this.waveIdx++;
    const w = this.waveDefFor(this.waveIdx);
    this.waveHpMul = this.waveIdx < WAVES.length ? 1 : 1 + (this.waveIdx - WAVES.length + 1) * 0.16;
    this.spawnQueue = [];
    for (const en of w.entries) {
      for (let i = 0; i < en.count; i++) {
        this.spawnQueue.push({ kind: en.kind, t: en.delay + i * en.gap + rand(0, 0.6) });
      }
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.waveT = 0;
    this.between = false;
    this.waveDamageTaken = false;
    this.onUi({ t: "banner", text: `WAVE ${this.waveIdx + 1} — ${w.label}`, sub: w.intel, tone: "warn" });
    sfx.play("alarm");
    this.pushHud();
  }

  private waveCleared() {
    const bonus = 90 + (this.waveIdx + 1) * 18;
    this.rp += bonus;
    this.score += 100 + (this.waveIdx + 1) * 25;
    const cpGain = this.waveDamageTaken ? 1 : 2;
    this.cp = Math.min(CP_MAX, this.cp + cpGain);
    sfx.play("coin");
    this.between = true;
    this.nextIn = 10;
    const milestone = (this.waveIdx + 1) % 5 === 0;
    this.onUi({
      t: "banner",
      text: `WAVE CLEARED  +${bonus} RP`,
      sub: milestone ? `Wave ${this.waveIdx + 1} repelled. They keep coming, Commander.` : this.waveDamageTaken ? "Resupply and reinforce." : "Flawless defense — bonus command point.",
      tone: "good",
    });
    this.pushHud();
  }

  // ── main loop ────────────────────────────────────────────────────────────
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const rdt = Math.min(this.clock.getDelta(), 0.05);
    const simDt = this.state === "playing" && !this.paused ? rdt * this.speed : 0;
    if (simDt > 0) {
      this.playT += simDt;
      this.rp += 2 * simDt;
      this.updateWaves(simDt);
      this.updateEnemies(simDt);
      this.updateTowers(simDt);
      this.updateProjectiles(simDt);
      this.updateTrucks(simDt);
      if (this.endT >= 0) {
        this.endT -= rdt;
        if (this.endT < 0) {
          this.state = this.endScreen;
          this.onUi({ t: "screen", screen: this.endScreen, stats: this.getStats() });
        }
      }
    }
    this.updateFx(rdt);
    this.updateCamera(rdt);
    this.updateHover();
    this.hudT -= rdt;
    if (this.hudT <= 0 && this.state !== "menu") {
      this.hudT = 0.12;
      this.pushHud();
    }
    this.renderer.render(this.scene, this.camera);
  };

  private updateWaves(dt: number) {
    if (this.endT >= 0) return;
    if (this.between) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) this.startWave();
      return;
    }
    this.waveT += dt;
    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.waveT) {
      const s = this.spawnQueue.shift()!;
      this.spawnEnemy(s.kind);
    }
    if (!this.spawnQueue.length && !this.enemies.some((e) => !e.dead)) this.waveCleared();
  }

  private updateEnemies(dt: number) {
    const v = new THREE.Vector3();
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }
      e.flashT = Math.max(0, e.flashT - dt);
      const pulse = e.flashT > 0 ? 1.07 : 1;
      e.group.scale.setScalar(pulse);
      e.markT = Math.max(0, e.markT - dt);

      // napalm burn damage-over-time (flamethrower)
      if (e.burnT > 0 && !e.flying && !e.falling) {
        e.burnT -= dt;
        e.hp -= this.burnDps * dt;
        if (Math.random() < dt * 14) {
          this.spawnSpark(
            e.pos.clone().add(new THREE.Vector3(rand(-0.8, 0.8), rand(0.4, 1.6), rand(-0.8, 0.8))),
            new THREE.Vector3(rand(-1.4, 1.4), rand(2.5, 5), rand(-1.4, 1.4)),
            0.3, rand(0.3, 0.55), Math.random() < 0.6 ? new THREE.Color(1, 0.55, 0.15) : new THREE.Color(1, 0.85, 0.3), 8,
          );
        }
        if (e.hp <= 0) { this.killEnemy(e); continue; }
      }

      if (e.falling) {
        // death spiral: accelerating fall, tightening turn, increasing roll and nose-down
        e.fallVy -= 15 * dt;
        e.pos.y += e.fallVy * dt;
        e.heading += 3.0 * dt;                                  // tightening spiral
        e.pos.x += Math.sin(e.heading) * 8 * dt;
        e.pos.z += Math.cos(e.heading) * 8 * dt;
        e.group.rotation.y = e.heading;
        e.group.rotation.z += 3.4 * dt;                          // barrel roll
        e.group.rotation.x = Math.min(1.0, e.group.rotation.x + 1.3 * dt); // nose drops
        this.spawnSmoke(e.pos.clone(), new THREE.Vector3(rand(-1, 1), 1.4, rand(-1, 1)), 1.5, 2.2, 0.32);
        if (Math.random() < 0.55) this.spawnSpark(e.pos.clone(), new THREE.Vector3(rand(-4, 4), rand(-1, 5), rand(-4, 4)), 0.42, 0.75, new THREE.Color(1, 0.5, 0.12), 6);
        e.group.position.copy(e.pos);
        if (e.pos.y <= this.heightAt(e.pos.x, e.pos.z) + 0.6) {
          const big = e.kind === "heinkel";
          this.explode(e.pos.clone(), big ? 7.5 : 5.5, big ? 90 : 60, { big: true, hurtsTowers: true, crater: big ? 1.7 : 1.3 });
          this.spawnGibs(e, big ? 16 : 10, big ? 11 : 8);
          this.dyn.remove(e.group);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      if (e.flying) {
        if (e.kind === "heinkel") this.updateBomber(e, dt);
        else this.updateStuka(e, dt);
        continue;
      }

      // slow factors from structures
      let slow = 1;
      for (const t of this.towers) {
        if (t.dead || !t.def.structure) continue;
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        if (t.kind === "wire" && e.kind === "infantry" && d < t.def.range) slow = Math.min(slow, 0.32);
        if (t.kind === "hedgehog" && e.kind !== "infantry" && d < t.def.range) {
          slow = Math.min(slow, 0.42);
          e.hp -= 3.5 * dt;
          t.hp -= 5 * dt;
          if (t.hp <= 0) this.damageTower(t, 9999);
          if (e.hp <= 0) { this.damageEnemy(e, 9999, 999, e.pos, v.set(0, 1, 0)); break; }
        }
        if (t.kind === "mines" && t.ammo > 0 && d < 3.0) {
          t.ammo--;
          this.explode(t.pos.clone().setY(t.pos.y + 0.5), t.def.splash, t.def.dmg, { big: true });
          this.burst(t.pos.clone().setY(t.pos.y + 1), 10, 10, 0.5, 0.6, new THREE.Color(0.5, 0.42, 0.3), 10);
          if (t.ammo <= 0) {
            this.dyn.remove(t.group);
            this.dyn.remove(t.hitMesh);
            t.dead = true;
            this.towers = this.towers.filter((x) => x !== t);
            if (this.selected === t) this.deselect();
          }
        }
      }

      const prev = e.pos.clone();
      // infantry advances in bounding-overwatch rushes; vehicles keep column spacing
      let gait = 1;
      if (e.kind === "infantry") {
        const cyc = (this.playT + e.phase) % 2.2;
        gait = cyc < 1.4 ? 1.45 : 0.12;
      } else {
        for (const o of this.enemies) {
          if (o === e || o.dead || o.flying || o.kind === "infantry" || o.kind === "bike") continue;
          const gap = o.dist - e.dist;
          if (gap > 0 && gap < 5.5 && Math.abs(o.lane - e.lane) < 2.4) {
            gait = Math.min(gait, gap < 2.6 ? 0.1 : gap < 4 ? 0.55 : 0.85);
          }
        }
      }
      e.dist += e.def.speed * slow * gait * dt;
      if (e.dist >= this.pathTotal - 1.5) {
        // reached HQ
        this.dyn.remove(e.group);
        this.enemies.splice(i, 1);
        this.explode(this.hq.position.clone().setY(this.hq.position.y + 1.5), 4, 0, {});
        this.damageBase(e.def.baseDmg);
        continue;
      }
      const s = this.pathPoint(e.dist);
      const px = s.x + -s.dz * e.lane;
      const pz = s.z + s.dx * e.lane;
      e.pos.set(px, this.heightAt(px, pz), pz);
      e.heading = Math.atan2(s.dx, s.dz);
      e.vel.copy(e.pos).sub(prev).divideScalar(Math.max(dt, 0.0001));
      e.group.position.copy(e.pos);
      e.group.rotation.y = e.heading;

      if (e.kind === "infantry") {
        for (let k = 0; k < e.soldiers.length; k++) {
          e.soldiers[k].position.y = Math.abs(Math.sin(this.playT * 9 + k * 1.7)) * 0.12 * slow;
        }
      }
      if (e.hpBar) {
        const pct = clamp(e.hp / e.maxHp, 0, 1);
        const fg = e.hpBar.children[1] as THREE.Mesh;
        fg.scale.x = pct;
        const wBar = e.def.radius * 1.7;
        fg.position.x = -wBar * 0.5 * (1 - pct);
        fg.material = pct < 0.35 ? this.mats.barRed : this.mats.barAmber;
        e.hpBar.quaternion.copy(this.camera.quaternion);
      }
    }
  }

  private updateStuka(e: Enemy, dt: number) {
    let tx = 66, tz = 22;
    const target = this.towers.find((t) => t.id === e.targetId && !t.dead);
    if (target) { tx = target.pos.x; tz = target.pos.z; }
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const dist = Math.hypot(dx, dz);
    e.heading = Math.atan2(dx, dz);
    const sp = e.def.speed;
    e.pos.x += (dx / (dist || 1)) * sp * dt;
    e.pos.z += (dz / (dist || 1)) * sp * dt;
    if (!e.bombDropped) {
      e.flyY = dist < 26 ? lerp(e.flyY, 15, dt * 1.2) : lerp(e.flyY, 27, dt * 0.5);
    } else {
      e.flyY += 9 * dt;
    }
    e.pos.y = e.flyY;
    if (!e.sirenPlayed && dist < 60) {
      e.sirenPlayed = true;
      sfx.play("siren");
      this.onUi({ t: "toast", text: "STUKA DIVE BOMBER INBOUND" });
    }
    if (!e.bombDropped && dist < 5) {
      e.bombDropped = true;
      const bomb = new THREE.Mesh(this.bombGeo, this.bombMat);
      const bpos = e.pos.clone().add(new THREE.Vector3(0, -1, 0));
      bomb.position.copy(bpos);
      this.dyn.add(bomb);
      this.projs.push({
        mesh: bomb, pos: bpos, vel: new THREE.Vector3((dx / (dist || 1)) * sp * 0.55, -2, (dz / (dist || 1)) * sp * 0.55),
        dmg: 135, pen: 999, splash: 6, splashDmg: 135, kind: "bomb", life: 8, manual: false, dead: false,
      });
    }
    // MG strafing pass on the way in
    if (!e.bombDropped && target && dist < 34) {
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeT = 1.15;
        sfx.play("mg");
        for (let k = 0; k < 3; k++) {
          this.spawnSpark(
            e.pos.clone().add(new THREE.Vector3(rand(-0.5, 0.5), -0.6, rand(-0.5, 0.5))),
            new THREE.Vector3((dx / (dist || 1)) * 60 + rand(-4, 4), -38, (dz / (dist || 1)) * 60 + rand(-4, 4)),
            0.4, 0.5, new THREE.Color(1, 0.55, 0.25), 26,
          );
        }
        this.damageTower(target, 2.2);
      }
    }
    e.group.position.copy(e.pos);
    e.group.rotation.y = e.heading;
    e.group.rotation.x = e.bombDropped ? -0.5 : dist < 26 ? 0.22 : 0;
    e.group.rotation.z = Math.sin(this.playT * 2.6 + e.phase) * 0.16;
    e.vel.set((dx / (dist || 1)) * sp, 0, (dz / (dist || 1)) * sp);
    if (e.bombDropped && (Math.abs(e.pos.x) > 105 || Math.abs(e.pos.z) > 75)) {
      this.dyn.remove(e.group);
      e.dead = true;
    }
  }

  // He 111: high-altitude level bomber — crosses the map and walks bombs onto the target
  private updateBomber(e: Enemy, dt: number) {
    let tx = 66, tz = 22;
    const target = this.towers.find((t) => t.id === e.targetId && !t.dead);
    if (target) { tx = target.pos.x; tz = target.pos.z; }
    const sp = e.def.speed;
    e.pos.x -= sp * dt; // steady westbound run
    // ease toward the target lane before the bomb run
    e.pos.z = lerp(e.pos.z, tz, Math.min(1, dt * 0.8));
    e.heading = Math.atan2(-1, (tz - e.pos.z) * 0.05);
    e.pos.y = e.flyY;
    if (!e.sirenPlayed) {
      e.sirenPlayed = true;
      sfx.play("siren");
      this.onUi({ t: "toast", text: "BOMBER FORMATION OVERHEAD — WESTBOUND" });
    }
    // walk three bombs onto the target as it passes
    if (e.bombs > 0 && Math.abs(e.pos.x - tx) < 10 && Math.abs(e.pos.z - tz) < 12) {
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeT = 0.55;
        e.bombs--;
        const bomb = new THREE.Mesh(this.bombGeo, this.bombMat);
        const bpos = e.pos.clone().add(new THREE.Vector3(0, -1.2, 0));
        bomb.position.copy(bpos);
        this.dyn.add(bomb);
        this.projs.push({
          mesh: bomb, pos: bpos, vel: new THREE.Vector3(-sp * 0.5, -4, 0),
          dmg: 120, pen: 999, splash: 5.5, splashDmg: 120, kind: "bomb", life: 8, manual: false, dead: false,
        });
      }
    }
    e.group.position.copy(e.pos);
    e.group.rotation.y = e.heading;
    e.group.rotation.z = Math.sin(this.playT * 1.4 + e.phase) * 0.06;
    e.vel.set(-sp, 0, 0);
    if (e.pos.x < -110) {
      this.dyn.remove(e.group);
      e.dead = true;
    }
  }

  // ── support emplacements ──────────────────────────────────────────────────
  private updateFlame(t: Tower, dt: number) {
    const range = t.def.range * t.rangeMul;
    // find nearest ground target in reach
    let target: Enemy | null = null;
    let bestD = range;
    for (const e of this.enemies) {
      if (e.dead || e.flying || e.falling) continue;
      const d = e.pos.distanceTo(t.pos) - e.def.radius;
      if (d < bestD) { bestD = d; target = e; }
    }
    if (target) {
      const want = Math.atan2(target.pos.x - t.pos.x, target.pos.z - t.pos.z);
      const rate = t.def.traverse * t.travMul * 3.2;
      t.turret.rotation.y = angLerp(t.turret.rotation.y, want, rate * dt);
    }
    const aligned = target && Math.abs(angDiff(t.turret.rotation.y, Math.atan2(target.pos.x - t.pos.x, target.pos.z - t.pos.z))) < 0.3;
    const firing = aligned && target && t.ammo > 0;
    if (firing) {
      t.ammo = Math.max(0, t.ammo - dt * 7.5);
      t.flashT = 0.1;
      t.recoil = 0.4;
      const yaw = t.turret.rotation.y;
      const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const muzzlePos = new THREE.Vector3(t.pos.x + dir.x * 1.9, t.pos.y + 1.0, t.pos.z + dir.z * 1.9);
      // flame jet particles
      for (let i = 0; i < 4; i++) {
        const spread = rand(-0.22, 0.22);
        const v = dir.clone().multiplyScalar(rand(11, 17));
        v.x += Math.cos(yaw) * spread * 12 + rand(-1.5, 1.5);
        v.z -= Math.sin(yaw) * spread * 12 + rand(-1.5, 1.5);
        v.y = rand(0.4, 2.6);
        this.spawnSpark(muzzlePos.clone(), v, rand(0.35, 0.7), rand(0.4, 0.8),
          Math.random() < 0.5 ? new THREE.Color(1, 0.62, 0.18) : new THREE.Color(1, 0.88, 0.34), rand(3, 6));
      }
      if (Math.random() < dt * 9) this.spawnSmoke(muzzlePos.clone().add(dir.clone().multiplyScalar(rand(2, 5))), new THREE.Vector3(rand(-1, 1), 2, rand(-1, 1)), 1.6, 2.0, 0.4, 1.2);
      this.flashAt(muzzlePos, 30);
      if (Math.random() < dt * 8) sfx.play("flame");
      this.addShake(0.02);
      // cone damage + ignition
      const napalm = t.tier >= 1;
      for (const e of this.enemies) {
        if (e.dead || e.flying || e.falling) continue;
        const to = e.pos.clone().sub(t.pos);
        const d = to.length() - e.def.radius;
        if (d > range) continue;
        to.normalize();
        if (to.dot(dir) < 0.55) continue; // outside ~56° cone
        this.damageEnemy(e, t.def.dmg * t.dmgMul * dt, 999, e.pos, dir);
        e.burnT = Math.max(e.burnT, napalm ? 3.2 : 2.0);
      }
      if (t.ammo === 0) this.onUi({ t: "toast", text: `${t.def.short} FUEL EMPTY — CARRIER DISPATCHED FROM HQ` });
    }
    void dt;
  }

  private updateObserver(t: Tower, dt: number) {
    t.aiT -= dt;
    // idle sweep of the spotting scope
    t.turret.rotation.y += dt * 0.7;
    const range = t.def.range * t.rangeMul * (t.tier >= 2 ? 1.4 : 1);
    if (t.aiT <= 0) {
      t.aiT = 1.1;
      let marked = 0;
      const mul = t.tier >= 1 ? 1.35 : 1.25;
      for (const e of this.enemies) {
        if (e.dead || e.falling) continue;
        if (e.pos.distanceTo(t.pos) < range + e.def.radius) {
          e.markT = 2.4;
          e.markMul = mul;
          marked++;
          if (marked <= 4) this.spawnRingPulse(e.pos.clone().setY(e.pos.y + 0.3), 0xf2b23e);
        }
      }
      if (marked > 0) {
        // swing scope toward the nearest marked target
        let near: Enemy | null = null; let nd = range;
        for (const e of this.enemies) {
          if (e.dead || e.falling || e.markT <= 0) continue;
          const d = e.pos.distanceTo(t.pos);
          if (d < nd) { nd = d; near = e; }
        }
        if (near) t.turret.rotation.y = Math.atan2(near.pos.x - t.pos.x, near.pos.z - t.pos.z);
        sfx.play("click");
      }
    }
  }

  private updateSapper(t: Tower, dt: number) {
    t.aiT -= dt;
    const radius = t.def.range * t.rangeMul * (t.tier >= 3 ? 1.5 : 1);
    const rate = (t.tier >= 1 ? 9 : 5.5) * dt;
    let working = false;
    for (const o of this.towers) {
      if (o === t || o.dead || o.def.structure || o.hp >= o.maxHp) continue;
      if (o.pos.distanceTo(t.pos) < radius) {
        o.hp = Math.min(o.maxHp, o.hp + rate);
        working = true;
        if (Math.random() < dt * 6) {
          this.spawnSpark(o.pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0.5, 2), rand(-1, 1))),
            new THREE.Vector3(rand(-2, 2), rand(2, 4), rand(-2, 2)), 0.3, 0.4, new THREE.Color(0.6, 1, 0.5), 6);
        }
      }
    }
    // also patch up nearby defensive structures
    for (const o of this.towers) {
      if (o === t || o.dead || !o.def.structure || o.hp >= o.maxHp) continue;
      if (o.pos.distanceTo(t.pos) < radius) {
        o.hp = Math.min(o.maxHp, o.hp + rate * 0.6);
        working = true;
      }
    }
    if (working) {
      // swing crane arm + pump the repairman
      t.turret.rotation.y += dt * 1.6;
      if (t.loader) t.loader.position.y = Math.abs(Math.sin(this.playT * 7)) * 0.2;
      if (t.aiT <= 0) { t.aiT = 0.55; sfx.play("wrench"); }
    } else if (t.loader) {
      t.loader.position.y = 0;
    }
  }

  private updateTowers(dt: number) {
    for (const t of this.towers) {
      if (t.dead) continue;
      t.cooldown = Math.max(0, t.cooldown - dt);
      t.recoil = Math.max(0, t.recoil - dt * 5);
      t.flashT = Math.max(0, t.flashT - dt);
      t.barrel.position.z = -t.recoil * 0.45;
      if (t.breech) {
        const prog = t.reloadMax > 0 ? clamp(1 - t.reloadT / (t.reloadMax / this.rofMulOf(t)), 0, 1) : 1;
        t.breech.position.x = Math.sin(prog * Math.PI) * 0.42;
      }
      if (t.loader) {
        const active = t.reloadT > 0;
        t.loader.position.y = active ? Math.abs(Math.sin(this.playT * 10)) * 0.22 : 0;
      }
      if (t.reloadT > 0) {
        const was = t.reloadT;
        t.reloadT = Math.max(0, t.reloadT - dt);
        if (was > 0.3 && t.reloadT <= 0.3 && t.def.kind !== "mg") sfx.play("reload");
      }
      t.group.scale.setScalar(t.flashT > 0 ? 1.05 : 1);

      if (t.kind === "airpost") { this.updateAirPost(t, dt); continue; }
      if (t.def.structure) continue;
      if (t.hpBar) {
        const pct = clamp(t.hp / t.maxHp, 0, 1);
        const fg = t.hpBar.children[1] as THREE.Mesh;
        fg.scale.x = pct;
        fg.position.x = -1.1 * (1 - pct);
        fg.material = pct < 0.35 ? this.mats.barRed : this.mats.barAmber;
        t.hpBar.quaternion.copy(this.camera.quaternion);
      } else if (t.hp < t.maxHp) {
        const bar = new THREE.Group();
        const bg = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.22), this.mats.black);
        const fg = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.22), this.mats.barAmber);
        fg.position.z = 0.01;
        bar.add(bg, fg);
        bar.position.y = 3.6;
        t.group.add(bar);
        t.hpBar = bar;
      }

      // support emplacements run their own loops instead of firing
      if (t.kind === "observer") { this.updateObserver(t, dt); continue; }
      if (t.kind === "sapper") { this.updateSapper(t, dt); continue; }
      if (t.kind === "flame") { this.updateFlame(t, dt); continue; }

      // targeting
      t.aiT -= dt;
      const range = t.def.range * t.rangeMul;
      if (t.aiT <= 0 || (t.target && (t.target.dead
        || t.target.pos.distanceTo(t.pos) > range * 1.1
        || t.target.pos.distanceTo(t.pos) < t.def.minRange))) {
        t.aiT = 0.12;
        let best: Enemy | null = null;
        let bestVal = -1e9;
        for (const e of this.enemies) {
          if (e.dead || e.falling) continue;
          if (e.flying && !t.def.antiAir) continue;
          const d = e.pos.distanceTo(t.pos);
          if (d > range || d < t.def.minRange + 1.5) continue;
          let val = 0;
          if (t.targetMode === 3) val = (e.flying ? 1e6 : 0) + e.dist; // air first, then closest
          else if (t.targetMode === 0) val = e.dist;
          else if (t.targetMode === 1) val = -d;
          else val = e.hp;
          if (val > bestVal) { bestVal = val; best = e; }
        }
        t.target = best;
      }

      // barrel elevation (idle: MG/AT level, Flak scans skyward)
      let elevDes = t.kind === "flak" ? 0.42 : t.kind === "arty" ? 1.0 : 0.04;
      let pitchOk = true;
      if (t.target && !t.target.dead) {
        const aim = this.aimPrediction(t, t.target);
        const want = Math.atan2(aim.x - t.pos.x, aim.z - t.pos.z);
        const rate = t.def.traverse * t.travMul * dt;
        const cur = t.turret.rotation.y;
        t.turret.rotation.y = angLerp(cur, want, rate / Math.max(0.001, Math.abs(angDiff(cur, want))));
        const muzzleY = t.pos.y + (t.kind === "flak" ? 1.1 : t.kind === "at" ? 1.37 : 1.28);
        const hd = Math.hypot(aim.x - t.pos.x, aim.z - t.pos.z);
        const rawE = Math.atan2(aim.y - muzzleY, Math.max(1, hd));
        const maxE = t.kind === "flak" ? 1.3 : t.kind === "arty" ? 1.22 : 0.5;
        const minE = t.kind === "flak" ? -0.1 : t.kind === "arty" ? 0.85 : -0.28;
        elevDes = clamp(rawE, minE, maxE);
        pitchOk = Math.abs(t.elev - elevDes) < 0.22;
        const aligned = Math.abs(angDiff(t.turret.rotation.y, want)) < 0.14;
        if (aligned && pitchOk && t.cooldown <= 0 && t.ammo > 0) {
          this.fireTower(t, aim, false);
        }
      }
      t.elev = lerp(t.elev, elevDes, Math.min(1, dt * (t.kind === "mg" ? 6 : 3.4)));
      t.elevNode.rotation.x = -t.elev;
    }
    // selected ring follows
    if (this.selected && !this.selected.dead) {
      this.selRing.position.set(this.selected.pos.x, this.selected.pos.y + 0.18, this.selected.pos.z);
      const r = this.selected.def.range * this.selected.rangeMul;
      this.selRing.scale.setScalar(Math.max(0.01, r / 10));
    }
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      p.life -= dt;
      p.vel.y -= GRAV * dt * (p.kind === "tracer" ? 0.35 : 1);
      const prev = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.kind !== "bomb") {
        const look = p.pos.clone().add(p.vel);
        p.mesh.lookAt(look);
        p.mesh.rotateX(Math.PI / 2);
      } else {
        p.mesh.rotation.x += 6 * dt;
      }
      let hit = false;

      // segment sweep this frame (no tunneling at high shell velocity)
      const seg = p.pos.clone().sub(prev);
      const segLen2 = seg.lengthSq();

      // flying proximity fuse for flak
      if (!hit && p.kind === "flak") {
        for (const e of this.enemies) {
          if (e.dead || !e.flying) continue;
          const tt = segLen2 > 1e-6 ? clamp(e.pos.clone().sub(prev).dot(seg) / segLen2, 0, 1) : 1;
          const closest = prev.clone().addScaledVector(seg, tt);
          if (closest.distanceTo(e.pos) < 3.8) {
            this.explode(p.pos, p.splash + 1.5, p.splashDmg, { big: false });
            this.damageEnemy(e, p.dmg, p.pen, e.pos, p.vel);
            hit = true;
            break;
          }
        }
      }

      // enemy collision
      if (!hit) {
        for (const e of this.enemies) {
          if (e.dead || e.falling) continue;
          const r = e.def.radius + (p.kind === "tracer" ? 0.55 : 0.85);
          const tt = segLen2 > 1e-6 ? clamp(e.pos.clone().sub(prev).dot(seg) / segLen2, 0, 1) : 1;
          const closest = prev.clone().addScaledVector(seg, tt);
          if (Math.abs(e.pos.y - closest.y) < r + 1.2 && closest.distanceTo(e.pos) < r) {
            if (p.splash > 0) this.explode(p.pos, p.splash, p.splashDmg, {});
            this.damageEnemy(e, p.dmg, p.pen, p.pos, p.vel);
            hit = true;
            break;
          }
        }
      }

      // terrain (checked after enemies so flat-trajectory rounds reach their target)
      if (!hit) {
        const th = this.heightAt(p.pos.x, p.pos.z);
        if (p.pos.y <= th + 0.15) {
          p.pos.y = th + 0.15;
          if (p.kind === "tracer") {
            this.spawnSmoke(p.pos.clone(), new THREE.Vector3(0, 1.2, 0), 0.5, 0.5, 0.6, 1.4);
          } else {
            this.explode(p.pos, p.splash, p.splashDmg, { big: p.kind === "arty" || p.kind === "bomb", hurtsTowers: p.kind === "bomb", crater: 1 });
          }
          hit = true;
        }
      }

      if (hit || p.life <= 0 || Math.abs(p.pos.x) > 110 || Math.abs(p.pos.z) > 80 || p.pos.y > 120) {
        this.dyn.remove(p.mesh);
        this.projs.splice(i, 1);
      }
    }
  }

  private updateTrucks(dt: number) {
    this.updateLogistics(dt);
    for (let i = this.trucks.length - 1; i >= 0; i--) {
      const tr = this.trucks[i];
      const tower = this.towers.find((t) => t.id === tr.towerId && !t.dead);
      if (tr.state === "unload") {
        tr.unloadT -= dt;
        if (Math.random() < dt * 10) {
          this.burst(tr.pos.clone().setY(tr.pos.y + 1.7), 2, 2, 0.3, 0.35, new THREE.Color(0.9, 0.8, 0.5), 3);
        }
        if (tr.unloadT <= 0) {
          if (tower && !tower.dead) {
            tower.ammo = tower.maxAmmo;
            sfx.play("reload");
            this.onUi({ t: "toast", text: `${tower.def.short} REARMED` });
            this.burst(tower.pos.clone().setY(tower.pos.y + 1.5), 8, 4, 0.4, 0.4, new THREE.Color(0.6, 1, 0.5), 4);
          }
          tr.state = "back";
          this.pushHud();
        }
        continue;
      }
      const dest = tr.state === "go"
        ? (tower ? tower.pos : this.hq.position)
        : this.hq.position;
      const dx = dest.x - tr.pos.x, dz = dest.z - tr.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.6) {
        if (tr.state === "go") {
          tr.state = "unload";
          tr.unloadT = 1.3;
          sfx.play("click");
        } else {
          this.dyn.remove(tr.group);
          this.trucks.splice(i, 1);
          this.pushHud();
        }
        continue;
      }
      const sp = 13;
      tr.pos.x += (dx / d) * sp * dt;
      tr.pos.z += (dz / d) * sp * dt;
      tr.pos.y = this.heightAt(tr.pos.x, tr.pos.z);
      tr.group.position.copy(tr.pos);
      tr.group.rotation.y = Math.atan2(dx, dz);
      if (Math.random() < dt * 6) {
        this.spawnSmoke(tr.pos.clone().add(new THREE.Vector3(-Math.sin(tr.group.rotation.y) * 1.2, 1.2, -Math.cos(tr.group.rotation.y) * 1.2)), new THREE.Vector3(0, 0.8, 0), 0.7, 0.5, 0.7, 1.2);
      }
    }
  }

  private updateFx(rdt: number) {
    // sparks
    for (let i = 0; i < SPARK_MAX; i++) {
      const p = this.sparks[i];
      if (p.life > 0) {
        p.life -= rdt;
        p.vel.y -= p.grav * rdt;
        p.vel.multiplyScalar(Math.pow(p.drag, rdt * 60));
        p.pos.addScaledVector(p.vel, rdt);
        const a = clamp(p.life / p.maxLife, 0, 1);
        this.dummy.position.copy(p.pos);
        this.dummy.quaternion.copy(this.camera.quaternion);
        this.dummy.scale.setScalar(Math.max(0.001, p.size * (0.5 + a * 0.7)));
        this.dummy.updateMatrix();
        this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
      } else {
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
      }
    }
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < SMOKE_MAX; i++) {
      const p = this.smokes[i];
      if (p.life > 0) {
        p.life -= rdt;
        p.vel.y -= p.grav * rdt;
        p.vel.multiplyScalar(Math.pow(p.drag, rdt * 60));
        p.pos.addScaledVector(p.vel, rdt);
        const a = clamp(p.life / p.maxLife, 0, 1);
        this.dummy.position.copy(p.pos);
        this.dummy.quaternion.copy(this.camera.quaternion);
        this.dummy.scale.setScalar(Math.max(0.001, p.size + (1 - a) * p.grow));
        this.dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, this.dummy.matrix);
      } else {
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, this.dummy.matrix);
      }
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;

    for (const l of this.flashLights) l.intensity *= Math.exp(-11 * rdt);

    for (const c of this.craters) {
      if (c.life > 0) {
        c.life -= rdt;
        if (c.life <= 0) { c.mesh.visible = false; continue; }
        // blast blooms outward for a beat, then the scorch slowly weather away
        const age = c.maxLife - c.life;
        const bloom = age < 0.22 ? 1.16 - 0.16 * (age / 0.22) : 1;
        c.mesh.scale.setScalar(c.s0 * bloom);
        const k = c.life / c.maxLife;
        c.mat.opacity = 0.95 * (k < 0.5 ? k / 0.5 : 1);
      }
    }
    this.updateGibs(rdt);

    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      if (w.life > 1000) {
        w.smokeT -= rdt;
        if (w.smokeT <= 0) {
          w.smokeT = 0.22;
          this.spawnSmoke(w.group.position.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 1.4, rand(-0.6, 0.6))), new THREE.Vector3(rand(-0.4, 0.4), rand(1.5, 2.6), rand(-0.4, 0.4)), rand(1.5, 2.5), rand(1.2, 2), 0.25);
        }
        continue;
      }
      w.life -= rdt;
      w.smokeT -= rdt;
      if (w.smokeT <= 0 && w.life > 6) {
        w.smokeT = 0.2;
        this.spawnSmoke(w.group.position.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 1.4, rand(-0.6, 0.6))), new THREE.Vector3(rand(-0.4, 0.4), rand(1.5, 2.6), rand(-0.4, 0.4)), rand(1.2, 2), rand(1, 1.8), 0.24);
      }
      if (w.life < 5) w.group.scale.multiplyScalar(Math.pow(0.75, rdt));
      if (w.life <= 0) {
        this.dyn.remove(w.group);
        this.scene.remove(w.group);
        this.wrecks.splice(i, 1);
      }
    }

    for (let i = this.ringPulses.length - 1; i >= 0; i--) {
      const r = this.ringPulses[i];
      r.life -= rdt;
      const s = 1 + (0.5 - r.life) * 9;
      r.mesh.scale.setScalar(Math.max(0.1, s));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = clamp(r.life * 2, 0, 0.9);
      if (r.life <= 0) {
        this.dyn.remove(r.mesh);
        this.ringPulses.splice(i, 1);
      }
    }

    this.chevT += rdt;
    const cp2 = 0.55 + Math.sin(this.chevT * 3.4) * 0.3;
    for (const c of this.chevrons) {
      (c.material as THREE.MeshBasicMaterial).opacity = cp2 * 0.45;
      c.position.y += Math.sin(this.chevT * 2 + c.position.x) * 0.003;
    }

    // HQ flag + bar
    const bar = this.hq.userData.bar as THREE.Group;
    bar.quaternion.copy(this.camera.quaternion);
    const pct = this.baseHp / BASE_MAX;
    this.hqBarFg.scale.x = Math.max(0.001, pct);
    this.hqBarFg.position.x = -2.7 * (1 - pct);
    this.hqBarFg.material = pct < 0.35 ? this.mats.barRed : this.mats.barAmber;
    if (this.hqFlag) this.hqFlag.rotation.y = Math.sin(this.chevT * 2.2) * 0.25;
  }

  private updateCamera(rdt: number) {
    const k = 1 - Math.exp(-6 * rdt);
    // pan
    let px = 0, pz = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) pz -= 1;
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) pz += 1;
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) px -= 1;
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) px += 1;
    const edge = 26;
    if (this.mousePx.x < edge) px -= 1;
    if (this.mousePx.x > window.innerWidth - edge) px += 1;
    if (this.mousePx.y < edge) pz -= 1;
    if (this.mousePx.y > window.innerHeight - edge) pz += 1;
    const panSp = this.camDist * 0.62 * rdt;
    this.camTarget.x = clamp(this.camTarget.x + px * panSp, -60, 60);
    this.camTarget.z = clamp(this.camTarget.z + pz * panSp, -44, 44);

    let distGoal = this.camDistGoal;
    let pitchGoal = this.camPitchGoal;
    let look = this.camTarget.clone();
    if (this.state === "menu") {
      const t = this.chevT * 0.06;
      look = new THREE.Vector3(Math.sin(t) * 14 - 4, 0, Math.cos(t) * 10 - 2);
      distGoal = 66;
      pitchGoal = 0.85;
    } else if (this.selected && !this.selected.dead) {
      look = this.selected.pos.clone();
      distGoal = Math.min(this.camDistGoal, 26);
      pitchGoal = 0.62;
    }
    this.camDist = lerp(this.camDist, distGoal, k);
    this.camPitch = lerp(this.camPitch, pitchGoal, k);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const pos = new THREE.Vector3(
      look.x + Math.sin(0) * cp * this.camDist,
      look.y + sp * this.camDist + 2,
      look.z + Math.cos(0) * cp * this.camDist,
    );
    // shake
    if (this.shake > 0.001) {
      this.shake *= Math.exp(-5 * rdt);
      pos.x += rand(-1, 1) * this.shake * 0.5;
      pos.y += rand(-1, 1) * this.shake * 0.4;
      pos.z += rand(-1, 1) * this.shake * 0.5;
    } else this.shake = 0;
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
  }

  private updateHover() {
    if (this.state === "menu") { this.hoverOk = false; return; }
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain, false);
    this.hoverOk = hits.length > 0;
    if (this.hoverOk) this.hoverPoint.copy(hits[0].point);
    if (this.ghost && this.buildKind) {
      const gx = Math.round(this.hoverPoint.x / 2) * 2;
      const gz = Math.round(this.hoverPoint.z / 2) * 2;
      this.ghost.position.set(gx, this.heightAt(gx, gz), gz);
      const ok = this.canPlaceAt(gx, gz, this.buildKind) && this.rp >= TOWER_DEFS[this.buildKind].cost;
      this.ghostValid = ok;
      const mat = ok ? this.ghostMatOk : this.ghostMatBad;
      this.ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = mat;
      });
      const def = TOWER_DEFS[this.buildKind];
      if (def.range > 0) {
        if (!this.ghost.userData.ring) {
          const ring = this.makeRangeRing(def.range);
          this.ghost.add(ring);
          this.ghost.userData.ring = ring;
          if (def.minRange > 0) {
            const dz = new THREE.Mesh(
              new THREE.RingGeometry(def.minRange - 0.35, def.minRange, 48),
              new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
            );
            dz.rotation.x = -Math.PI / 2;
            dz.position.y = 0.16;
            ring.add(dz);
          }
        }
        const ring = this.ghost.userData.ring as THREE.Group;
        ring.position.y = 0.15;
        (ring.children[0] as THREE.Mesh).material = ok ? ringOkMat : ringBadMat;
      }
    }
    if (this.artyMarker && this.hoverOk) {
      this.artyMarker.position.set(this.hoverPoint.x, this.heightAt(this.hoverPoint.x, this.hoverPoint.z) + 0.3, this.hoverPoint.z);
    }
    this.canvas.style.cursor = this.buildKind || this.abilityMode ? "crosshair" : "default";
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
  }
}

const ringOkMat = new THREE.MeshBasicMaterial({ color: 0xf2b23e, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
const ringBadMat = new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });

function angDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

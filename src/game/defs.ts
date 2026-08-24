// ── Steel & Tactics — data definitions ──────────────────────────────────────

export type TowerKind = "mg" | "at" | "flak" | "arty" | "flame" | "atrifle" | "airpost" | "observer" | "sapper" | "hedgehog" | "wire" | "mines";
export type EnemyKind = "infantry" | "bike" | "scout" | "halftrack" | "panzer" | "stug" | "panther" | "tiger" | "stuka" | "heinkel";

export interface UpgradeDef { name: string; desc: string; cost: number }

export interface TowerDef {
  kind: TowerKind;
  name: string;
  short: string;
  hotkey: string;
  cost: number;
  hp: number;
  range: number;
  rof: number; // shots per second
  dmg: number;
  pen: number; // armor penetration
  splash: number; // splash radius (0 = single target)
  splashDmg: number;
  projSpeed: number;
  lob: number; // ballistic arc factor (higher = steeper, slower flight)
  ammo: number;
  antiAir: boolean;
  structure: boolean;
  traverse: number; // rad/s
  minRange: number; // 0 = can engage at point-blank; else dead zone radius
  upgrades: UpgradeDef[];
}

export const TOWER_ORDER: TowerKind[] = ["mg", "at", "flak", "flame", "atrifle", "arty", "airpost", "observer", "sapper", "hedgehog", "wire", "mines"];

export const TOWER_DEFS: Record<TowerKind, TowerDef> = {
  mg: {
    kind: "mg", name: "M2 .50 CAL MG NEST", short: "MG NEST", hotkey: "1",
    cost: 120, hp: 130, range: 26, rof: 6.5, dmg: 4, pen: 6, splash: 0, splashDmg: 0,
    projSpeed: 95, lob: 0, ammo: 260, antiAir: false, structure: false, traverse: 4.2, minRange: 0,
    upgrades: [
      { name: "API ROUNDS", desc: "+60% damage, +4 pen", cost: 150 },
      { name: "SANDBAG REINFORCEMENT", desc: "+120 max HP, full repair", cost: 130 },
      { name: "SPOTTER TEAM", desc: "+30% range, +25% fire rate", cost: 210 },
    ],
  },
  at: {
    kind: "at", name: "PaK 40 75mm AT GUN", short: "PaK 40", hotkey: "2",
    cost: 300, hp: 170, range: 40, rof: 0.34, dmg: 58, pen: 85, splash: 0, splashDmg: 0,
    projSpeed: 125, lob: 5, ammo: 18, antiAir: false, structure: false, traverse: 1.5, minRange: 0,
    upgrades: [
      { name: "APCR AMMUNITION", desc: "+60% pen, +25% damage", cost: 260 },
      { name: "CONCRETE CASEMATE", desc: "+160 max HP, full repair", cost: 210 },
      { name: "ELITE CREW", desc: "+40% reload & traverse speed", cost: 270 },
    ],
  },
  flak: {
    kind: "flak", name: "8.8cm FLAK 36", short: "FLAK 88", hotkey: "3",
    cost: 420, hp: 190, range: 46, rof: 0.55, dmg: 42, pen: 68, splash: 4.5, splashDmg: 26,
    projSpeed: 105, lob: 9, ammo: 24, antiAir: true, structure: false, traverse: 2.2, minRange: 0,
    upgrades: [
      { name: "TIME-FUSE SHELLS", desc: "+70% splash damage & radius", cost: 260 },
      { name: "ZUGAPP TRAILER MOUNT", desc: "+30% traverse & fire rate", cost: 230 },
      { name: "RADAR FIRE CONTROL", desc: "+25% range, +20% damage, +25% fire rate", cost: 310 },
    ],
  },
  flame: {
    kind: "flame", name: "M2 FLAMETHROWER", short: "FLAME", hotkey: "4",
    cost: 210, hp: 160, range: 11, rof: 0, dmg: 38, pen: 9, splash: 0, splashDmg: 0,
    projSpeed: 0, lob: 0, ammo: 100, antiAir: false, structure: false, traverse: 2.8, minRange: 0,
    upgrades: [
      { name: "NAPALM MIXTURE", desc: "+60% burn damage, ignition lasts longer", cost: 190 },
      { name: "EXTENDED FUEL TANKS", desc: "+80 fuel capacity, full refill", cost: 150 },
      { name: "BLAST SHIELDING", desc: "+140 max HP, +25% cone reach", cost: 230 },
    ],
  },
  atrifle: {
    kind: "atrifle", name: "PzB 39 AT RIFLE TEAM", short: "AT RIFLE", hotkey: "5",
    cost: 130, hp: 90, range: 34, rof: 0.9, dmg: 16, pen: 34, splash: 0, splashDmg: 0,
    projSpeed: 105, lob: 0, ammo: 44, antiAir: false, structure: false, traverse: 1.8, minRange: 0,
    upgrades: [
      { name: "TUNGSTEN-CORED ROUNDS", desc: "+70% penetration, +25% damage", cost: 160 },
      { name: "TWO-MAN RELOAD DRILL", desc: "+45% fire rate", cost: 140 },
      { name: "DUG-IN PIT", desc: "+120 max HP, +20% range", cost: 180 },
    ],
  },
  arty: {
    kind: "arty", name: "M114 155mm HOWITZER", short: "HOWITZER", hotkey: "6",
    cost: 520, hp: 210, range: 74, rof: 0.2, dmg: 26, pen: 95, splash: 7, splashDmg: 90,
    projSpeed: 74, lob: 46, ammo: 14, antiAir: false, structure: false, traverse: 0.9, minRange: 22,
    upgrades: [
      { name: "IMPROVED HE SHELLS", desc: "+60% splash damage & radius", cost: 300 },
      { name: "REINFORCED EMPLACEMENT", desc: "+180 max HP, full repair", cost: 240 },
      { name: "FDC FIRE CONTROL", desc: "+25% range, +35% fire rate", cost: 330 },
    ],
  },
  airpost: {
    kind: "airpost", name: "P-47D CAS POST", short: "AIR POST", hotkey: "7",
    cost: 700, hp: 140, range: 62, rof: 0, dmg: 0, pen: 0, splash: 0, splashDmg: 0,
    projSpeed: 0, lob: 0, ammo: 6, antiAir: false, structure: false, traverse: 0, minRange: 0,
    upgrades: [
      { name: "ROCKET RAILS", desc: "Each pass fires 2 HE rockets at armor", cost: 380 },
      { name: "VETERAN PILOT", desc: "Sorties 45% more frequent", cost: 300 },
      { name: "SECTION OF TWO", desc: "A second Thunderbolt joins the post", cost: 520 },
    ],
  },
  observer: {
    kind: "observer", name: "FORWARD OBSERVER TEAM", short: "OBSERVER", hotkey: "8",
    cost: 180, hp: 110, range: 26, rof: 0, dmg: 0, pen: 0, splash: 0, splashDmg: 0,
    projSpeed: 0, lob: 0, ammo: 0, antiAir: false, structure: false, traverse: 0, minRange: 0,
    upgrades: [
      { name: "FIELD TELEPHONE NET", desc: "Marked targets take +35% damage (was +25%)", cost: 200 },
      { name: "COATED OPTICS", desc: "+40% spotting radius", cost: 170 },
      { name: "ARTILLERY LIAISON", desc: "+15% range to all guns near this team", cost: 260 },
    ],
  },
  sapper: {
    kind: "sapper", name: "SAPPER REPAIR POST", short: "SAPPER", hotkey: "9",
    cost: 160, hp: 130, range: 16, rof: 0, dmg: 0, pen: 0, splash: 0, splashDmg: 0,
    projSpeed: 0, lob: 0, ammo: 0, antiAir: false, structure: false, traverse: 0, minRange: 0,
    upgrades: [
      { name: "POWER TOOLS", desc: "Repairs 60% faster", cost: 170 },
      { name: "SPARE PARTS DEPOT", desc: "+150 max HP, full repair", cost: 150 },
      { name: "FIELD WORKSHOP", desc: "+50% repair radius", cost: 210 },
    ],
  },
  hedgehog: {
    kind: "hedgehog", name: "CZECH HEDGEHOGS", short: "HEDGEHOG", hotkey: "0",
    cost: 40, hp: 90, range: 3.2, rof: 0, dmg: 0, pen: 0, splash: 0, splashDmg: 0,
    projSpeed: 0, lob: 0, ammo: 0, antiAir: false, structure: true, traverse: 0, minRange: 0,
    upgrades: [],
  },
  wire: {
    kind: "wire", name: "BARBED WIRE", short: "WIRE", hotkey: "-",
    cost: 30, hp: 45, range: 3.6, rof: 0, dmg: 0, pen: 0, splash: 0, splashDmg: 0,
    projSpeed: 0, lob: 0, ammo: 0, antiAir: false, structure: true, traverse: 0, minRange: 0,
    upgrades: [],
  },
  mines: {
    kind: "mines", name: "AT MINEFIELD", short: "MINES", hotkey: "=",
    cost: 90, hp: 30, range: 4.6, rof: 0, dmg: 75, pen: 999, splash: 4.6, splashDmg: 75,
    projSpeed: 0, lob: 0, ammo: 3, antiAir: false, structure: true, traverse: 0, minRange: 0,
    upgrades: [],
  },
};

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  armorF: number;
  armorS: number;
  armorR: number;
  reward: number;
  baseDmg: number;
  radius: number;
  flying: boolean;
  scale: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  infantry: { kind: "infantry", name: "Infantry Squad", hp: 34, speed: 5.6, armorF: 0, armorS: 0, armorR: 0, reward: 12, baseDmg: 1, radius: 1.0, flying: false, scale: 1 },
  scout: { kind: "scout", name: "Scout Car", hp: 95, speed: 8.2, armorF: 16, armorS: 8, armorR: 6, reward: 26, baseDmg: 2, radius: 1.4, flying: false, scale: 1 },
  halftrack: { kind: "halftrack", name: "Sd.Kfz Half-track", hp: 170, speed: 6.0, armorF: 26, armorS: 13, armorR: 9, reward: 38, baseDmg: 2, radius: 1.6, flying: false, scale: 1 },
  panzer: { kind: "panzer", name: "Panzer IV", hp: 330, speed: 4.3, armorF: 55, armorS: 30, armorR: 18, reward: 62, baseDmg: 3, radius: 1.9, flying: false, scale: 1 },
  panther: { kind: "panther", name: "Panther Ausf. G", hp: 560, speed: 3.9, armorF: 92, armorS: 46, armorR: 26, reward: 95, baseDmg: 4, radius: 2.1, flying: false, scale: 1.12 },
  tiger: { kind: "tiger", name: "Tiger I Ausf. E", hp: 860, speed: 3.1, armorF: 128, armorS: 70, armorR: 52, reward: 150, baseDmg: 6, radius: 2.4, flying: false, scale: 1.22 },
  stug: { kind: "stug", name: "StuG III Ausf. G", hp: 260, speed: 5.2, armorF: 96, armorS: 34, armorR: 22, reward: 46, baseDmg: 3, radius: 1.7, flying: false, scale: 1 },
  bike: { kind: "bike", name: "Dispatch Rider", hp: 26, speed: 13.0, armorF: 0, armorS: 0, armorR: 0, reward: 10, baseDmg: 1, radius: 0.8, flying: false, scale: 1 },
  stuka: { kind: "stuka", name: "Ju 87 Stuka", hp: 85, speed: 13.5, armorF: 4, armorS: 4, armorR: 4, reward: 70, baseDmg: 0, radius: 1.6, flying: true, scale: 1 },
  heinkel: { kind: "heinkel", name: "He 111 Bomber", hp: 230, speed: 16.0, armorF: 4, armorS: 4, armorR: 4, reward: 110, baseDmg: 0, radius: 2.8, flying: true, scale: 1 },
};

export interface WaveEntry { kind: EnemyKind; count: number; gap: number; delay: number }
export interface WaveDef { label: string; intel: string; entries: WaveEntry[] }

export const WAVES: WaveDef[] = [
  {
    label: "RECON PATROLS", intel: "Light infantry probing the line.",
    entries: [{ kind: "infantry", count: 8, gap: 2.4, delay: 0 }],
  },
  {
    label: "SCOUT SCREEN", intel: "Infantry screen with armored cars.",
    entries: [
      { kind: "infantry", count: 10, gap: 2.0, delay: 0 },
      { kind: "scout", count: 2, gap: 6, delay: 6 },
    ],
  },
  {
    label: "MECHANIZED PROBE", intel: "Half-tracks pushing the road.",
    entries: [
      { kind: "infantry", count: 8, gap: 2.0, delay: 0 },
      { kind: "scout", count: 3, gap: 5, delay: 4 },
      { kind: "halftrack", count: 2, gap: 7, delay: 12 },
    ],
  },
  {
    label: "FIRST ARMOR", intel: "A Panzer IV leads the column.",
    entries: [
      { kind: "infantry", count: 10, gap: 1.8, delay: 0 },
      { kind: "panzer", count: 1, gap: 1, delay: 8 },
      { kind: "halftrack", count: 3, gap: 6, delay: 14 },
    ],
  },
  {
    label: "PANZER SPEARHEAD", intel: "Armor column with Stuka cover. Watch the sky.",
    entries: [
      { kind: "panzer", count: 3, gap: 8, delay: 0 },
      { kind: "halftrack", count: 3, gap: 6, delay: 10 },
      { kind: "infantry", count: 8, gap: 1.6, delay: 4 },
      { kind: "stuka", count: 1, gap: 1, delay: 18 },
    ],
  },
  {
    label: "INFANTRY SWARM", intel: "Massed grenadiers. Wire and Flak will hold.",
    entries: [
      { kind: "infantry", count: 18, gap: 1.1, delay: 0 },
      { kind: "scout", count: 4, gap: 5, delay: 10 },
    ],
  },
  {
    label: "COMBINED ASSAULT", intel: "Panzers, carriers and two Stukas.",
    entries: [
      { kind: "panzer", count: 4, gap: 7, delay: 0 },
      { kind: "halftrack", count: 4, gap: 5.5, delay: 8 },
      { kind: "stuka", count: 2, gap: 9, delay: 16 },
      { kind: "infantry", count: 8, gap: 1.5, delay: 2 },
    ],
  },
  {
    label: "PANTHER BREAKOUT", intel: "Heavy armor detected. Flank shots only.",
    entries: [
      { kind: "panther", count: 2, gap: 12, delay: 0 },
      { kind: "panzer", count: 3, gap: 7, delay: 10 },
      { kind: "infantry", count: 12, gap: 1.4, delay: 4 },
    ],
  },
  {
    label: "AIR ARMADA", intel: "Stuka wing overhead. Flak radar advised.",
    entries: [
      { kind: "stuka", count: 3, gap: 8, delay: 0 },
      { kind: "halftrack", count: 6, gap: 4.5, delay: 6 },
      { kind: "panzer", count: 3, gap: 7, delay: 14 },
    ],
  },
  {
    label: "TANK HUNTERS", intel: "StuG assault guns — thick frontal plates. Flank them.",
    entries: [
      { kind: "stug", count: 3, gap: 9, delay: 0 },
      { kind: "bike", count: 6, gap: 1.6, delay: 4 },
      { kind: "infantry", count: 12, gap: 1.3, delay: 8 },
      { kind: "halftrack", count: 3, gap: 6, delay: 16 },
    ],
  },
  {
    label: "HEAVY BREAKOUT", intel: "Panthers with escort riders. Watch for Tigers.",
    entries: [
      { kind: "panther", count: 3, gap: 11, delay: 0 },
      { kind: "stug", count: 2, gap: 8, delay: 10 },
      { kind: "bike", count: 8, gap: 1.4, delay: 2 },
      { kind: "heinkel", count: 1, gap: 1, delay: 20 },
    ],
  },
  {
    label: "FINAL ASSAULT", intel: "A Tiger leads everything they have left. Hold the line.",
    entries: [
      { kind: "tiger", count: 1, gap: 1, delay: 0 },
      { kind: "panther", count: 3, gap: 10, delay: 10 },
      { kind: "panzer", count: 4, gap: 6, delay: 18 },
      { kind: "infantry", count: 16, gap: 1.1, delay: 6 },
      { kind: "stuka", count: 2, gap: 10, delay: 26 },
    ],
  },
];

// procedural endless-wave labels (cycle forever past the scripted waves)
export const ENDLESS_LABELS = ["ENDLESS ASSAULT", "NO QUARTER", "IRON RAIN", "STEEL TIDE", "THE LONG NIGHT", "TOTAL WAR"];

export const SELL_RATIO = 0.6;
export const CP_MAX = 5;
export const ARTY_COST = 3;
export const BASE_MAX = 20;

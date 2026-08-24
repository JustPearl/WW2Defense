import { useEffect, useRef, useState } from "react";
import {
  Engine, HudData, SelData, Stats, Screen, UiMsg,
} from "./game/engine";
import {
  TOWER_DEFS, TOWER_ORDER, WAVES, TowerKind, CP_MAX, ARTY_COST,
} from "./game/defs";

// ── ui state ────────────────────────────────────────────────────────────────
interface UiState {
  hud: HudData;
  sel: SelData | null;
  build: TowerKind | null;
  ability: string | null;
  screen: Screen;
  stats: Stats;
  banner: { text: string; sub: string; tone: string; key: number } | null;
  flashKey: number;
  dmgKey: number;
  toasts: { id: number; text: string }[];
}

const defaultHud: HudData = {
  rp: 400, cp: 2, baseHp: 20, baseMax: 20, wave: 0, waveTotal: WAVES.length,
  hostiles: 0, kills: 0, score: 0, time: 0, speed: 1, between: true, nextIn: 12, muted: false,
};

const initUi: UiState = {
  hud: defaultHud, sel: null, build: null, ability: null, screen: "menu",
  stats: { kills: 0, score: 0, wave: 0, time: 0 },
  banner: null, flashKey: 0, dmgKey: 0, toasts: [],
};

let toastId = 1;

function reduceUi(prev: UiState, m: UiMsg): UiState {
  switch (m.t) {
    case "hud":
      return { ...prev, hud: m.hud, sel: m.sel, build: m.build, ability: m.ability };
    case "screen":
      return { ...prev, screen: m.screen, stats: m.stats };
    case "banner":
      return { ...prev, banner: { text: m.text, sub: m.sub, tone: m.tone, key: prev.banner ? prev.banner.key + 1 : 1 } };
    case "flash":
      return { ...prev, flashKey: prev.flashKey + 1 };
    case "dmg":
      return { ...prev, dmgKey: prev.dmgKey + 1 };
    case "toast":
      return { ...prev, toasts: [...prev.toasts.slice(-3), { id: toastId++, text: m.text }] };
  }
}

// ── icons ───────────────────────────────────────────────────────────────────
function Icon({ children, size = 22 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const ICONS: Record<string, React.ReactNode> = {
  mg: (<Icon><path d="M1 13h11l2-2h9v3h-5l-2 4h-4l2-4H1z" /><path d="M6 17l-3 4M13 17l3 4M16 8l4-4" /></Icon>),
  at: (<Icon><path d="M2 18l7-3 11-8" /><path d="M9 15V9l4-1v6" /><circle cx="7" cy="19" r="2" /><circle cx="15" cy="17" r="2" /><path d="M2 21h20" /></Icon>),
  flak: (<Icon><path d="M12 21v-9" /><path d="M12 12L19 3" /><path d="M5 21h14" /><path d="M9 21l3-6 3 6" /><path d="M17 6l3 2" /></Icon>),
  hedgehog: (<Icon><path d="M4 20L20 4M4 4l16 16M12 2v20" /></Icon>),
  wire: (<Icon><circle cx="5.5" cy="14" r="2.6" /><circle cx="12" cy="12" r="2.6" /><circle cx="18.5" cy="14" r="2.6" /><path d="M2 20h20" /></Icon>),
  mines: (<Icon><circle cx="12" cy="14" r="5" /><path d="M12 5v4M5 9.5l3.4 1.8M19 9.5l-3.4 1.8" /><path d="M4 21h16" /></Icon>),
  arty: (<Icon><path d="M3 20c6-1 11-6 13-14" /><path d="M14.5 4.5L19 3l-1.5 4.5" /><path d="M2 21h20" /></Icon>),
  airpost: (<Icon><path d="M12 2l2 8 8 3-8 1.5L12 22l-2-7.5L2 13l8-3z" /></Icon>),
  truck: (<Icon><path d="M1 16V7h11v9" /><path d="M12 10h6l3 3v3h-3" /><circle cx="6" cy="17" r="1.8" /><circle cx="16.5" cy="17" r="1.8" /><path d="M8 16h6" /></Icon>),
  pause: (<Icon><path d="M9 5v14M15 5v14" /></Icon>),
  play: (<Icon><path d="M7 4l13 8-13 8z" /></Icon>),
  sound: (<Icon><path d="M4 10v4h4l6 5V5l-6 5H4z" /><path d="M17 9c1.5 1.5 1.5 4.5 0 6" /></Icon>),
  bolt: (<Icon><path d="M13 3L5 14h6l-1 7 8-11h-6z" /></Icon>),
  cross: (<Icon><path d="M5 5l14 14M19 5L5 19" /></Icon>),
};

// ── small components ────────────────────────────────────────────────────────
function fmtTime(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Bar({ pct, cls }: { pct: number; cls?: string }) {
  return <div className={`bar ${cls ?? ""}`}><i style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%` }} /></div>;
}

function CpPips({ cp }: { cp: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: CP_MAX }).map((_, i) => (
        <span key={i} className="inline-block h-2.5 w-2.5 rotate-45 border"
          style={{
            borderColor: i < cp ? "#f2b23e" : "#4a5433",
            background: i < cp ? "#f2b23e" : "transparent",
            boxShadow: i < cp ? "0 0 6px rgba(242,178,62,.7)" : "none",
          }} />
      ))}
    </div>
  );
}

function ControlsGuide({ compact = false }: { compact?: boolean }) {
  const rows: [string, string][] = [
    ["WASD / EDGES", "Pan camera"],
    ["WHEEL", "Zoom"],
    ["LEFT CLICK", "Place / Select / Manual fire"],
    ["RIGHT CLICK / ESC", "Cancel / Deselect"],
    ["SPACE", "Tactical pause (orders still work)"],
    ["1–7", "Arm emplacement blueprint"],
    ["U / T", "Upgrade / Targeting"],
    ["B", "Artillery strike mode"],
    ["F / M", "Game speed / Mute"],
  ];
  return (
    <div className={`grid gap-x-6 gap-y-1 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-2 text-[11px]">
          <span className="font-bold text-[var(--amber)] whitespace-nowrap">{k}</span>
          <span className="text-[var(--dim)]">{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engRef = useRef<Engine | null>(null);
  const [ui, setUi] = useState<UiState>(initUi);
  const [shake, setShake] = useState(0.7);

  useEffect(() => {
    if (!canvasRef.current) return;
    const eng = new Engine(canvasRef.current, (m) => setUi((p) => reduceUi(p, m)));
    engRef.current = eng;
    return () => { eng.dispose(); engRef.current = null; };
  }, []);

  useEffect(() => {
    engRef.current?.setShakeScale(shake);
  }, [shake]);

  useEffect(() => {
    if (!ui.toasts.length) return;
    const t = setTimeout(() => setUi((p) => ({ ...p, toasts: p.toasts.slice(1) })), 2300);
    return () => clearTimeout(t);
  }, [ui.toasts]);

  const eng = () => engRef.current;
  const { hud, sel } = ui;
  const inGame = ui.screen === "playing" || ui.screen === "paused";
  const nextWave = ui.screen === "menu" ? null : eng()?.nextWaveInfo() ?? (hud.wave < WAVES.length ? WAVES[hud.wave] : null);
  const cursorArmed = ui.build !== null || ui.ability !== null;

  return (
    <div className={`relative h-full w-full select-none overflow-hidden ${cursorArmed ? "cursor-build" : ""}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* fx overlays */}
      <div className="scanlines pointer-events-none absolute inset-0 z-20" />
      <div className="vignette pointer-events-none absolute inset-0 z-20" />
      {ui.flashKey > 0 && <div key={`f${ui.flashKey}`} className="boom-flash pointer-events-none absolute inset-0 z-30" />}
      {ui.dmgKey > 0 && <div key={`d${ui.dmgKey}`} className="dmg-flash pointer-events-none absolute inset-0 z-30" />}

      {/* ── HUD ── */}
      {inGame && (
        <>
          {/* top-left resources */}
          <div className="panel absolute left-3 top-3 z-40 flex items-center gap-5 px-4 py-2.5">
            <div>
              <div className="text-[9px] tracking-[0.2em] text-[var(--dim)]">REQUISITION</div>
              <div className="hud-num font-display text-xl leading-none text-[var(--amber-hi)]">
                {hud.rp}<span className="ml-1 text-[10px] text-[var(--amber)]">RP</span>
              </div>
            </div>
            <div className="h-8 w-px bg-[var(--line)]" />
            <div>
              <div className="text-[9px] tracking-[0.2em] text-[var(--dim)]">COMMAND</div>
              <div className="mt-1.5"><CpPips cp={hud.cp} /></div>
            </div>
            <div className="h-8 w-px bg-[var(--line)]" />
            <div className="w-40">
              <div className="flex justify-between text-[9px] tracking-[0.2em] text-[var(--dim)]">
                <span>HQ INTEGRITY</span>
                <span className="hud-num text-[var(--paper)]">{hud.baseHp}/{hud.baseMax}</span>
              </div>
              <div className="mt-1"><Bar pct={hud.baseHp / hud.baseMax} cls={hud.baseHp / hud.baseMax < 0.35 ? "red" : ""} /></div>
            </div>
          </div>

          {/* top-center wave status */}
          <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2">
            {hud.between && nextWave ? (
              <div className="panel-flat pointer-events-auto px-5 py-2 text-center">
                <div className="text-[10px] tracking-[0.25em] text-[var(--dim)]">
                  INTEL — WAVE {hud.wave + 1}: <span className="text-[var(--amber)]">{nextWave.label}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-center gap-3">
                  <span className="hud-num font-display text-2xl text-[var(--paper)]">T-{hud.nextIn}</span>
                  <button className="btn px-3 py-1 text-[10px]" onClick={() => eng()?.callEarly()}>
                    DEPLOY NOW +40 RP
                  </button>
                </div>
                <div className="text-[10px] text-[var(--dim)]">{nextWave.intel}</div>
              </div>
            ) : (
              <div className="panel-flat px-5 py-2 text-center">
                <div className="text-[10px] tracking-[0.25em] text-[var(--dim)]">
                  WAVE <span className="text-[var(--amber)]">{Math.max(1, hud.wave)}</span> <span className="text-[var(--dim)]">/ ∞</span>
                </div>
                <div className="font-display text-xl leading-tight text-[var(--red-hi)]">
                  HOSTILES REMAINING: <span className="hud-num">{hud.hostiles}</span>
                </div>
              </div>
            )}
          </div>

          {/* top-right controls */}
          <div className="absolute right-3 top-3 z-40 flex items-center gap-2">
            <div className="panel-flat hud-num px-3 py-2 text-[11px] text-[var(--dim)]">
              <span className="text-[var(--paper)]">{fmtTime(hud.time)}</span>
              <span className="mx-2 text-[var(--line-hi)]">|</span>
              SCORE <span className="text-[var(--amber-hi)]">{hud.score}</span>
              <span className="mx-2 text-[var(--line-hi)]">|</span>
              KILLS <span className="text-[var(--paper)]">{hud.kills}</span>
            </div>
            <button className="btn px-3 py-2" title="Speed [F]" onClick={() => eng()?.toggleSpeed()}>
              {hud.speed}×
            </button>
            <button className="btn px-3 py-2" title="Mute [M]" onClick={() => eng()?.toggleMute()}>
              {ICONS.sound}
            </button>
            <button className="btn px-3 py-2" title="Tactical pause [SPACE]" onClick={() => eng()?.togglePause()}>
              {ui.screen === "paused" ? ICONS.play : ICONS.pause}
            </button>
          </div>

          {/* selection panel */}
          {sel && (
            <div className="panel absolute right-3 top-1/2 z-40 w-60 -translate-y-1/2 p-3">
              <div className="flex items-start justify-between">
                <div className="stencil-head text-[13px] leading-tight">{sel.name}</div>
                <button className="text-[var(--dim)] hover:text-[var(--red-hi)]" onClick={() => eng()?.deselect()}>
                  {ICONS.cross}
                </button>
              </div>
              <div className="mt-1 flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1 w-6" style={{ background: i < sel.tier ? "var(--amber)" : "#333c22" }} />
                ))}
              </div>
              <div className="mt-2 space-y-2 text-[11px]">
                <div>
                  <div className="flex justify-between text-[var(--dim)]"><span>STRUCTURE</span><span className="hud-num text-[var(--paper)]">{sel.hp}/{sel.maxHp}</span></div>
                  <Bar pct={sel.hp / sel.maxHp} cls={sel.hp / sel.maxHp < 0.35 ? "red" : ""} />
                </div>
                {!sel.structure && sel.maxAmmo > 0 && (
                  <div>
                    <div className="flex justify-between text-[var(--dim)]">
                      <span>{sel.kind === "airpost" ? "SORTIES" : "AMMUNITION"}</span>
                      <span className={`hud-num ${sel.ammo === 0 ? "pulse-warn" : "text-[var(--paper)]"}`}>{sel.ammo}/{sel.maxAmmo}</span>
                    </div>
                    <Bar pct={sel.ammo / sel.maxAmmo} cls="amber" />
                    {sel.ammo / sel.maxAmmo < 0.32 && !sel.carrier && (
                      <div className="mt-0.5 text-[9px] tracking-widest text-[var(--dim)]">
                        {sel.kind === "airpost" ? "REFUEL TRUCK QUEUED AT HQ…" : "CARRIER QUEUED AT HQ…"}
                      </div>
                    )}
                    {sel.carrier && (
                      <div className="mt-0.5 flex items-center gap-1 text-[9px] font-bold tracking-widest text-[var(--olive)]">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse bg-[var(--olive)]" />
                        {sel.kind === "airpost" ? "REFUEL TRUCK EN ROUTE" : "AMMUNITION CARRIER EN ROUTE"}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[var(--dim)]">
                  <span>RANGE</span><span className="hud-num text-right text-[var(--paper)]">{sel.range} m</span>
                  {sel.kind === "airpost" ? (
                    <>
                      <span>MODE</span><span className="hud-num text-right text-[var(--olive)]">AUTONOMOUS</span>
                    </>
                  ) : sel.minRange > 0 ? (
                    <>
                      <span className="text-[var(--red-hi)]">DEAD ZONE</span>
                      <span className="hud-num text-right text-[var(--red-hi)]">&lt; {sel.minRange} m</span>
                    </>
                  ) : (
                    <>
                      <span>TARGETING</span><span className="hud-num text-right text-[var(--amber)]">{sel.targetMode}</span>
                    </>
                  )}
                </div>
                {sel.kind === "airpost" ? (
                  <div className="-mt-0.5 text-[9px] tracking-wider text-[var(--dim)]">
                    THUNDERBOLT LOITERS OVERHEAD &amp; STRAFES ENEMY GROUPS
                  </div>
                ) : sel.minRange > 0 ? (
                  <div className="-mt-0.5 text-[9px] tracking-wider text-[var(--dim)]">
                    LONG-RANGE PIECE — WILL NOT ENGAGE INSIDE {sel.minRange} m
                  </div>
                ) : null}
              </div>
              <div className="mt-3 space-y-1.5">
                {sel.upgradeName && (
                  <button className="btn w-full py-1.5 text-[10px]" onClick={() => eng()?.upgradeSelected()}>
                    {sel.upgradeName} — {sel.upgradeCost} RP [U]
                  </button>
                )}
                {sel.upgradeName && <div className="-mt-1 px-1 text-[9px] text-[var(--dim)]">{sel.upgradeDesc}</div>}
                {!sel.upgradeName && !sel.structure && <div className="text-center text-[10px] tracking-widest text-[var(--olive)]">FULLY UPGRADED</div>}
                {!sel.structure && sel.kind !== "airpost" && (
                  <>
                    <button className="btn w-full py-1.5 text-[10px]" onClick={() => eng()?.cycleTargetMode()}>
                      TARGETING: {sel.targetMode} [T]
                    </button>
                    <div className="text-center text-[9px] text-[var(--dim)]">CLICK MAP TO FIRE MANUALLY (+35% DMG)</div>
                  </>
                )}
                <button className="btn btn-danger w-full py-1.5 text-[10px]" onClick={() => eng()?.sellSelected()}>
                  SALVAGE +{sel.sellValue} RP
                </button>
              </div>
            </div>
          )}

          {/* bottom dock */}
          <div className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-end gap-2">
            {TOWER_ORDER.map((k) => {
              const d = TOWER_DEFS[k];
              const armed = ui.build === k;
              const broke = hud.rp < d.cost;
              return (
                <div key={k}
                  className={`card ${armed ? "armed" : ""} ${broke && !armed ? "broke" : ""}`}
                  onClick={() => eng()?.selectBuild(armed ? null : k)}
                  title={d.name}>
                  <span className="key">{d.hotkey}</span>
                  <div className={`mx-auto ${armed ? "text-[var(--amber-hi)]" : "text-[var(--line-hi)]"}`}>{ICONS[k]}</div>
                  <div className="mt-1 text-[9px] font-bold tracking-wider text-[var(--paper)]">{d.short}</div>
                  <div className={`hud-num text-[10px] font-bold ${broke ? "text-[var(--red-hi)]" : "text-[var(--amber)]"}`}>{d.cost}</div>
                  <div className={`text-[7px] font-bold tracking-widest ${d.structure ? "text-[var(--olive)]" : "text-[var(--dim)]"}`}>
                    {d.structure ? "LAY ON ROAD" : "OFF-ROAD"}
                  </div>
                </div>
              );
            })}
            <div className="mx-1 h-14 w-px bg-[var(--line)]" />
            <div className={`card ${ui.ability === "artillery" ? "armed" : ""} ${hud.cp < ARTY_COST ? "broke" : ""}`}
              onClick={() => eng()?.startAbility(ui.ability === "artillery" ? null : "artillery")}
              title="Artillery barrage">
              <span className="key">B</span>
              <div className={`mx-auto ${ui.ability === "artillery" ? "text-[var(--amber-hi)]" : "text-[var(--red-hi)]"}`}>{ICONS.arty}</div>
              <div className="mt-1 text-[9px] font-bold tracking-wider text-[var(--paper)]">ARTILLERY</div>
              <div className="hud-num text-[10px] font-bold text-[var(--amber)]">{ARTY_COST} CP</div>
            </div>
          </div>

          {/* controls hint */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-40 hidden lg:block">
            <div className="panel-flat px-3 py-2">
              <ControlsGuide compact />
            </div>
          </div>
        </>
      )}

      {/* banner */}
      {ui.banner && inGame && (
        <div key={ui.banner.key} className="pointer-events-none absolute left-1/2 top-[22%] z-50 -translate-x-1/2 text-center">
          <div className="banner-anim">
            <div className="font-display text-4xl tracking-[0.12em]"
              style={{
                color: ui.banner.tone === "warn" ? "var(--red-hi)" : ui.banner.tone === "good" ? "var(--olive)" : "var(--amber-hi)",
                textShadow: "0 0 30px rgba(0,0,0,.8), 0 3px 0 rgba(0,0,0,.9)",
              }}>
              {ui.banner.text}
            </div>
            {ui.banner.sub && (
              <div className="mx-auto mt-1 w-fit bg-black/60 px-4 py-1 text-[11px] tracking-[0.2em] text-[var(--paper)]">
                {ui.banner.sub}
              </div>
            )}
          </div>
        </div>
      )}

      {/* toasts */}
      <div className="pointer-events-none absolute bottom-24 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1">
        {ui.toasts.map((t) => (
          <div key={t.id} className="toast-anim bg-black/75 px-4 py-1 text-[11px] font-bold tracking-[0.18em] text-[var(--amber-hi)]">
            {t.text}
          </div>
        ))}
      </div>

      {/* ── SCREENS ── */}
      {ui.screen === "menu" && (
        <div className="absolute inset-0 z-50 overflow-y-auto" style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(20,25,12,.88), rgba(8,10,5,.94))" }}>
          <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-8 px-8 py-10 lg:flex-row lg:items-center">
            <div className="flex-1">
              <div className="text-[11px] font-bold tracking-[0.5em] text-[var(--red-hi)]">OPERATION OVERLORD — SECTOR 7</div>
              <h1 className="title-glow font-display mt-3 text-6xl leading-[0.95] text-[var(--amber)] lg:text-7xl">
                STEEL<br />&amp; TACTICS
              </h1>
              <div className="mt-2 text-sm font-bold tracking-[0.3em] text-[var(--paper)]">WW2 DEFENSIVE OPERATIONS</div>
              <div className="mt-5 max-w-xl border-l-2 border-[var(--line-hi)] pl-4 text-[12px] leading-relaxed text-[var(--dim)]">
                Commander — armored columns are massing on the western road. Requisition emplacements,
                wire the approaches, and hold the HQ against <span className="text-[var(--amber)]">endless assault waves</span>.
                Every shell is a physical object: flank armor to penetrate, and let the ammunition
                carriers keep your guns fed.
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-4">
                <button className="btn btn-big" onClick={() => eng()?.startGame()}>
                  COMMENCE OPERATIONS
                </button>
                <div className="flex items-center gap-3 text-[11px] text-[var(--dim)]">
                  <span className="tracking-widest">SCREEN SHAKE</span>
                  <input type="range" min={0} max={1.4} step={0.05} value={shake}
                    onChange={(e) => setShake(parseFloat(e.target.value))}
                    className="w-28 accent-[var(--amber)]" />
                </div>
              </div>
              <div className="mt-2 text-[10px] tracking-[0.25em] text-[var(--dim)]">PRESS [ENTER] TO DEPLOY</div>
            </div>
            <div className="w-full max-w-md space-y-4">
              <div className="panel p-4">
                <div className="stencil-head mb-2 text-[12px]">FIELD MANUAL — CONTROLS</div>
                <ControlsGuide />
              </div>
              <div className="panel p-4">
                <div className="stencil-head mb-2 text-[12px]">REQUISITION CATALOG</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {TOWER_ORDER.map((k) => (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="text-[var(--line-hi)]">{ICONS[k]}</span>
                      <span className="flex-1 text-[var(--paper)]">{TOWER_DEFS[k].short}</span>
                      <span className="hud-num text-[var(--amber)]">{TOWER_DEFS[k].cost}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel p-4">
                <div className="stencil-head mb-2 text-[12px]">ENEMY INTEL</div>
                <div className="space-y-1 text-[11px] text-[var(--dim)]">
                  <div><span className="text-[var(--paper)]">INFANTRY</span> — advance in rushes. Shredded by MG fire and wire.</div>
                  <div><span className="text-[var(--paper)]">BIKES</span> — fast dispatch riders. Catch them before they close.</div>
                  <div><span className="text-[var(--paper)]">PANZERS &amp; STUGS</span> — thick frontal plates. Hit the flanks.</div>
                  <div><span className="text-[var(--paper)]">TIGERS</span> — near-immune frontally. Bring the 88 or the howitzer.</div>
                  <div><span className="text-[var(--paper)]">STUKAS &amp; BOMBERS</span> — only the Flak 88 reaches them. Set AIR priority.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {ui.screen === "paused" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel w-[520px] max-w-[92vw] p-6 text-center">
            <div className="font-display text-4xl tracking-[0.1em] text-[var(--amber)]">TACTICAL PAUSE</div>
            <div className="mt-1 text-[11px] tracking-[0.3em] text-[var(--dim)]">OPERATIONS FROZEN — ORDERS STILL ACCEPTED</div>
            <div className="mx-auto mt-5 grid max-w-sm gap-x-6 gap-y-1 text-left">
              <ControlsGuide />
            </div>
            <div className="mt-5 flex items-center justify-center gap-3 text-[11px] text-[var(--dim)]">
              <span className="tracking-widest">SCREEN SHAKE</span>
              <input type="range" min={0} max={1.4} step={0.05} value={shake}
                onChange={(e) => setShake(parseFloat(e.target.value))}
                className="w-32 accent-[var(--amber)]" />
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button className="btn" onClick={() => eng()?.togglePause()}>{ICONS.play} RESUME</button>
              <button className="btn" onClick={() => eng()?.startGame()}>RESTART</button>
              <button className="btn btn-danger" onClick={() => eng()?.backToMenu()}>ABANDON</button>
            </div>
          </div>
        </div>
      )}

      {(ui.screen === "over" || ui.screen === "won") && (
        <div className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: ui.screen === "over" ? "radial-gradient(ellipse, rgba(40,8,6,.88), rgba(6,3,2,.95))" : "radial-gradient(ellipse, rgba(26,32,12,.88), rgba(6,8,3,.95))" }}>
          <div className="text-center">
            <div className="text-[11px] font-bold tracking-[0.5em] text-[var(--dim)]">
              {ui.screen === "over" ? "DEFENSIVE LINE COLLAPSED" : "ALL WAVES REPELLED"}
            </div>
            <div className="font-display mt-2 text-7xl tracking-[0.06em]"
              style={{ color: ui.screen === "over" ? "var(--red-hi)" : "var(--amber-hi)", textShadow: "0 0 40px rgba(0,0,0,.8)" }}>
              {ui.screen === "over" ? "LINE OVERRUN" : "SECTOR SECURED"}
            </div>
            <div className="mx-auto mt-6 grid w-fit grid-cols-4 gap-6">
              {[
                ["WAVES", `${ui.stats.wave}/${WAVES.length}`],
                ["KILLS", `${ui.stats.kills}`],
                ["SCORE", `${ui.stats.score}`],
                ["TIME", fmtTime(ui.stats.time)],
              ].map(([k, v]) => (
                <div key={k} className="panel-flat px-5 py-3">
                  <div className="text-[9px] tracking-[0.3em] text-[var(--dim)]">{k}</div>
                  <div className="hud-num font-display text-2xl text-[var(--amber-hi)]">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex justify-center gap-3">
              <button className="btn btn-big" onClick={() => eng()?.startGame()}>
                {ui.screen === "over" ? "COUNTERATTACK" : "NEXT THEATRE"}
              </button>
              <button className="btn" onClick={() => eng()?.backToMenu()}>COMMAND MENU</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

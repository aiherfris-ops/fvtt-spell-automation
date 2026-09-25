import { LOG, MODULE_ID } from "../../core/constants.js";
import { wait } from "../../core/utils.js";

/*
 * Общие части инструментов «Круг телепортации»: анимации JB2A и звуки PSFX,
 * круг вызова (появление → свечение → затухание), вспышка на токене, клик по сцене, макросы ГМа.
 */

const JB2A = "modules/JB2A_DnD5e/Library";
const PSFX = "modules/psfx/library";

export const FILES = {
  intro: `${JB2A}/Generic/Magic_Signs/ConjurationCircleIntro_02_Regular_Yellow_800x800.webm`,
  loop: `${JB2A}/Generic/Magic_Signs/ConjurationCircleLoop_02_Regular_Yellow_800x800.webm`,
  outro: `${JB2A}/Generic/Magic_Signs/ConjurationCircleOutro_02_Regular_Yellow_800x800.webm`,
  flash: `${JB2A}/2nd_Level/Misty_Step/MistyStep_01_Regular_Blue_400x400.webm`,
  icon: `${JB2A}/Generic/Magic_Signs/ConjurationCircleIntro_02_Regular_Yellow_Thumb.webp`,
};

// Звуки PSFX, сделанные под эти же анимации JB2A (магический круг школы вызова, Misty Step)
export const SOUNDS = {
  intro: `${PSFX}/magic-signs/circles/v1/conjuration-magic-sign-circle-intro.ogg`,
  loop: `${PSFX}/magic-signs/circles/v1/conjuration-magic-sign-circle-loop.ogg`,
  outro: `${PSFX}/magic-signs/circles/v1/conjuration-magic-sign-circle-outro.ogg`,
  arrive: `${PSFX}/2nd-level-spells/misty-step/v1/complete/misty-step-complete-generic-001.ogg`,
  depart: `${PSFX}/2nd-level-spells/misty-step/v1/intro/misty-step-intro-generic-001.ogg`,
};

const VOLUME = { circle: 0.8, flash: 0.5 };

export const hasSequencer = () => !!globalThis.Sequence && !!game.modules.get("sequencer")?.active;

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Магический круг: появление и свечение. Возвращает функцию, которая гасит круг */
export async function openCircle(center, diameterCells, loopMs) {
  if (!hasSequencer()) return async () => {};
  const name = `sa-teleport-circle-${foundry.utils.randomID()}`;
  new Sequence()
    .sound().file(SOUNDS.intro).volume(VOLUME.circle)
    .effect().file(FILES.intro).atLocation(center).size(diameterCells, { gridUnits: true }).belowTokens()
      .waitUntilFinished(-700)
    .sound().file(SOUNDS.loop).volume(VOLUME.circle).duration(loopMs).fadeInAudio(400).fadeOutAudio(800)
    .effect().file(FILES.loop).atLocation(center).size(diameterCells, { gridUnits: true }).belowTokens()
      .persist().name(name).fadeIn(400)
    .play();
  await wait(2000);

  return async () => {
    await wait(1000);
    Sequencer.EffectManager.endEffects({ name });
    new Sequence()
      .sound().file(SOUNDS.outro).volume(VOLUME.circle)
      .effect().file(FILES.outro).atLocation(center).size(diameterCells, { gridUnits: true }).belowTokens()
      .play();
  };
}

/** Вспышка Misty Step со звуком в точке */
export function flash(point, sound) {
  if (!hasSequencer()) return;
  new Sequence()
    .sound().file(sound).volume(VOLUME.flash)
    .effect().file(FILES.flash).atLocation(point).size(2.5, { gridUnits: true })
    .play();
}

/** Размер круга в клетках: охватывает все точки, но не меньше 10 футов в диаметре */
export function circleDiameterCells(center, points) {
  const radiusPx = Math.max(0, ...points.map(p => Math.hypot(p.x - center.x, p.y - center.y)));
  return Math.max(2, Math.ceil((radiusPx * 2) / canvas.dimensions.size) + 2);
}

/**
 * Клик по сцене. `onMove(point)` вызывается при движении мыши (для предпросмотра),
 * возвращает точку или null (ПКМ / Esc).
 */
export function pickPoint(message, onMove) {
  return new Promise(resolve => {
    const finish = point => {
      canvas.stage.off("pointermove", move);
      canvas.stage.off("pointerdown", down);
      document.removeEventListener("keydown", key);
      resolve(point);
    };
    const move = event => onMove?.(event.getLocalPosition(canvas.stage));
    const down = event => {
      event.stopPropagation();
      if (event.button === 2) return finish(null);
      if (event.button === 0) finish(event.getLocalPosition(canvas.stage));
    };
    const key = event => { if (event.key === "Escape") finish(null); };
    canvas.stage.on("pointermove", move);
    canvas.stage.on("pointerdown", down);
    document.addEventListener("keydown", key);
    ui.notifications.info(message);
  });
}

/** Макрос ГМа, если его ещё нет в мире */
export async function ensureMacro({ flag, name, command }) {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (game.macros.some(m => m.getFlag(MODULE_ID, flag))) return;
  try {
    await Macro.create({ name, type: "script", img: FILES.icon, command, flags: { [MODULE_ID]: { [flag]: true } } });
    ui.notifications.info(`Создан макрос «${name}» (вкладка «Макросы»).`);
  } catch (err) {
    console.error(`${LOG} не удалось создать макрос «${name}»`, err);
  }
}

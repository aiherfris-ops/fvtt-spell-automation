import { LOG, MIGRATION_VERSION, MODULE_ID } from "./constants.js";

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export const isActiveGM = () => !!game.users.activeGM?.isSelf;

/**
 * Включено ли заклинание. Настройки требуют перезагрузки мира, поэтому читаем их один раз
 * и дальше отдаём из кэша: проверка вызывается в каждом броске.
 */
const enabledCache = new Map();
export const isEnabled = id => {
  if ( enabledCache.has(id) ) return enabledCache.get(id);
  let value = true;
  try { value = game.settings.get(MODULE_ID, `enabled-${id}`) !== false; }
  catch (err) { return true; } // настройки ещё не зарегистрированы — не кэшируем
  enabledCache.set(id, value);
  return value;
};

export const migrated = (doc, key) => (doc.getFlag(MODULE_ID, key) ?? 0) >= MIGRATION_VERSION;

/**
 * Совпадает ли предмет-заклинание с автоматизацией: по system.identifier, названию
 * или английскому названию из источника (для переведённых импортов).
 */
export function matchesSpell(item, { identifier, name }) {
  if (item?.type !== "spell") return false;
  if (identifier && item.system.identifier === identifier) return true;
  return !!name && (name.test(item.name) || name.test(item.system.source?.custom ?? ""));
}

export function getSourceToken(actor, workflow) {
  const token = workflow?.token ?? actor.getActiveTokens()[0];
  return token?.object ?? token ?? null;
}

/** Automated Animations слушает хуки бросков dnd5e/midi, которые мы обходим, — запускаем анимацию вручную */
export function playSpellAnimation(item, sourceToken, targets, hitTargets = targets) {
  const aa = globalThis.AutomatedAnimations ?? game.modules.get("autoanimations")?.api;
  if ( !game.modules.get("autoanimations")?.active || !aa?.playAnimation || !sourceToken ) return;
  const overrideNames = [item.system.source?.custom].filter(Boolean);
  try {
    aa.playAnimation(sourceToken, item, { targets, hitTargets, hit: hitTargets.length > 0, overrideNames });
  } catch(err) {
    console.warn(`${LOG} Automated Animations failed`, err);
  }
}

/** Проиграть анимации по очереди, не задерживая основной поток */
export function playAnimationSequence(steps, delay) {
  (async () => {
    for ( const step of steps ) {
      step();
      await wait(delay);
    }
  })();
}

/** Кого проверять при загрузке — настройки в core/migration-scope.js */
export { shouldMigrate } from "./migration-scope.js";

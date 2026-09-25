import { LOG, MODULE_ID } from "./constants.js";

/*
 * Работа без midi-qol. Заклинания опирались на его флаги и хуки; здесь то же самое средствами dnd5e:
 *   - эффекты на чужих актёрах — запрос к активному ГМу (CONFIG.queries);
 *   - преимущество и помеха от эффектов — собственные флаги и хуки бросков dnd5e;
 *   - «по актёру попали атакой» — родной хук броска атаки с проверкой выбранной цели.
 */

export const midiActive = () => !!game.modules.get("midi-qol")?.active;

const QUERY = `${MODULE_ID}.effects`;

/** ГМ создаёт и снимает эффекты по запросу игрока */
export function installEffectsQuery() {
  CONFIG.queries[QUERY] = async ({ actorUuid, effects, remove }) => {
    const actor = await fromUuid(actorUuid);
    if (!actor) return false;
    if (remove?.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove);
    if (effects?.length) await actor.createEmbeddedDocuments("ActiveEffect", effects);
    return true;
  };
}

const viaGM = async (actor, payload) => {
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn("Изменить эффекты чужого персонажа может только ГМ — сейчас его нет в сети.");
    return;
  }
  return gm.query(QUERY, { actorUuid: actor.uuid, ...payload }, { timeout: 10_000 });
};

/** Наложить эффекты: сам, через midi или через ГМа */
export async function applyEffects(actor, effects) {
  if (!actor || !effects?.length) return;
  if (actor.isOwner) return actor.createEmbeddedDocuments("ActiveEffect", effects);
  if (midiActive() && globalThis.MidiQOL?.createEffects) {
    return globalThis.MidiQOL.createEffects({ actorUuid: actor.uuid, effects, options: {} });
  }
  return viaGM(actor, { effects });
}

/** Снять эффекты: сам, через midi или через ГМа */
export async function removeEffects(actor, ids) {
  if (!actor || !ids?.length) return;
  if (actor.isOwner) return actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  if (midiActive() && globalThis.MidiQOL?.removeEffects) {
    return globalThis.MidiQOL.removeEffects({ actorUuid: actor.uuid, effects: ids });
  }
  return viaGM(actor, { remove: ids });
}

/* Преимущество и помеха от эффектов */

/** Флаги на эффектах: `flags.spell-automation.grantsAdvantage` — атаки по носителю с преимуществом */
export const GRANTS_ADVANTAGE = `flags.${MODULE_ID}.grantsAdvantage`;
/** `flags.spell-automation.attackDisadvantage` / `checkDisadvantage` — помеха носителю */
export const ATTACK_DISADVANTAGE = `flags.${MODULE_ID}.attackDisadvantage`;
export const CHECK_DISADVANTAGE = `flags.${MODULE_ID}.checkDisadvantage`;

const flagged = (actor, path) => !!foundry.utils.getProperty(actor ?? {}, path);

/** Включить учёт собственных флагов преимущества и помехи (без midi) */
export function installRollFlags() {
  Hooks.on("dnd5e.preRollAttackV2", (config) => {
    const actor = config?.subject?.actor;
    if (flagged(actor, ATTACK_DISADVANTAGE)) config.disadvantage = true;
    // Преимущество даёт эффект на цели (Faerie Fire и подобные)
    const targets = [...game.user.targets];
    if (targets.some(t => flagged(t.actor, GRANTS_ADVANTAGE))) config.advantage = true;
  });

  for (const hook of ["dnd5e.preRollAbilityCheckV2", "dnd5e.preRollSkillV2", "dnd5e.preRollToolCheckV2"]) {
    Hooks.on(hook, (config) => {
      if (flagged(config?.subject, CHECK_DISADVANTAGE)) config.disadvantage = true;
    });
  }
  console.log(`${LOG} учёт преимущества и помехи от эффектов включён`);
}

/* Перехват броска урона */

const patched = new Set();

/**
 * Обернуть `rollDamage` активностей: `before(activity, config)` может вернуть true,
 * чтобы обычный бросок не выполнялся (заклинание считает урон само, как Magic Missile).
 */
export function patchRollDamage(before) {
  for (const cls of new Set(Object.values(CONFIG.DND5E.activityTypes ?? {}).map(t => t?.documentClass).filter(Boolean))) {
    let proto = cls.prototype;
    while (proto && !Object.hasOwn(proto, "rollDamage")) proto = Object.getPrototypeOf(proto);
    if (!proto || patched.has(proto)) continue;
    patched.add(proto);
    const original = proto.rollDamage;
    proto.rollDamage = async function (config = {}, dialog = {}, message = {}) {
      try { if (await before(this, config)) return []; }
      catch (err) { console.error(`${LOG} подготовка урона:`, err); }
      return original.call(this, config, dialog, message);
    };
  }
}

/* Атака по актёру */

/**
 * Кого-то атакуют: handler(targetActor, { attacker, roll, activity }).
 * Без midi цель берётся из выбранных атакующим, попадание считается по СЛ защиты.
 */
export function onAttacked(handler) {
  Hooks.on("dnd5e.rollAttackV2", (rolls, { subject } = {}) => {
    const roll = rolls?.[0];
    const targets = [...game.user.targets];
    if (!roll || !targets.length) return;
    for (const token of targets) {
      if (!token.actor) continue;
      Promise.resolve().then(() => handler(token.actor, { attacker: subject?.actor, roll, activity: subject, token }))
        .catch(err => console.error(`${LOG} обработка атаки:`, err));
    }
  });
}

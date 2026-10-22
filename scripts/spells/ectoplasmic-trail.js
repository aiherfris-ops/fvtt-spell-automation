import { LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { applyEffects, removeEffects } from "../core/midi.js";
import { createDamageCard } from "../core/damage-card.js";
import { onItemUse } from "../core/hooks.js";
import { isActiveGM, migrated } from "../core/utils.js";

/*
 * Ectoplasmic Trail (Psion, UA 2025), 2 круг, бонусное действие.
 * До конца хода заклинатель окутан духами: проходит через занятые клетки как через труднопроходимую местность
 * и не провоцирует атак. Каждое существо, в чьё пространство он входит, покрывается эктоплазмой до конца
 * следующего хода заклинателя: скорость −10 футов и 2d8 некротического урона в начале своего хода.
 * Существо покрывается не чаще раза за ход. На ячейке выше 2-й скорость заклинателя +10 футов за уровень.
 *
 * Импорт Plutonium сделал из заклинания голый бросок 2d8 — меняем на эффект шлейфа; путь токена
 * отслеживается при перемещении, урон в начале хода приходит карточкой урона.
 * Длительности считаются от ходов заклинателя, а не таймером эффекта: таймер не идёт вне боя,
 * а шлейф и эктоплазма часто накладываются до броска инициативы.
 *   шлейф      — снимается в конце хода заклинателя (или через 6 секунд игрового времени вне боя);
 *   эктоплазма — снимается в конце следующего хода заклинателя после покрытия.
 * Не автоматизировано: возврат на последнюю свободную клетку, если ход закончился в занятой.
 */

const SPELL_ID = "ectoplasmic-trail";
const IDS = { cloak: "saEctoTrailCloak" };

const trailEffect = actor => actor?.effects?.find(e => e.active && e.getFlag(MODULE_ID, "ectoplasmicTrail"));
const turnKey = () => (game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : null);

async function cloak(activity) {
  const spell = activity.item;
  const actor = spell.actor;
  const level = activity.getRollData?.()?.item?.level ?? spell.system.level ?? 2;
  const speedBonus = Math.max(0, level - 2) * 10;

  const old = actor.effects.filter(e => e.getFlag(MODULE_ID, "ectoplasmicTrail"));
  if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map(e => e.id));
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Эктоплазменный шлейф",
    img: spell.img,
    origin: spell.uuid,
    description: "<p>До конца хода: проход через занятые клетки как через труднопроходимую местность, "
      + "перемещение не провоцирует атак. Существа на пути покрываются эктоплазмой."
      + (speedBonus ? ` Скорость +${speedBonus} футов.` : "") + "</p>",
    system: { changes: speedBonus ? [{ key: "system.attributes.movement.bonus", type: "add", value: `+ ${speedBonus}`, phase: "initial" }] : [] },
    flags: { [MODULE_ID]: { ectoplasmicTrail: { spellUuid: spell.uuid, casterUuid: actor.uuid, turn: turnKey(), worldTime: game.time.worldTime } } }
  }]);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong> окутывается духами: существа, через чьё пространство он пройдёт в этот ход, `
      + "покроются эктоплазмой (скорость −10 футов, 2d8 некротического урона в начале их хода)."
      + (speedBonus ? ` Скорость +${speedBonus} футов.` : "") + "</p>"
  });
}

/* Путь перемещения токена: центры точек маршрута */

function pathPoints(tokenDoc, origin, options) {
  const size = canvas.dimensions.size;
  const half = { x: tokenDoc.width * size / 2, y: tokenDoc.height * size / 2 };
  const waypoints = options?.movement?.[tokenDoc.id]?.passed?.waypoints;
  const points = [{ x: origin.x + half.x, y: origin.y + half.y }];
  if ( Array.isArray(waypoints) && waypoints.length ) {
    for ( const w of waypoints ) points.push({ x: w.x + half.x, y: w.y + half.y });
  } else {
    points.push({ x: tokenDoc.x + half.x, y: tokenDoc.y + half.y });
  }
  return points;
}

/** Токены, пространство которых пересекает путь (проверка точками через каждые ¼ клетки) */
function tokensOnPath(points, moverId) {
  const step = canvas.dimensions.size / 4;
  const hit = new Set();
  const candidates = canvas.tokens.placeables.filter(t => t.id !== moverId && t.actor && !t.document.hidden);
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for ( let s = 0; s <= steps; s++ ) {
      const x = a.x + (b.x - a.x) * s / steps;
      const y = a.y + (b.y - a.y) * s / steps;
      for ( const t of candidates ) if ( t.bounds.contains(x, y) ) hit.add(t);
    }
  }
  return [...hit];
}

async function coverWithEctoplasm(caster, spellUuid, tokens) {
  const key = turnKey();
  const covered = [];
  for ( const token of tokens ) {
    const target = token.actor;
    // Не чаще раза за ход
    const existing = target.effects.find(e => e.getFlag(MODULE_ID, "ectoplasm")?.casterUuid === caster.uuid);
    if ( existing && existing.getFlag(MODULE_ID, "ectoplasm")?.turn === key ) continue;

    const effect = {
      name: "Покрыт эктоплазмой",
      img: fromUuidSync(spellUuid)?.img,
      origin: spellUuid,
      description: "<p>Скорость −10 футов; 2d8 некротического урона в начале своего хода. До конца следующего хода заклинателя.</p>",
      system: { changes: [{ key: "system.attributes.movement.bonus", type: "add", value: "- 10", phase: "initial" }] },
      flags: { [MODULE_ID]: { ectoplasm: { casterUuid: caster.uuid, spellUuid, turn: key } }, dae: { stackable: "noneName" } }
    };
    try {
      if ( existing ) {
        if ( target.isOwner ) await existing.delete();
        else await removeEffects(target, [existing.id]);
      }
      if ( target.isOwner ) await target.createEmbeddedDocuments("ActiveEffect", [effect]);
      else await applyEffects(target, [effect]);
      covered.push(token.name);
    } catch(err) {
      console.error(`${LOG} Ectoplasmic Trail: ${token.name}`, err);
    }
  }
  if ( covered.length ) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      content: `<p>Эктоплазма покрывает: <strong>${covered.join(", ")}</strong>.</p>`
    });
  }
}

/* Окончание эффектов по ходам заклинателя */

/** Все актёры сцены и боя (у несвязанных токенов свои актёры) */
function sceneActors(combat) {
  const actors = new Set();
  for ( const c of combat?.combatants ?? [] ) if ( c.actor ) actors.add(c.actor);
  for ( const t of canvas?.tokens?.placeables ?? [] ) if ( t.actor ) actors.add(t.actor);
  for ( const a of game.actors ) actors.add(a);
  return [...actors];
}

async function deleteEffects(actor, ids) {
  if ( !ids.length ) return;
  try {
    if ( actor.isOwner ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    else await removeEffects(actor, ids);
  } catch(err) {
    console.error(`${LOG} Ectoplasmic Trail: снятие эффектов у ${actor.name}`, err);
  }
}

/**
 * Закончился ход заклинателя: снять его шлейф и эктоплазму, наложенную не в этот ход
 * («до конца следующего хода заклинателя»).
 */
async function casterTurnEnded(combat, prior, caster) {
  const endedTurn = `${combat.id}:${prior.round}:${prior.turn}`;
  await deleteEffects(caster, caster.effects.filter(e => e.getFlag(MODULE_ID, "ectoplasmicTrail")).map(e => e.id));
  for ( const actor of sceneActors(combat) ) {
    const expired = actor.effects.filter(e => {
      const data = e.getFlag(MODULE_ID, "ectoplasm");
      return data?.casterUuid === caster.uuid && data.turn !== endedTurn;
    });
    await deleteEffects(actor, expired.map(e => e.id));
  }
}

/** Вне боя шлейф живёт один ход — 6 секунд игрового времени */
async function expireTrailsOutOfCombat(worldTime) {
  for ( const actor of sceneActors(null) ) {
    const expired = actor.effects.filter(e => {
      const data = e.getFlag(MODULE_ID, "ectoplasmicTrail");
      return data && !data.turn && worldTime - (data.worldTime ?? worldTime) >= 6;
    });
    await deleteEffects(actor, expired.map(e => e.id));
  }
}

/** Урон эктоплазмы в начале хода покрытого существа */
async function ectoplasmTurnStart(combat, current) {
  const combatant = combat.combatants.get(current?.combatantId);
  const actor = combatant?.actor;
  const effects = actor?.effects.filter(e => e.active && e.getFlag(MODULE_ID, "ectoplasm")) ?? [];
  const token = combatant?.token;
  if ( !effects.length || !token ) return;
  const roll = await new Roll("2d8").evaluate();
  const caster = fromUuidSync(effects[0].getFlag(MODULE_ID, "ectoplasm").casterUuid);
  await createDamageCard(caster ?? actor, {
    rolls: [roll],
    flavor: `Эктоплазма — начало хода ${token.name}`,
    hits: [{ tokenUuid: token.uuid, name: token.name, detail: "Ectoplasmic Trail", damages: [{ value: roll.total, type: "necrotic" }], applied: false }],
    detailLabel: "Источник"
  });
}

export default {
  id: SPELL_ID,
  label: "Ectoplasmic Trail",
  hint: "Шлейф до конца хода: существа на пути покрываются эктоплазмой (−10 футов, 2d8 некротического урона в начале хода).",
  identifiers: [SPELL_ID],

  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => s.system.identifier === SPELL_ID) ) {
      if ( migrated(spell, "ectoplasmicTrailMigrated") ) continue;
      const updates = {
        [`system.activities.${IDS.cloak}`]: {
          _id: IDS.cloak,
          type: "utility",
          name: "Окутаться духами",
          activation: { type: "bonus", value: 1, condition: "", override: false },
          consumption: { targets: [], spellSlot: true, scaling: { allowed: true } },
          range: { units: "self", override: false },
          target: { affects: { type: "self" }, prompt: false, override: false },
          roll: { prompt: false, visible: false }
        },
        [`flags.${MODULE_ID}.ectoplasmicTrailMigrated`]: MIGRATION_VERSION
      };
      for ( const activity of spell.system.activities ) {
        if ( activity.id !== IDS.cloak ) updates[`system.activities.-=${activity.id}`] = null;
      }
      await spell.update(updates);
      console.log(`${LOG} Ectoplasmic Trail у ${actor.name}: эффект шлейфа вместо броска урона`);
    }
  },

  register() {
    onItemUse(SPELL_ID, (activity) => {
      if ( activity.id === IDS.cloak ) cloak(activity).catch(err => console.error(`${LOG} Ectoplasmic Trail:`, err));
    });

    // Запоминаем, откуда токен начал движение
    Hooks.on("preUpdateToken", (tokenDoc, changes, options) => {
      if ( !("x" in changes || "y" in changes) || !trailEffect(tokenDoc.actor) ) return;
      options.saTrailOrigin = { x: tokenDoc.x, y: tokenDoc.y };
    });

    // Путь пройден — покрываем эктоплазмой всех, через чьё пространство он лёг
    Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
      if ( userId !== game.user.id || !options.saTrailOrigin ) return;
      const actor = tokenDoc.actor;
      const effect = trailEffect(actor);
      if ( !effect || !canvas.ready || tokenDoc.parent !== canvas.scene ) return;
      const tokens = tokensOnPath(pathPoints(tokenDoc, options.saTrailOrigin, options), tokenDoc.id);
      if ( !tokens.length ) return;
      const { spellUuid } = effect.getFlag(MODULE_ID, "ectoplasmicTrail");
      coverWithEctoplasm(actor, spellUuid, tokens).catch(err => console.error(`${LOG} Ectoplasmic Trail:`, err));
    });

    Hooks.on("combatTurnChange", (combat, prior, current) => {
      if ( !isActiveGM() ) return;
      (async () => {
        const ended = combat.combatants.get(prior?.combatantId)?.actor;
        if ( ended ) await casterTurnEnded(combat, prior, ended);
        await ectoplasmTurnStart(combat, current);
      })().catch(err => console.error(`${LOG} Ectoplasmic Trail:`, err));
    });

    // Бой закончился — шлейфы и эктоплазма этого боя больше не отсчитываются, снимаем
    Hooks.on("deleteCombat", (combat) => {
      if ( !isActiveGM() ) return;
      (async () => {
        for ( const actor of sceneActors(combat) ) {
          const ids = actor.effects.filter(e => {
            const data = e.getFlag(MODULE_ID, "ectoplasmicTrail") ?? e.getFlag(MODULE_ID, "ectoplasm");
            return data && (!data.turn || data.turn.startsWith(`${combat.id}:`));
          }).map(e => e.id);
          await deleteEffects(actor, ids);
        }
      })().catch(err => console.error(`${LOG} Ectoplasmic Trail:`, err));
    });

    Hooks.on("updateWorldTime", (worldTime) => {
      if ( !isActiveGM() || game.combat?.started ) return;
      expireTrailsOutOfCombat(worldTime).catch(err => console.error(`${LOG} Ectoplasmic Trail:`, err));
    });
  },
};

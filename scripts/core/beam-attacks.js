import { FEATURES_MODULE_ID, LOG, TRANSMUTE_TYPES } from "./constants.js";
import { createDamageCard } from "./damage-card.js";
import { escapeHtml, getSourceToken, matchesSpell, playAnimationSequence, playSpellAnimation } from "./utils.js";

/**
 * Движок заклинаний с несколькими снарядами, где каждый снаряд — отдельная атака
 * (Scorching Ray, Eldritch Blast, Jim's Magic Missile). Одна кнопка «Атака» — распределение
 * снарядов по целям, отдельный бросок атаки на каждый, общая карточка урона.
 *
 * @typedef {object} BeamSpell
 * @property {string} [identifier]  system.identifier заклинания
 * @property {RegExp} name          Название (англ./рус.)
 * @property {string} noun          «Лучи», «Снаряды» — для диалога и карточки
 * @property {(item: Item, scaling: number) => number} count  Число снарядов
 * @property {boolean} [scaleDamage]  Урон растёт с уровнем (иначе повышение ячейки даёт снаряды, а не урон)
 * @property {{hit: string, crit: string, type: string}} [fixedDamage]  Урон без удвоения костей на крите
 * @property {boolean} [backfire]   Натуральная 1 на любом снаряде: все мимо, 1 урона силовым полем заклинателю за снаряд
 */

/** @type {BeamSpell[]} */
const beamSpells = [];
let installed = false;

export function registerBeamSpell(spell) {
  beamSpells.push(spell);
  if (!installed) install();
}

const getBeamSpell = item => beamSpells.find(spell => matchesSpell(item, spell)) ?? null;

// Подменяем бросок атаки: для лучевых заклинаний один клик «Атака» выпускает все снаряды
function install() {
  installed = true;
  Hooks.once("ready", () => {
    const cls = CONFIG.DND5E.activityTypes.attack?.documentClass;
    if ( !cls ) return;
    const original = cls.prototype.rollAttack;
    cls.prototype.rollAttack = async function(config = {}, dialog = {}, message = {}) {
      const spell = getBeamSpell(this.item);
      if ( !spell ) return original.call(this, config, dialog, message);
      try {
        await castBeams(this, spell, config.workflow);
      } catch(err) {
        console.error(`${LOG} beam spell failed`, err);
        ui.notifications.error(`${this.item.name}: ошибка автоматизации, подробности в консоли (F12).`);
      }
      return [];
    };
  });
}

async function castBeams(activity, spell, workflow) {
  const item = activity.item;
  const actor = item.actor;
  const scaling = Number(workflow?.castData?.scaling ?? item.getFlag("dnd5e", "scaling")) || 0;
  const beams = spell.count(item, scaling);

  const targets = [...(workflow?.targets?.size ? workflow.targets : game.user.targets)].filter(t => t?.actor);
  if ( !targets.length ) {
    ui.notifications.warn(`${item.name}: выберите цели (таргет) и нажмите «Атака» ещё раз.`);
    return;
  }

  // Состояние преимущества по умолчанию — от midi-qol (состояния атакующего, флаги и т.п.)
  let defaultMode = "normal";
  try {
    if ( workflow?.checkAttackAdvantage ) {
      await workflow.checkAttackAdvantage();
      const tr = workflow.attackRollModifierTracker;
      const adv = tr?.hasAdvantage ?? workflow.advantage;
      const dis = tr?.hasDisadvantage ?? workflow.disadvantage;
      if ( adv && !dis ) defaultMode = "adv";
      else if ( dis && !adv ) defaultMode = "dis";
    }
  } catch(err) { console.warn(`${LOG} advantage check failed`, err); }

  const choice = await distributeBeams(item, spell, beams, targets, defaultMode);
  if ( !choice ) return;

  const { parts: atkParts, data: atkData } = activity.getAttackData();
  const threshold = activity.criticalThreshold ?? 20;
  const critical = {
    multiplyNumeric: game.settings.get("dnd5e", "criticalDamageModifiers"),
    powerfulCritical: game.settings.get("dnd5e", "criticalDamageMaxDice")
  };
  const damageConfig = spell.fixedDamage ? null
    : spell.scaleDamage ? activity.getDamageConfig({}) : activity.getDamageConfig({ scaling: 0 });

  // Фаза 1: все броски атаки (нужны заранее для проверки отката)
  const allRolls = [];
  const attacks = [];
  for ( const [i, target] of targets.entries() ) {
    const { count, mode } = choice[i];
    const ac = target.actor.system.attributes?.ac?.value;
    for ( let b = 0; b < count; b++ ) {
      const d20 = mode === "adv" ? "2d20kh" : mode === "dis" ? "2d20kl" : "1d20";
      const attack = await new Roll([d20, ...atkParts].join(" + "), atkData).evaluate();
      allRolls.push(attack);
      const nat = attack.dice[0]?.total ?? 0;
      const isCrit = nat >= threshold;
      const isFumble = nat === 1;
      attacks.push({ i, target, attack, isCrit, isFumble,
        isHit: isCrit || (!isFumble && (ac == null || attack.total >= ac)) });
    }
  }
  const backfired = spell.backfire && attacks.some(a => a.isFumble);
  if ( backfired ) for ( const a of attacks ) a.isHit = false;

  // Фаза 2: урон за попадания. Metamagic: Transmuted Spell действует на все снаряды этого каста
  const transmuteTo = actor.getFlag(FEATURES_MODULE_ID, "transmute");
  let transmuted = false;
  const sourceToken = getSourceToken(actor, workflow);
  const hits = [];
  for ( const [i, target] of targets.entries() ) {
    const mine = attacks.filter(a => a.i === i);
    if ( !mine.length ) continue;
    const results = [];
    const totals = new Map();
    const addDamage = (type, value) => totals.set(type, (totals.get(type) ?? 0) + value);

    for ( const a of mine ) {
      let dealt = 0;
      if ( a.isHit && spell.fixedDamage ) {
        const { hit, crit, type } = spell.fixedDamage;
        const dmg = await new Roll(a.isCrit ? crit : hit, atkData).evaluate();
        allRolls.push(dmg);
        addDamage(type, dmg.total);
        dealt = dmg.total;
      } else if ( a.isHit ) {
        for ( const cfg of damageConfig.rolls ) {
          let type = cfg.options.type ?? cfg.options.types?.[0] ?? "";
          if ( transmuteTo && TRANSMUTE_TYPES.includes(type) ) {
            type = transmuteTo;
            transmuted = true;
          }
          const dmg = await new CONFIG.Dice.DamageRoll(cfg.parts.join(" + "), cfg.data, {
            ...cfg.options, type, types: [type], isCritical: a.isCrit, critical
          }).evaluate();
          allRolls.push(dmg);
          addDamage(type, dmg.total);
          dealt += dmg.total;
        }
      }
      results.push(`${a.attack.total}${a.isCrit ? " крит" : a.isFumble ? " (1)" : ""} ${a.isHit ? `✔ ${dealt}` : "✘"}`);
    }

    hits.push({
      tokenUuid: target.document.uuid, name: target.name,
      detail: results.join("; "),
      damages: [...totals].map(([type, value]) => ({ value, type })),
      applied: false
    });
  }

  let note = "";
  if ( backfired ) {
    const casterToken = sourceToken?.document ?? actor.getActiveTokens()[0]?.document;
    hits.push({
      tokenUuid: casterToken?.uuid ?? actor.uuid, name: `${actor.name} (взрыв в лицо)`,
      detail: `${beams} × 1`,
      damages: [{ value: beams, type: "force" }],
      applied: false
    });
    note = "Выпала 1 — все снаряды промахнулись и взорвались у заклинателя.";
  }
  if ( transmuted ) await actor.unsetFlag(FEATURES_MODULE_ID, "transmute");

  // По анимации на снаряд, промахи тоже (как показать промах, решает Automated Animations)
  playAnimationSequence(attacks.map(a => () =>
    playSpellAnimation(item, sourceToken, [a.target], a.isHit ? [a.target] : [])), 350);

  await createDamageCard(actor, {
    rolls: allRolls,
    flavor: `${item.name} — ${spell.noun.toLowerCase()}: ${beams}`,
    hits, detailLabel: "Атака → урон", note
  });

  // Закрываем цепочку midi без её собственных бросков атаки и урона
  if ( workflow && !workflow.aborted ) {
    try { await workflow.performState(workflow.WorkflowState_Cleanup); }
    catch(err) { console.warn(`${LOG} could not finish midi workflow`, err); }
  }
}

async function distributeBeams(item, spell, beams, targets, defaultMode) {
  const initial = targets.map(() => 0);
  for ( let i = 0; i < beams; i++ ) initial[i % targets.length]++;
  const modeOptions = m => [["normal", "Обычно"], ["adv", "Преимущество"], ["dis", "Помеха"]]
    .map(([v, l]) => `<option value="${v}" ${v === m ? "selected" : ""}>${l}</option>`).join("");

  const rows = targets.map((t, i) => {
    const ac = t.actor.system.attributes?.ac?.value;
    return `
    <tr>
      <td style="width:36px"><img src="${t.document.texture.src}" width="32" height="32" style="border:none"></td>
      <td>${escapeHtml(t.name)}${game.user.isGM && ac != null ? ` <span style="opacity:.7">(КД ${ac})</span>` : ""}</td>
      <td style="width:60px"><input type="number" name="n${i}" value="${initial[i]}" min="0" max="${beams}" step="1"></td>
      <td style="width:130px"><select name="m${i}">${modeOptions(defaultMode)}</select></td>
    </tr>`;
  }).join("");

  const choice = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${item.name}: распределение` },
    position: { width: 480 },
    content: `<p>${spell.noun}: <strong>${beams}</strong>. Для каждого — отдельный бросок атаки против КД цели.</p>`
      + `<table>${rows}</table>`,
    ok: {
      label: "Атаковать",
      callback: (event, button) => targets.map((t, i) => ({
        count: Math.max(0, Math.floor(Number(button.form.elements[`n${i}`].value) || 0)),
        mode: button.form.elements[`m${i}`].value
      }))
    },
    rejectClose: false
  });
  if ( !choice ) return null;

  const used = choice.reduce((a, c) => a + c.count, 0);
  if ( used !== beams ) {
    ui.notifications.warn(`${item.name}: распределено ${used} из ${beams}. Попробуйте ещё раз.`);
    return null;
  }
  return choice;
}

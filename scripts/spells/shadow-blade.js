import { LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { onItemUse } from "../core/hooks.js";
import { matchesSpell, migrated } from "../core/utils.js";

/*
 * Shadow Blade (XGE): бонусным действием в руке появляется меч из тени — простое рукопашное оружие
 * с владением, 2d8 психической энергией (3d8 на ячейке 3–4, 4d8 на 5–6, 5d8 на 7+),
 * фехтовальное, лёгкое, метательное (20/60). Преимущество по цели в тусклом свете или темноте.
 * Импорт Plutonium сделал из заклинания голый бросок урона — меняем на сотворение клинка;
 * клинок — предмет-оружие, зависимый от концентрации (исчезает вместе с ней).
 * Освещённость цели определяет игрок: у клинка две атаки — обычная и «из тени» (с преимуществом).
 */

const SPELL = { identifier: "shadow-blade", name: /^\s*(shadow blade|теневой клинок)\s*$/i };
const IDS = {
  cast: "saShadowBladeCst",
  attack: "saShadowBladeAtk",
  darkAttack: "saShadowBladeDrk",
};

const bladeDice = level => (level >= 7 ? 5 : level >= 5 ? 4 : level >= 3 ? 3 : 2);

function bladeData(spell, level, concentration) {
  const attack = (id, name) => ({
    _id: id,
    type: "attack",
    name,
    activation: { type: "action", value: 1, condition: "" },
    attack: { type: { value: "melee", classification: "weapon" }, flat: false, bonus: "" },
    damage: { includeBase: true, parts: [] },
    target: { affects: { type: "creature", count: "1" }, prompt: true },
    consumption: { targets: [], spellSlot: false },
  });
  return {
    name: `Shadow Blade (${bladeDice(level)}d8)`,
    type: "weapon",
    img: spell.img,
    system: {
      description: { value: "<p>Меч из сгустившейся тени, созданный заклинанием <em>Shadow Blade</em>. "
        + "Исчезает, когда заканчивается концентрация. Если бросить или выронить — рассеивается в конце хода; "
        + "бонусным действием его можно снова призвать в руку, пока действует заклинание.</p>"
        + "<p><strong>Атака из тени</strong> — когда цель в тусклом свете или темноте (с преимуществом).</p>" },
      type: { value: "simpleM", baseItem: "" },
      properties: ["fin", "lgt", "thr", "mgc"],
      proficient: 1,
      equipped: true,
      quantity: 1,
      weight: { value: 0, units: "lb" },
      range: { value: 20, long: 60, units: "ft" },
      damage: { base: { number: bladeDice(level), denomination: 8, bonus: "", types: ["psychic"],
        custom: { enabled: false, formula: "" }, scaling: { mode: "", number: 1 } } },
      activities: {
        [IDS.attack]: attack(IDS.attack, "Атака"),
        [IDS.darkAttack]: attack(IDS.darkAttack, "Атака из тени (преимущество)"),
      },
    },
    flags: {
      [MODULE_ID]: { shadowBlade: spell.uuid },
      ...(concentration ? { dnd5e: { dependentOn: concentration.uuid } } : {}),
    },
  };
}

async function summonBlade(activity, results) {
  const spell = activity.item;
  const actor = spell.actor;
  const level = activity.getRollData?.()?.item?.level ?? spell.system.level ?? 2;
  const concentration = results?.effects?.find(e => e.statuses?.has("concentrating"))
    ?? actor.effects.find(e => e.statuses?.has("concentrating") && e.getFlag("dnd5e", "item")?.uuid === spell.uuid);

  const old = actor.items.filter(i => i.getFlag(MODULE_ID, "shadowBlade"));
  if ( old.length ) await actor.deleteEmbeddedDocuments("Item", old.map(i => i.id));
  const [blade] = await actor.createEmbeddedDocuments("Item", [bladeData(spell, level, concentration)]);
  if ( !blade ) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>В руке <strong>${actor.name}</strong> появляется теневой клинок: ${bladeDice(level)}d8 психической энергией.</p>`
      + (concentration ? "" : "<p><em>Концентрация не найдена — удалите клинок вручную, когда заклинание закончится.</em></p>")
  });
}

export default {
  id: "shadow-blade",
  label: "Shadow Blade",
  hint: "Создаёт оружие-клинок (зависит от концентрации) с атакой «из тени» с преимуществом.",
  identifiers: ["shadow-blade"],

  // Вместо голого броска урона — бонусное действие с концентрацией, призывающее клинок
  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => matchesSpell(s, SPELL)) ) {
      if ( migrated(spell, "shadowBladeMigrated") ) continue;
      const updates = {
        [`system.activities.${IDS.cast}`]: {
          _id: IDS.cast,
          type: "utility",
          name: "Призвать клинок",
          activation: { type: "bonus", value: 1, condition: "", override: false },
          duration: { units: "minute", value: "1", concentration: true, override: false },
          consumption: { targets: [], spellSlot: true, scaling: { allowed: true } },
          range: { units: "self", override: false },
          target: { affects: { type: "self" }, prompt: false, override: false },
          roll: { prompt: false, visible: false }
        },
        "system.activation": { type: "bonus", value: 1, condition: "" },
        [`flags.${MODULE_ID}.shadowBladeMigrated`]: MIGRATION_VERSION
      };
      for ( const activity of spell.system.activities ) {
        if ( activity.id !== IDS.cast ) updates[`system.activities.-=${activity.id}`] = null;
      }
      await spell.update(updates);
      console.log(`${LOG} Shadow Blade у ${actor.name}: призыв клинка`);
    }
  },

  register() {
    onItemUse("shadow-blade", (activity, usageConfig, results) => {
      if ( activity.id !== IDS.cast ) return;
      summonBlade(activity, results).catch(err => console.error(`${LOG} Shadow Blade:`, err));
    });

    // Атака из тени — с преимуществом
    Hooks.on("dnd5e.preRollAttackV2", (config) => {
      if ( config?.subject?.id === IDS.darkAttack && config.subject.item?.getFlag(MODULE_ID, "shadowBlade") ) {
        config.advantage = true;
      }
    });
  },
};

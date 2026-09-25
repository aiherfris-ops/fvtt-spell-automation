import { LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { migrated } from "../core/utils.js";

/*
 * True Strike (PHB 2024), заговор: одна атака оружием, для атаки и урона — характеристика заклинателя,
 * урон может быть излучением. На 5/11/17 уровне +1d6/2d6/3d6 излучением.
 *
 * Импорт Plutonium: у зачарования для оружия дальнего боя не подменялась характеристика атаки,
 * у рукопашного доп. урон писался в `system.damage.parts` (в dnd5e 5 такого поля у оружия нет),
 * у дальнего — дописывался строкой в бонус базового урона (ломает оружие с собственным бонусом).
 * Меняем: оба зачарования подменяют характеристику и добавляют выбор излучения,
 * доп. кости заговора добавляет хук броска урона.
 */

const SPELL_ID = "true-strike";
const EFFECT_IDS = ["trueStrikexxxxxx", "trueStrike1xxxxx"];

const extraDice = level => (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0);

/** Зачаровано ли оружие заклинанием True Strike */
const enchantedByTrueStrike = item => item?.effects?.some(e => {
  if ( !e.active || (e.type !== "enchantment" && !e.isAppliedEnchantment) ) return false;
  return fromUuidSync(e.origin, { strict: false })?.item?.system?.identifier === SPELL_ID;
});

export default {
  id: SPELL_ID,
  label: "True Strike",
  hint: "Характеристика заклинателя для атаки и урона любым оружием, выбор урона излучением, доп. 1d6–3d6 с 5 уровня.",
  identifiers: [SPELL_ID],

  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => s.system.identifier === SPELL_ID) ) {
      if ( migrated(spell, "trueStrikeMigrated") ) continue;
      const changes = [
        { key: "system.damage.base.types", type: "add", value: "radiant", phase: "initial" },
        { key: "name", type: "override", value: "{} (True Strike)", phase: "initial" },
        { key: "activities[attack].attack.ability", type: "override", value: "spellcasting", phase: "initial" },
      ];
      const updates = EFFECT_IDS.filter(id => spell.effects.has(id)).map(_id => ({ _id, "system.changes": changes }));
      if ( updates.length ) await spell.updateEmbeddedDocuments("ActiveEffect", updates);
      await spell.setFlag(MODULE_ID, "trueStrikeMigrated", MIGRATION_VERSION);
      console.log(`${LOG} True Strike у ${actor.name}: зачарования исправлены`);
    }
  },

  register() {
    Hooks.on("dnd5e.preRollDamageV2", (config) => {
      const item = config?.subject?.item;
      if ( item?.type !== "weapon" || !enchantedByTrueStrike(item) ) return;
      const actor = item.actor;
      const level = (actor?.type === "character" ? actor.system.details?.level : actor?.system.attributes?.spell?.level) ?? 0;
      const dice = extraDice(level);
      const base = config.rolls?.[0];
      if ( dice && base?.parts ) base.parts.push(`${dice}d6[radiant]`);
    });
  },
};

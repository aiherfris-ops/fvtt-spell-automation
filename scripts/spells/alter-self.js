import { LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { onItemUse } from "../core/hooks.js";
import { migrated } from "../core/utils.js";

/*
 * Alter Self (PHB 2024), 2 круг, концентрация: одно из усилений на выбор, действием Магия его можно сменить.
 *   Aquatic Adaptation — скорость плавания равна скорости ходьбы;
 *   Change Appearance / Natural Weapons — без механики в эффекте (атаки уже есть у заклинания).
 *
 * Импорт Plutonium давал скорость плавания 1 фут и позволял держать все усиления сразу.
 * Меняем: плавание = скорость ходьбы; при выборе усиления прежнее снимается.
 */

const SPELL_ID = "alter-self";
const OPTION_EFFECTS = ["alterSelfxxxxxxx", "alterSelf1xxxxxx", "alterSelf2xxxxxx"];

async function replaceOption(activity) {
  const spell = activity.item;
  const actor = spell.actor;
  const chosen = activity.effects?.[0]?._id;
  if ( !chosen || !OPTION_EFFECTS.includes(chosen) ) return;
  const otherNames = new Set(OPTION_EFFECTS.filter(id => id !== chosen).map(id => spell.effects.get(id)?.name).filter(Boolean));
  // Эффекты этого заклинания на актёре с именами других усилений
  const stale = actor.effects.filter(e => otherNames.has(e.name) && e.origin?.includes(spell.id));
  if ( stale.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", stale.map(e => e.id));
}

export default {
  id: SPELL_ID,
  label: "Alter Self",
  hint: "Скорость плавания = скорость ходьбы; при выборе нового усиления прежнее снимается.",
  identifiers: [SPELL_ID],

  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => s.system.identifier === SPELL_ID) ) {
      if ( migrated(spell, "alterSelfMigrated") ) continue;
      const aquatic = spell.effects.get(OPTION_EFFECTS[0]);
      if ( aquatic ) await aquatic.update({ "system.changes": [
        { key: "system.attributes.movement.swim", type: "upgrade", value: "@attributes.movement.walk", phase: "initial" },
      ] });
      await spell.setFlag(MODULE_ID, "alterSelfMigrated", MIGRATION_VERSION);
      console.log(`${LOG} Alter Self у ${actor.name}: плавание = скорость ходьбы`);
    }
  },

  register() {
    onItemUse(SPELL_ID, (activity) => replaceOption(activity));
  },
};

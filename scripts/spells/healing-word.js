import { LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { migrated } from "../core/utils.js";

/* Healing Word: время накладывания — бонусное действие (в импорте было действие) */

export default {
  id: "healing-word",
  label: "Healing Word",
  hint: "Время накладывания — бонусное действие.",
  identifiers: ["healing-word"],

  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => s.system.identifier === "healing-word") ) {
      if ( migrated(spell, "healingWordMigrated") ) continue;
      const updates = { [`flags.${MODULE_ID}.healingWordMigrated`]: MIGRATION_VERSION };
      for ( const activity of spell.system.activities ) {
        if ( activity.activation?.type === "action" ) updates[`system.activities.${activity.id}.activation.type`] = "bonus";
      }
      await spell.update(updates);
      console.log(`${LOG} Healing Word у ${actor.name}: бонусное действие`);
    }
  },
};

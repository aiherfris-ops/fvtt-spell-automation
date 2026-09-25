import { FEATURES_MODULE_ID, LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { migrated } from "../core/utils.js";

/* Shield: сотворяется реакцией; цель под Щитом не получает урона от Magic Missile */

const SHIELD_EFFECT_RE = /^\s*(shield|imperceptible barrier|щит|незримый барьер)\s*$/i;

/** Под действием ли актёр заклинания Shield (используется в magic-missile.js) */
export const isShielded = actor => !!actor?.effects.some(e => e.active && SHIELD_EFFECT_RE.test(e.name));

export default {
  id: "shield",
  label: "Shield",
  hint: "Время накладывания — реакция (в импорте было действие); используется Magic Missile для обнуления урона.",
  identifiers: ["shield"],

  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => s.system.identifier === "shield") ) {
      // Раньше миграцию выполнял features-automation — её флаг тоже учитываем
      const legacy = (spell.getFlag(FEATURES_MODULE_ID, "shieldMigrated") ?? 0) >= MIGRATION_VERSION;
      if ( legacy || migrated(spell, "shieldMigrated") ) continue;
      const updates = { [`flags.${MODULE_ID}.shieldMigrated`]: MIGRATION_VERSION };
      for ( const activity of spell.system.activities ) {
        if ( activity.activation?.type !== "action" ) continue;
        updates[`system.activities.${activity.id}.activation.type`] = "reaction";
        updates[`system.activities.${activity.id}.activation.condition`] = "Когда по вам попадает атака или вы становитесь целью Magic Missile";
      }
      await spell.update(updates);
      console.log(`${LOG} Shield у ${actor.name}: реакция`);
    }
  },
};

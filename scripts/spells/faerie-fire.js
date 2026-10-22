import { LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { migrated } from "../core/utils.js";

/*
 * Faerie Fire (PHB 2024): атаки по подсвеченному существу — с преимуществом.
 * В импорте эффект «Outlined» был пустым; добавляем флаг Midi, дающий преимущество атакующим.
 * Подавление невидимости и свет не автоматизированы.
 */

const GRANT_ADVANTAGE = "flags.midi-qol.grants.advantage.attack.all";

export default {
  id: "faerie-fire",
  label: "Faerie Fire",
  hint: "Атаки по подсвеченным существам — с преимуществом.",
  identifiers: ["faerie-fire"],

  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => s.system.identifier === "faerie-fire") ) {
      if ( migrated(spell, "faerieFireMigrated") ) continue;
      const effectIds = new Set(spell.system.activities.contents.flatMap(a => (a.effects ?? []).map(e => e._id)));
      for ( const effect of spell.effects.filter(e => effectIds.has(e.id)) ) {
        const changes = foundry.utils.deepClone(effect.system.changes ?? []);
        if ( changes.some(c => c.key === GRANT_ADVANTAGE) ) continue;
        changes.push({ key: GRANT_ADVANTAGE, type: "override", value: "1", phase: "initial" });
        await effect.update({ "system.changes": changes });
      }
      await spell.setFlag(MODULE_ID, "faerieFireMigrated", MIGRATION_VERSION);
      console.log(`${LOG} Faerie Fire у ${actor.name}: преимущество на атаки по подсвеченным`);
    }
  },
};

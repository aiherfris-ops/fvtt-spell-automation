import { LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { migrated } from "../core/utils.js";

/*
 * Ray of Sickness (PHB 2024): при попадании цель отравлена до конца следующего хода заклинателя.
 * В импорте у атаки не было эффекта. Версию 2014 (со спасброском) не трогаем.
 */

const EFFECT_ID = "saRaySickPoison0";

export default {
  id: "ray-of-sickness",
  label: "Ray of Sickness",
  hint: "При попадании — отравление до конца следующего хода заклинателя (версия 2024).",
  identifiers: ["ray-of-sickness"],

  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => s.system.identifier === "ray-of-sickness") ) {
      if ( migrated(spell, "raySicknessMigrated") || spell.system.source?.rules !== "2024" ) continue;
      const attack = spell.system.activities.getByType("attack")[0];
      if ( !attack || spell.system.activities.getByType("save").length ) continue;

      if ( !spell.effects.has(EFFECT_ID) ) {
        await spell.createEmbeddedDocuments("ActiveEffect", [{
          _id: EFFECT_ID,
          name: "Отравлен (Ray of Sickness)",
          img: spell.img,
          transfer: false,
          statuses: ["poisoned"],
          duration: { value: 1, units: "rounds", expiry: "turnEnd" }
        }], { keepId: true });
      }
      await spell.update({
        [`system.activities.${attack.id}.effects`]: [{ _id: EFFECT_ID }],
        [`flags.${MODULE_ID}.raySicknessMigrated`]: MIGRATION_VERSION
      });
      console.log(`${LOG} Ray of Sickness у ${actor.name}: отравление при попадании`);
    }
  },
};

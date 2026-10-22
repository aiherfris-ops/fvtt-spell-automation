import { LOG, MIGRATION_VERSION, MODULE_ID } from "../core/constants.js";
import { onItemUse } from "../core/hooks.js";
import { migrated } from "../core/utils.js";

/*
 * Heat Metal (PHB 2024), 2 круг, концентрация. Раскалённый металлический предмет: 2d8 огнём при сотворении
 * и бонусным действием в последующие ходы (+1d8 за круг ячейки выше 2-го). Существо, которое держит
 * или носит предмет и получило урон, делает спасбросок Телосложения: провал — роняет предмет, если может,
 * иначе помеха на броски атаки и проверки характеристик до начала следующего хода заклинателя.
 *
 * Импорт Plutonium: «Reheat» тратил ячейку на каждое бонусное действие, спасбросок был отдельным
 * действием без активации, эффект помехи был пустым. Меняем на два спасброска с полным уроном
 * (урон проходит всегда, эффект — при провале); «Раскалить снова» без ячейки, но с кругом сотворения.
 * Выронил ли существо оружие — решает ГМ: тогда эффект помехи удаляют вручную.
 */

const SPELL_ID = "heat-metal";
const EFFECT_ID = "heatMetalxxxxxxx";
const IDS = { cast: "saHeatMetalCast0", reheat: "saHeatMetalHeat0" };

const saveActivity = (id, name, activation, slot) => ({
  _id: id,
  type: "save",
  name,
  activation: { type: activation, value: 1, condition: "", override: false },
  consumption: { targets: [], spellSlot: slot, scaling: { allowed: slot } },
  range: { override: false },
  target: { affects: { type: "creature", count: "1" }, prompt: true, override: false },
  save: { ability: ["con"], dc: { calculation: "spellcasting", formula: "" } },
  damage: { onSave: "full", parts: [{ number: 2, denomination: 8, bonus: "", types: ["fire"],
    custom: { enabled: false, formula: "" }, scaling: { mode: slot ? "whole" : "", number: 1 } }] },
  effects: [{ _id: EFFECT_ID, onSave: false }],
});

const findConcentration = (actor, spell) => actor.effects.find(e =>
  e.statuses?.has("concentrating") && e.getFlag("dnd5e", "item")?.uuid === spell.uuid);

export default {
  id: SPELL_ID,
  label: "Heat Metal",
  hint: "Сотворение и «Раскалить снова» — урон всегда, помеха при проваленном спасброске; повтор без траты ячейки, с кругом сотворения.",
  identifiers: [SPELL_ID],

  async migrate(actor) {
    for ( const spell of actor.itemTypes.spell.filter(s => s.system.identifier === SPELL_ID) ) {
      if ( migrated(spell, "heatMetalMigrated") ) continue;
      const updates = {
        [`system.activities.${IDS.cast}`]: saveActivity(IDS.cast, "Раскалить", "action", true),
        [`system.activities.${IDS.reheat}`]: saveActivity(IDS.reheat, "Раскалить снова", "bonus", false),
        [`flags.${MODULE_ID}.heatMetalMigrated`]: MIGRATION_VERSION,
      };
      for ( const activity of spell.system.activities ) {
        if ( !Object.values(IDS).includes(activity.id) ) updates[`system.activities.-=${activity.id}`] = null;
      }
      await spell.update(updates);

      const effect = spell.effects.get(EFFECT_ID);
      const changes = [
        { key: "flags.midi-qol.disadvantage.attack.all", type: "override", value: "1", phase: "initial" },
        { key: "flags.midi-qol.disadvantage.ability.check.all", type: "override", value: "1", phase: "initial" },
      ];
      const description = "<p>Раскалённый металл: помеха на броски атаки и проверки характеристик "
        + "до начала следующего хода заклинателя. Если существо выронило предмет — удалите эффект.</p>";
      if ( effect ) await effect.update({ "system.changes": changes, description });
      else await spell.createEmbeddedDocuments("ActiveEffect", [{ _id: EFFECT_ID, name: "Heated Metal", img: spell.img,
        transfer: false, duration: { value: 1, units: "rounds", expiry: "turnStart" }, description, system: { changes } }],
      { keepId: true });
      console.log(`${LOG} Heat Metal у ${actor.name}: спасбросок с уроном, повтор без ячейки`);
    }
  },

  register() {
    // Круг сотворения нужен для «Раскалить снова»
    onItemUse(SPELL_ID, async (activity) => {
      if ( activity.id !== IDS.cast ) return;
      const level = activity.getRollData?.()?.item?.level ?? activity.item.system.level ?? 2;
      await activity.item.setFlag(MODULE_ID, "heatMetalLevel", level);
    });

    Hooks.on("dnd5e.preUseActivity", (activity) => {
      if ( activity?.id !== IDS.reheat || activity.item?.system.identifier !== SPELL_ID ) return;
      if ( !findConcentration(activity.actor, activity.item) ) {
        ui.notifications.warn("Heat Metal: нет концентрации на заклинании — сначала сотворите его.");
      }
    });

    Hooks.on("dnd5e.preRollDamageV2", (config) => {
      const activity = config?.subject;
      if ( activity?.id !== IDS.reheat || activity.item?.system.identifier !== SPELL_ID ) return;
      const extra = (activity.item.getFlag(MODULE_ID, "heatMetalLevel") ?? 2) - 2;
      const base = config.rolls?.[0];
      if ( extra > 0 && base?.parts ) base.parts.push(`${extra}d8`);
    });
  },
};

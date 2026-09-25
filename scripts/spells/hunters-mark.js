import { LOG, MODULE_ID } from "../core/constants.js";
import { isEnabled } from "../core/utils.js";

/*
 * Hunter's Mark (PHB 2024): +1d6 урона силовым полем при попадании атакой по отмеченной цели.
 * Эффект метки из данных заклинания висит на цели. Бонус добавляется через общий диспетчер
 * features-automation: один макрос Midi и одно окно на все бонусы урона. Правила выбора не дают,
 * поэтому бонус помечен как автоматический и ни о чём не спрашивает.
 */

const markSpells = actor => actor?.itemTypes?.spell?.filter(s => s.system.identifier === "hunters-mark") ?? [];

const provider = {
  id: "hunters-mark",
  automatic: true,
  enabled: () => isEnabled("hunters-mark"),

  prepare({ workflow, actor, target }) {
    if ( !workflow.activity?.attack ) return null; // только атаки с броском атаки
    const spells = markSpells(actor);
    if ( !spells.length ) return null;
    const marked = target?.actor?.effects.some(e => e.active && spells.some(s => e.origin?.startsWith(s.uuid)));
    if ( !marked ) return null;
    return {
      label: "Hunter's Mark: +1d6",
      apply: () => ({ damageRoll: workflow.isCritical ? "2d6" : "1d6", damageType: "force", flavor: "Hunter's Mark" })
    };
  }
};

export default {
  id: "hunters-mark",
  label: "Hunter's Mark",
  hint: "+1d6 силовым полем при попадании атакой по отмеченной цели (через общий бонус урона Midi).",
  identifiers: ["hunters-mark"],

  async migrate(actor) {
    const sync = globalThis.featuresAutomation?.syncDamageBonusMacro;
    if ( !sync ) return console.warn(`${LOG} Hunter's Mark: модуль features-automation не найден, бонус урона не подключён`);
    await sync(actor);
  },

  register() {
    const register = globalThis.featuresAutomation?.registerDamageBonusProvider;
    if ( register ) register(provider);
    else console.warn(`${LOG} Hunter's Mark: features-automation не найден — бонус урона отключён`);
  }
};

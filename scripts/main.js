import { LOG } from "./core/constants.js";
import { createDamageCard, installDamageCard, registerDamageCardSettings } from "./core/damage-card.js";
import { registerMigrationSettings } from "./core/migration-scope.js";
import { AutomationRegistry } from "./core/registry.js";
import spells from "./spells/index.js";
import { installTeleportCircle } from "./tools/teleport-circle/index.js";

/*
 * Spell Automation — автоматизация заклинаний dnd5e.
 * Каждое заклинание — отдельный файл в scripts/spells/, список — spells/index.js.
 */

const registry = new AutomationRegistry(spells);

Hooks.once("init", () => {
  registerDamageCardSettings();
  registerMigrationSettings();
  registry.registerSettings();
});

// Настройки мира доступны с setup — регистрируем хуки только включённых заклинаний
Hooks.once("setup", () => {
  if (!game.modules.get("midi-qol")?.active) {
    ui.notifications.error("Spell Automation (ветка midiqol) работает только вместе с midi-qol.");
    console.error(`${LOG} midi-qol не найден: эта сборка без него не работает`);
    return;
  }
  registry.registerHooks();
});

// Кнопки «Применить» на уже созданных карточках должны работать, даже если заклинание выключили
installDamageCard();

// Инструменты ГМа
installTeleportCircle();

registry.watch();

// Публичное API: карточку урона используют и другие модули (features-automation: Inner Radiance)
globalThis.spellAutomation = Object.assign(globalThis.spellAutomation ?? {}, {
  registry,
  createDamageCard,
  // Ручной запуск проверки данных из макроса: spellAutomation.runMigration()
  // или только для выбранных: spellAutomation.runMigration({ actors: ["Вайлор Морн"] })
  runMigration: (options) => registry.migrateAll({ force: true, ...options }),
});
console.log(`${LOG} загружено автоматизаций заклинаний: ${spells.length}`);

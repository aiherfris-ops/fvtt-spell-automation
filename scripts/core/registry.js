import { LOG, MIGRATION_VERSION, MODULE_ID } from "./constants.js";
import { migrationScope, shouldMigrate } from "./migration-scope.js";
import { isActiveGM, isEnabled } from "./utils.js";

/**
 * Реестр автоматизаций заклинаний (тот же контракт, что в features-automation).
 * @typedef {object} SpellAutomation
 * @property {string} id                      Уникальный id; ключ настройки `enabled-<id>`
 * @property {string} label                   Название для настроек
 * @property {string} [hint]
 * @property {string[]} [identifiers]         `system.identifier` заклинаний — для миграции новых предметов
 * @property {(actor: Actor) => boolean} [appliesTo]
 * @property {(actor: Actor) => Promise<void>} [migrate]  Идемпотентная правка данных (активный ГМ)
 * @property {() => void} [register]          Регистрация хуков (на setup, если включено)
 */
/** Актёры из опции `actors`: документы, id или имена */
const resolveActors = list => [list].flat().map(a => (typeof a === "string" ? game.actors.get(a) ?? game.actors.getName(a) : a)).filter(Boolean);

export class AutomationRegistry {
  /** @param {SpellAutomation[]} automations */
  constructor(automations) {
    this.automations = automations;
  }

  #pending = new Map();
  #enabled = null;

  /** Настройки требуют перезагрузки мира, поэтому список считается один раз */
  get enabled() {
    this.#enabled ??= this.automations.filter(a => isEnabled(a.id));
    return this.#enabled;
  }

  appliesTo(automation, actor) {
    if (automation.appliesTo) return automation.appliesTo(actor);
    const ids = automation.identifiers ?? [];
    return ids.length > 0 && actor.items.some(i => ids.includes(i.system.identifier));
  }

  registerSettings() {
    for (const automation of this.automations) {
      game.settings.register(MODULE_ID, `enabled-${automation.id}`, {
        name: `Заклинание: ${automation.label}`,
        hint: automation.hint ?? "",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        requiresReload: true,
      });
    }
  }

  registerHooks() {
    for (const automation of this.enabled) {
      try { automation.register?.(); }
      catch (err) { console.error(`${LOG} регистрация «${automation.id}» не удалась:`, err); }
    }
    console.log(`${LOG} включено автоматизаций: ${this.enabled.length}/${this.automations.length}`);
  }

  /**
   * Прогнать миграции актёра. Отметка ставится для каждой автоматизации отдельно
   * (`flags.<модуль>.migrated.<id>`), поэтому новая автоматизация доходит и до уже проверенных актёров.
   * Старая общая отметка `migrationVersion` не учитывается: миграции идемпотентны, повторный прогон безопасен.
   */
  async migrateActor(actor, { force = false } = {}) {
    const marks = actor.getFlag(MODULE_ID, "migrated") ?? {};
    const done = {};
    let touched = false;
    for (const automation of this.enabled) {
      if (!automation.migrate) continue;
      if (!force && (marks[automation.id] ?? 0) >= MIGRATION_VERSION) continue;
      if (!this.appliesTo(automation, actor)) continue;
      touched = true;
      try {
        await automation.migrate(actor);
        done[automation.id] = MIGRATION_VERSION;
      }
      catch (err) { console.error(`${LOG} миграция «${automation.id}» у ${actor.name} не удалась:`, err); }
    }
    if (Object.keys(done).length) await actor.update({ [`flags.${MODULE_ID}.migrated`]: done });
    return touched;
  }

  /** Проверить заклинания у актёров выбранного режима (или только `actors`) */
  async migrateAll({ force = false, actors: only } = {}) {
    const scope = migrationScope();
    if (scope === "manual" && !force && !only) return 0;
    const started = performance.now();
    const actors = only ? resolveActors(only)
      : game.actors.filter(a => shouldMigrate(a, scope === "manual" ? "players" : scope));
    let migrated = 0;
    for (const actor of actors) if ( await this.migrateActor(actor, { force }) ) migrated++;
    console.log(`${LOG} проверка заклинаний: ${actors.length} из ${game.actors.size} актёров, изменено ${migrated}, `
      + `${Math.round(performance.now() - started)} мс`);
    return migrated;
  }

  watch() {
    Hooks.once("ready", () => {
      if ( !isActiveGM() ) return;
      this.migrateAll().catch(err => console.error(`${LOG} проверка заклинаний не удалась:`, err));
    });

    Hooks.on("createItem", (item) => {
      const actor = item.actor;
      if (!actor || !isActiveGM()) return;
      if ( !shouldMigrate(actor) ) return;
      if ( !this.enabled.some(a => (a.identifiers ?? []).includes(item.system.identifier)) ) return;
      clearTimeout(this.#pending.get(actor.uuid));
      this.#pending.set(actor.uuid, setTimeout(() => {
        this.#pending.delete(actor.uuid);
        this.migrateActor(actor, { force: true });
      }, 250));
    });
  }
}

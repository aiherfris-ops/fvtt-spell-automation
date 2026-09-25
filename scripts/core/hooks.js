import { LOG } from "./constants.js";

/*
 * Диспетчер использования предметов: один слушатель `dnd5e.postUseActivity` на весь модуль,
 * адресация по `system.identifier` заклинания вместо перебора всех обработчиков.
 */

const byItem = new Map();
let installed = false;

export function onItemUse(identifier, handler) {
  if ( !byItem.has(identifier) ) byItem.set(identifier, []);
  byItem.get(identifier).push(handler);
  if ( installed ) return;
  installed = true;
  Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
    const handlers = byItem.get(activity?.item?.system?.identifier);
    for ( const fn of handlers ?? [] ) {
      try {
        const result = fn(activity, usageConfig, results);
        if ( result instanceof Promise ) result.catch(err => console.error(`${LOG} ${activity.item.name}:`, err));
      } catch(err) {
        console.error(`${LOG} ${activity.item.name}:`, err);
      }
    }
  });
}

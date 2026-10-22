
/*
 * Ветка под midi-qol: преимущество и помеха живут на флагах midi, попадания приходят из его хуков,
 * урон распределяет сам модуль по `midi-qol.preDamageRoll`. Здесь остались только обёртки над API midi.
 */

/** Наложить эффекты: сам, если есть права, иначе руками midi — он сходит к ГМу */
export async function applyEffects(actor, effects) {
  if (!actor || !effects?.length) return;
  if (actor.isOwner) return actor.createEmbeddedDocuments("ActiveEffect", effects);
  return globalThis.MidiQOL.createEffects({ actorUuid: actor.uuid, effects, options: {} });
}

/** Снять эффекты по идентификаторам */
export async function removeEffects(actor, ids) {
  if (!actor || !ids?.length) return;
  if (actor.isOwner) return actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return globalThis.MidiQOL.removeEffects({ actorUuid: actor.uuid, effects: ids });
}

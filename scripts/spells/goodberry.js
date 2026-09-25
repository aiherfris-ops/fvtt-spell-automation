import { MODULE_ID } from "../core/constants.js";
import { onItemUse } from "../core/hooks.js";
import { isActiveGM, matchesSpell } from "../core/utils.js";

/* Goodberry: при касте появляются 10 ягод (1 хит каждая), через 24 игровых часа исчезают */

const SPELL = { identifier: "goodberry", name: /goodberry|волшебная ягода|чудо-?ягода/i };
const BERRY_LIFETIME = 24 * 60 * 60; // 24 игровых часа, в секундах

async function createBerries(item) {
  const actor = item.actor;
  const expiresAt = game.time.worldTime + BERRY_LIFETIME;
  const activityId = foundry.utils.randomID();

  const [berries] = await actor.createEmbeddedDocuments("Item", [{
    name: "Goodberry (ягоды)",
    type: "consumable",
    img: item.img,
    system: {
      type: { value: "food" },
      description: {
        value: "<p>Ягоды, созданные заклинанием <em>Goodberry</em>. Бонусным действием можно съесть"
          + " одну ягоду: она восстанавливает 1 хит и насыщает на весь день.</p>"
          + "<p><em>Ягоды исчезают через 24 часа после сотворения заклинания.</em></p>"
      },
      quantity: 1,
      weight: { value: 0, units: "lb" },
      uses: { spent: 0, max: "10", autoDestroy: true, recovery: [] },
      activities: {
        [activityId]: {
          _id: activityId,
          type: "heal",
          name: "Съесть ягоду",
          activation: { type: "bonus", value: null, condition: "" },
          consumption: { targets: [{ type: "itemUses", value: "1", target: "" }] },
          target: { affects: { type: "self" } },
          healing: { custom: { enabled: true, formula: "1" }, types: ["healing"] }
        }
      }
    },
    flags: { [MODULE_ID]: { expiresAt, casterName: actor.name } }
  }]);
  if ( !berries ) return;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong> создаёт 10 волшебных ягод.`
      + ` Они появились в инвентаре и исчезнут через 24 часа.</p>`
  });
}

/** Удаление просроченных ягод — только активный ГМ */
async function expireBerries() {
  if ( !isActiveGM() ) return;
  const now = game.time.worldTime;

  const actors = new Set(game.actors);
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      if ( token.actor && !token.actor.isToken ) continue; // связанные актёры уже в game.actors
      if ( token.actor ) actors.add(token.actor);
    }
  }

  for ( const actor of actors ) {
    const expired = actor.items.filter(i => {
      const at = i.getFlag(MODULE_ID, "expiresAt");
      return typeof at === "number" && now >= at;
    });
    if ( !expired.length ) continue;
    await actor.deleteEmbeddedDocuments("Item", expired.map(i => i.id));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>Волшебные ягоды у <strong>${actor.name}</strong> потеряли силу и исчезли.</p>`
    });
  }
}

export default {
  id: "goodberry",
  label: "Goodberry",
  hint: "Создаёт предмет с 10 ягодами, которые исчезают через 24 игровых часа.",

  register() {
    onItemUse("goodberry", (activity) => {
      if ( activity.item.actor ) createBerries(activity.item);
    });
    Hooks.on("updateWorldTime", expireBerries);
    Hooks.on("ready", expireBerries);
  },
};

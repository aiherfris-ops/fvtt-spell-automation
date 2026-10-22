import { LOG, MODULE_ID } from "../core/constants.js";
import { onItemUse } from "../core/hooks.js";
import { matchesSpell } from "../core/utils.js";

/*
 * Mirror Image (PHB 2024): три копии на 1 минуту. Когда атака попадает, d6 за каждую копию:
 * если хоть на одной 3+, попадает копия и исчезает. Не действует на ослеплённых
 * и существ со слепым или истинным зрением. Эффекты из данных мира рассчитаны на премиум-модуль PHB.
 */

const SPELL = { identifier: "mirror-image", name: /^\s*(mirror image|отражени[ея]|зеркальное отражение)\s*$/i };
const mirrorEffect = actor => actor?.effects.find(e => (e.getFlag(MODULE_ID, "mirrorImages") ?? 0) > 0);

async function castMirrorImage(item) {
  const actor = item.actor;
  const old = actor.effects.filter(e => e.getFlag(MODULE_ID, "mirrorImages") !== undefined);
  if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map(e => e.id));
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Mirror Image: 3 копии",
    img: item.img,
    origin: item.uuid,
    duration: { value: 60, units: "seconds" },
    description: "<p>Когда по вам попадает атака, бросьте d6 за каждую копию: если хоть на одной 3+, "
      + "попадание приходится в копию и она исчезает. Не действует на ослеплённых и существ со слепым или истинным зрением.</p>",
    flags: { [MODULE_ID]: { mirrorImages: 3 } }
  }]);
}

async function checkDuplicates(workflow) {
  const total = workflow.attackTotal ?? workflow.attackRoll?.total;
  if ( total == null ) return;
  const attacker = workflow.actor;
  const senses = attacker?.system?.attributes?.senses ?? {};
  const seesThrough = attacker?.statuses?.has("blinded")
    || (senses.blindsight ?? senses.ranges?.blindsight ?? 0) > 0
    || (senses.truesight ?? senses.ranges?.truesight ?? 0) > 0;
  if ( seesThrough ) return;

  for ( const token of workflow.targets ?? [] ) {
    const actor = token.actor;
    const effect = mirrorEffect(actor);
    if ( !effect ) continue;
    const ac = actor.system.attributes?.ac?.value ?? 0;
    const hit = workflow.isCritical || (!workflow.isFumble && total >= ac);
    if ( !hit ) continue;

    const count = effect.getFlag(MODULE_ID, "mirrorImages");
    const roll = await new Roll(`${count}d6`).evaluate();
    const absorbed = roll.dice[0].results.some(r => r.result >= 3);
    let note;
    if ( absorbed ) {
      workflow.hitTargets?.delete?.(token);
      const left = count - 1;
      try {
        if ( left > 0 ) await effect.update({ name: `Mirror Image: ${left} коп.`, [`flags.${MODULE_ID}.mirrorImages`]: left });
        else await effect.delete();
      } catch(err) {
        console.warn(`${LOG} Mirror Image: no permission to update ${actor.name}`, err);
      }
      note = `Атака попадает в копию — она исчезает (осталось ${left}). <strong>Урон ${actor.name} не наносится.</strong>`;
    } else {
      note = `Копии не сработали — атака попадает в ${actor.name}.`;
    }
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: [roll],
      flavor: `Mirror Image (${count} коп.)`,
      content: `<p>${note}</p>`
    });
  }
}

export default {
  id: "mirror-image",
  label: "Mirror Image",
  hint: "Эффект с тремя копиями; попадания по носителю проверяются бросками d6.",

  register() {
    onItemUse("mirror-image", (activity) => {
      if ( activity.item.actor ) castMirrorImage(activity.item).catch(err => console.error(`${LOG} Mirror Image:`, err));
    });
    Hooks.on("midi-qol.AttackRollComplete", checkDuplicates);
  },
};

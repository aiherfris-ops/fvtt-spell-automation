import { LOG } from "../core/constants.js";
import { removeEffects } from "../core/native.js";
import { onItemUse } from "../core/hooks.js";

/*
 * Lesser Restoration (PHB 2024), 2 круг: касание, снимает одно состояние — Ослеплён, Оглох,
 * Парализован или Отравлен. После сотворения — выбор состояния у цели и снятие эффекта с ним.
 */

const SPELL_ID = "lesser-restoration";
const CONDITIONS = ["blinded", "deafened", "paralyzed", "poisoned"];

const conditionLabel = id => game.i18n.localize(CONFIG.statusEffects.find(s => s.id === id)?.name ?? id);

async function restore(activity) {
  const caster = activity.actor;
  const tokens = [...game.user.targets];
  if ( tokens.length !== 1 ) {
    ui.notifications.warn("Lesser Restoration: выберите одну цель, чтобы снять состояние.");
    return;
  }
  const target = tokens[0].actor;
  const present = CONDITIONS.filter(id => target?.statuses?.has(id));
  if ( !present.length ) {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: caster }),
      content: `<p>Lesser Restoration: у <strong>${tokens[0].name}</strong> нет подходящих состояний.</p>` });
    return;
  }
  let chosen = present[0];
  if ( present.length > 1 ) {
    chosen = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Lesser Restoration" },
      content: `<p>Какое состояние снять с ${tokens[0].name}?</p><select name="condition" style="width:100%">`
        + present.map(id => `<option value="${id}">${conditionLabel(id)}</option>`).join("") + "</select>",
      ok: { label: "Снять", callback: (event, button) => button.form.elements.condition.value },
      rejectClose: false,
    });
    if ( !chosen ) return;
  }

  const ids = target.effects.filter(e => e.statuses?.has(chosen)).map(e => e.id);
  if ( target.isOwner ) await target.deleteEmbeddedDocuments("ActiveEffect", ids);
  else await removeEffects(target, ids);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<p>Lesser Restoration: с <strong>${tokens[0].name}</strong> снято состояние «${conditionLabel(chosen)}».</p>` });
}

export default {
  id: SPELL_ID,
  label: "Lesser Restoration",
  hint: "После сотворения снимает с цели выбранное состояние: ослеплён, оглох, парализован или отравлен.",
  identifiers: [SPELL_ID],

  register() {
    onItemUse(SPELL_ID, (activity) => restore(activity).catch(err => console.error(`${LOG} Lesser Restoration:`, err)));
  },
};

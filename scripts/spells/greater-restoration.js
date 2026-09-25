import { LOG } from "../core/constants.js";
import { removeEffects } from "../core/native.js";
import { onItemUse } from "../core/hooks.js";

/*
 * Greater Restoration (PHB 2024), 5 круг: касание, снимает с цели одно из:
 *   1 уровень истощения; состояние Очарован или Окаменел; проклятие (в т.ч. настройку на проклятый предмет);
 *   уменьшение характеристики или максимума хитов.
 * После сотворения — выбор эффекта у цели и снятие. Истощение снимается только фактическое:
 * истощение, которое даёт другой эффект (например, «Недоедание»), остаётся, пока есть эффект
 * (Immersion 5e — «Истощение от эффектов»). Проклятия и уменьшение характеристик — вручную, это отмечается в чате.
 */

const SPELL_ID = "greater-restoration";
const CONDITIONS = ["charmed", "petrified"];

const conditionLabel = id => game.i18n.localize(CONFIG.statusEffects.find(s => s.id === id)?.name ?? id);

/** Фактическое истощение и истощение от эффектов (если Immersion 5e не включён — всё фактическое) */
function exhaustionParts(actor) {
  const attrs = actor.system.attributes ?? {};
  const total = attrs.exhaustion ?? 0;
  const actual = attrs.exhaustionBase ?? total;
  return { actual, fromEffects: Math.max(0, total - actual) };
}

async function reduceExhaustion(actor) {
  const api = globalThis.immersion5e?.adjustExhaustion;
  if (api) return api(actor, -1);
  const before = actor.system.attributes.exhaustion ?? 0;
  if (!actor.isOwner) {
    ui.notifications.warn("Снять истощение с чужого персонажа может только ГМ.");
    return null;
  }
  await actor.update({ "system.attributes.exhaustion": Math.max(0, before - 1) });
  return { before, after: Math.max(0, before - 1) };
}

async function removeStatus(actor, status) {
  const ids = actor.effects.filter(e => e.statuses?.has(status)).map(e => e.id);
  if (actor.isOwner) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  else await removeEffects(actor, ids);
}

async function restore(activity) {
  const caster = activity.actor;
  const tokens = [...game.user.targets];
  if ( tokens.length !== 1 ) {
    ui.notifications.warn("Greater Restoration: выберите одну цель.");
    return;
  }
  const token = tokens[0];
  const target = token.actor;
  const { actual, fromEffects } = exhaustionParts(target);

  const options = [];
  if ( actual > 0 ) options.push({ value: "exhaustion", label: `Истощение: −1 (сейчас фактическое ${actual})` });
  for ( const id of CONDITIONS ) if ( target.statuses?.has(id) ) options.push({ value: id, label: conditionLabel(id) });
  options.push({ value: "curse", label: "Проклятие / настройка на проклятый предмет (вручную)" });
  options.push({ value: "reduction", label: "Уменьшение характеристики или максимума хитов (вручную)" });

  const effectNote = fromEffects
    ? `<p><em>Истощение от эффектов (${fromEffects}) заклинанием не снимается — только вместе с эффектом.</em></p>` : "";
  const chosen = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Greater Restoration" },
    content: `<p>Что снять с ${token.name}?</p><select name="choice" style="width:100%">`
      + options.map(o => `<option value="${o.value}">${o.label}</option>`).join("") + `</select>${effectNote}`,
    ok: { label: "Снять", callback: (event, button) => button.form.elements.choice.value },
    rejectClose: false,
  });
  if ( !chosen ) return;

  let text;
  if ( chosen === "exhaustion" ) {
    const result = await reduceExhaustion(target);
    if ( !result ) return;
    text = `истощение ${result.before} → ${result.after}`
      + (fromEffects ? ` (ещё ${fromEffects} от эффектов остаётся)` : "");
  } else if ( CONDITIONS.includes(chosen) ) {
    await removeStatus(target, chosen);
    text = `снято состояние «${conditionLabel(chosen)}»`;
  } else {
    text = chosen === "curse" ? "снято проклятие — отметьте вручную" : "восстановлены характеристики/максимум хитов — отметьте вручную";
  }
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<p>Greater Restoration на <strong>${token.name}</strong>: ${text}.</p>${fromEffects && chosen !== "exhaustion" ? effectNote : ""}` });
}

export default {
  id: SPELL_ID,
  label: "Greater Restoration",
  hint: "После сотворения — выбор, что снять с цели: 1 уровень фактического истощения, Очарован, Окаменел; проклятие и уменьшения — отметкой.",
  identifiers: [SPELL_ID],

  register() {
    onItemUse(SPELL_ID, (activity) => restore(activity).catch(err => console.error(`${LOG} Greater Restoration:`, err)));
  },
};

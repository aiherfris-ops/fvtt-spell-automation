import { MODULE_ID } from "./constants.js";
import { midiActive } from "./native.js";
import { escapeHtml } from "./utils.js";

/**
 * Карточка урона с кнопками «Применить» для ГМа.
 * @typedef {{ tokenUuid: string, name: string, detail: string, damages: {value: number, type: string}[], applied: boolean }} DamageHit
 * @typedef {{ hits: DamageHit[], detailLabel?: string, note?: string }} DamageCardData
 */

export function damageCardContent(hits, { detailLabel = "", note = "" } = {}) {
  const rows = hits.map((h, i) => {
    const total = h.damages.reduce((a, d) => a + d.value, 0);
    const canApply = total > 0 && !h.applied;
    return `
    <tr>
      <td>${escapeHtml(h.name)}</td>
      <td style="text-align:center">${escapeHtml(h.detail)}</td>
      <td style="text-align:center"><strong>${total}</strong></td>
      <td style="text-align:right">${h.applied ? "<em>применено</em>"
        : canApply ? `<button type="button" data-sa-apply="${i}" style="line-height:1.4">Применить</button>` : ""}</td>
    </tr>`;
  }).join("");
  const pending = hits.some(h => !h.applied && h.damages.some(d => d.value > 0));
  return `<table><thead><tr><th>Цель</th><th>${escapeHtml(detailLabel)}</th><th>Урон</th><th></th></tr></thead>`
    + `<tbody>${rows}</tbody></table>`
    + (pending ? `<button type="button" data-sa-apply="all">Применить всем</button>` : "")
    + (note ? `<p style="font-size:0.85em;opacity:.8">${escapeHtml(note)}</p>` : "");
}

/**
 * Создать сообщение с карточкой урона.
 * @param {Actor} actor
 * @param {{ rolls: Roll[], flavor: string } & DamageCardData} data
 */
export function createDamageCard(actor, { rolls, flavor, hits, detailLabel = "", note = "" }) {
  const flagData = { hits, detailLabel, note };
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls,
    flavor,
    content: damageCardContent(hits, flagData),
    flags: { [MODULE_ID]: { damageCard: flagData } }
  });
}

export const AUTO_APPLY_SETTING = "damage-card-auto-apply";

export function registerDamageCardSettings() {
  game.settings.register(MODULE_ID, AUTO_APPLY_SETTING, {
    name: "Применение урона карточек",
    hint: "Карточки урона модулей (Magic Missile, лучи, Graze, Inner Radiance и др.). «Как в Midi-QOL» — "
      + "применять автоматически, если в Midi включено Auto apply damage.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      midi: "Как в Midi-QOL",
      always: "Всегда автоматически",
      never: "Только кнопкой ГМа"
    },
    default: "midi"
  });
}

/** Midi: none / noCard / noCardMisses — не применять; yes / yesCard / yesCardMisses — применять; yesCardNPC — только NPC */
function midiAutoApply() {
  try {
    const settings = game.settings.get("midi-qol", "ConfigSettings");
    return settings?.autoApplyDamage ?? "none";
  } catch(err) {
    return "none";
  }
}

/** Без midi настройка «как в midi» означает автоматическое применение: карточка и так наша */
const defaultAutoApply = () => !midiActive();

function shouldAutoApply(actor) {
  const mode = game.settings.get(MODULE_ID, AUTO_APPLY_SETTING);
  if ( mode === "always" ) return true;
  if ( mode === "never" ) return false;
  if ( !midiActive() ) return defaultAutoApply();
  const midi = midiAutoApply();
  if ( midi === "yesCardNPC" ) return actor?.type === "npc";
  return midi.startsWith("yes");
}

/** Применить урон выбранных строк карточки и обновить сообщение (выполняет ГМ) */
async function applyHits(message, indices, { auto = false } = {}) {
  const data = foundry.utils.deepClone(message.getFlag(MODULE_ID, "damageCard"));
  let changed = false;
  for ( const i of indices ?? data.hits.map((_, i) => i) ) {
    const hit = data.hits[i];
    if ( !hit || hit.applied || !hit.damages.some(d => d.value > 0) ) continue;
    const doc = await fromUuid(hit.tokenUuid);
    const actor = doc instanceof Actor ? doc : doc?.actor;
    if ( !actor ) {
      ui.notifications.warn(`Цель «${hit.name}» не найдена.`);
      continue;
    }
    if ( auto && !shouldAutoApply(actor) ) continue;
    await actor.applyDamage(hit.damages);
    hit.applied = true;
    changed = true;
  }
  if ( !changed ) return;
  await message.update({
    content: damageCardContent(data.hits, data),
    [`flags.${MODULE_ID}.damageCard.hits`]: data.hits
  });
}

export function installDamageCard() {
  // Автоприменение: карточку создаёт любой клиент, урон применяет активный ГМ
  Hooks.on("createChatMessage", (message) => {
    if ( !game.users.activeGM?.isSelf || !message.getFlag(MODULE_ID, "damageCard") ) return;
    if ( game.settings.get(MODULE_ID, AUTO_APPLY_SETTING) === "never" ) return;
    applyHits(message, null, { auto: true }).catch(err => console.error(`${MODULE_ID} | auto apply damage failed`, err));
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    if ( !message.getFlag(MODULE_ID, "damageCard") ) return;
    for ( const button of html.querySelectorAll("[data-sa-apply]") ) {
      if ( !game.user.isGM ) { button.remove(); continue; }
      button.addEventListener("click", async event => {
        event.preventDefault();
        button.disabled = true;
        const key = button.dataset.saApply;
        await applyHits(message, key === "all" ? null : [Number(key)]);
      });
    }
  });
}

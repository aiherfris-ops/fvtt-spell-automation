import { createDamageCard } from "../core/damage-card.js";
import { escapeHtml, getSourceToken, matchesSpell, playAnimationSequence, playSpellAnimation } from "../core/utils.js";
import { isShielded } from "./shield.js";

/* Magic Missile: распределение дротиков по целям, один бросок 1d4+1 на все, Shield обнуляет урон */

const SPELL = { identifier: "magic-missile", name: /^\s*(magic missile|волшебная стрела|магическая стрела)\s*$/i };

async function castMagicMissile(workflow, activity) {
  const item = activity.item;
  const actor = item.actor;
  const scaling = Number(workflow?.castData?.scaling) || 0;
  const darts = 3 + scaling;

  const targets = [...(workflow?.targets?.size ? workflow.targets : game.user.targets)].filter(t => t?.actor);
  if ( !targets.length ) {
    ui.notifications.warn("Magic Missile: выберите цели (таргет) и нажмите «Урон» ещё раз.");
    return;
  }

  // По умолчанию — поровну по кругу
  const initial = targets.map(() => 0);
  for ( let i = 0; i < darts; i++ ) initial[i % targets.length]++;

  const rows = targets.map((t, i) => `
    <tr>
      <td style="width:36px"><img src="${t.document.texture.src}" width="32" height="32" style="border:none"></td>
      <td>${escapeHtml(t.name)}</td>
      <td style="width:70px"><input type="number" name="d${i}" value="${initial[i]}" min="0" max="${darts}" step="1"></td>
    </tr>`).join("");

  const counts = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${item.name}: распределение дротиков` },
    content: `<p>Дротиков: <strong>${darts}</strong> (ячейка ${1 + scaling} ур.).`
      + ` Все дротики попадают одновременно, урон каждого — 1d4 + 1 (один бросок на все).</p>`
      + `<table>${rows}</table>`,
    ok: {
      label: "Выпустить",
      callback: (event, button) => targets.map((t, i) => Math.max(0, Math.floor(Number(button.form.elements[`d${i}`].value) || 0)))
    },
    rejectClose: false
  });
  if ( !counts ) return;

  const used = counts.reduce((a, b) => a + b, 0);
  if ( used !== darts ) {
    ui.notifications.warn(`Magic Missile: распределено ${used} дротиков из ${darts}. Попробуйте ещё раз.`);
    return;
  }

  // По анимации на дротик
  const sourceToken = getSourceToken(actor, workflow);
  playAnimationSequence(targets.flatMap((t, i) => Array(counts[i]).fill(() => playSpellAnimation(item, sourceToken, [t]))), 250);

  const roll = await new Roll("1d4 + 1", activity.getRollData?.() ?? actor.getRollData()).evaluate();
  const perDart = roll.total;

  const hits = targets
    .map((t, i) => {
      const blocked = isShielded(t.actor);
      return {
        tokenUuid: t.document.uuid, name: t.name,
        detail: `${counts[i]} × ${perDart}${blocked ? " — Щит" : ""}`,
        damages: [{ value: blocked ? 0 : counts[i] * perDart, type: "force" }],
        applied: false
      };
    })
    .filter((h, i) => counts[i] > 0);

  await createDamageCard(actor, {
    rolls: [roll],
    flavor: `${item.name} — ${darts} дротика(ов), ${perDart} урона силовым полем за дротик`,
    hits, detailLabel: "Дротики",
    note: "Урон по целям под «Щитом» обнулён автоматически."
  });

  // Даём цепочке midi завершиться без её собственного броска урона
  if ( workflow?.suspended ) workflow.unSuspend({ noDamage: true });
}

export default {
  id: "magic-missile",
  label: "Magic Missile",
  hint: "Распределение дротиков по целям вместо одного броска на всех; учитывает Shield.",

  register() {
    // midi-qol вызывает этот хук вместо броска урона — заменяем общий бросок своим распределением
    Hooks.on("midi-qol.preDamageRoll", (workflow, activity) => {
      if ( !matchesSpell(activity?.item, SPELL) ) return true;
      castMagicMissile(workflow, activity);
      return false;
    });
  },
};

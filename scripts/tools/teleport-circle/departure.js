import { LOG } from "../../core/constants.js";
import { wait } from "../../core/utils.js";
import { SOUNDS, circleDiameterCells, escapeHtml, flash, hasSequencer, openCircle, pickPoint } from "./shared.js";

/*
 * «Круг телепортации: отбытие» — обратный эффект к прибытию.
 * Токены забираются со сцены одним из способов:
 *   - списком: ГМ отмечает токены текущей сцены;
 *   - сферой: ГМ кликает центр, забираются токены в заданном радиусе (с предпросмотром).
 * Под группой вспыхивает круг, каждый токен исчезает со вспышкой; затем токен удаляется или скрывается.
 */

const isPlayerCharacter = token => token.actor?.type === "character" && token.actor.hasPlayerOwner;

/* Настройки отбытия */

async function askOptions() {
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Круг телепортации: отбытие" },
    position: { width: 400 },
    content: `
      <div class="form-group"><label>Как выбрать</label>
        <select name="mode">
          <option value="sphere">Сферой — клик по центру</option>
          <option value="list">Списком токенов сцены</option>
        </select></div>
      <div class="form-group"><label>Радиус сферы (футов)</label>
        <input type="number" name="radius" value="15" min="5" step="5"></div>
      <div class="form-group"><label>Кого забирать</label>
        <select name="whom">
          <option value="players">Только персонажей игроков</option>
          <option value="all">Любые токены</option>
        </select></div>
      <div class="form-group"><label>После исчезновения</label>
        <select name="removal">
          <option value="delete">Удалить токены со сцены</option>
          <option value="hide">Скрыть токены (останутся на сцене)</option>
        </select></div>
      <p style="font-size:.85em;opacity:.8"><em>Персонажи игроков при удалении токена не теряются — остаются в списке актёров.
        Несвязанные токены NPC при удалении пропадают вместе со своими данными — для них лучше «Скрыть».</em></p>`,
    ok: {
      label: "Далее",
      callback: (event, button) => {
        const form = button.form.elements;
        return {
          mode: form.mode.value,
          radius: Math.max(5, Number(form.radius.value) || 15),
          whom: form.whom.value,
          removal: form.removal.value,
        };
      },
    },
    rejectClose: false,
  });
}

const candidates = whom => canvas.tokens.placeables.filter(t => t.actor && !t.document.hidden
  && (whom === "all" || isPlayerCharacter(t)));

/* Выбор списком */

async function chooseTokens(whom) {
  const tokens = candidates(whom).sort((a, b) => a.name.localeCompare(b.name));
  if (!tokens.length) {
    ui.notifications.warn("На сцене нет подходящих токенов.");
    return null;
  }
  const rows = tokens.map(t => `<label style="display:flex;align-items:center;gap:.5em;margin:.2em 0">
    <input type="checkbox" name="token" value="${t.id}" ${isPlayerCharacter(t) ? "checked" : ""}>
    <img src="${escapeHtml(t.document.texture.src)}" width="28" height="28" style="border:none">
    ${escapeHtml(t.name)}</label>`).join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Круг телепортации: кто уходит" },
    position: { width: 380 },
    content: `<div style="max-height:400px;overflow-y:auto">${rows}</div>`,
    ok: {
      label: "Отправить",
      callback: (event, button) => [...button.form.querySelectorAll("input[name=token]:checked")]
        .map(input => canvas.tokens.get(input.value)).filter(Boolean),
    },
    rejectClose: false,
  });
}

/* Выбор сферой с предпросмотром */

async function chooseSphere(radiusFt, whom) {
  const radiusPx = radiusFt * canvas.dimensions.size / canvas.dimensions.distance;
  const inside = center => candidates(whom).filter(t => canvas.grid.measurePath([center, t.center]).distance <= radiusFt);
  const gfx = new PIXI.Graphics();
  canvas.controls.addChild(gfx);

  const draw = center => {
    gfx.clear();
    gfx.lineStyle(3, 0xffc94d, 0.9).beginFill(0xffc94d, 0.08).drawCircle(center.x, center.y, radiusPx).endFill();
    for (const token of inside(center)) {
      gfx.lineStyle(3, 0x66ccff, 0.9).drawCircle(token.center.x, token.center.y, Math.max(token.w, token.h) / 2 + 4);
    }
  };

  try {
    const center = await pickPoint(`Кликните центр сферы радиусом ${radiusFt} футов (ПКМ или Esc — отмена).`, draw);
    if (!center) return null;
    const tokens = inside(center);
    if (!tokens.length) ui.notifications.warn("В сфере нет подходящих токенов.");
    return { center, tokens };
  } finally {
    gfx.destroy();
  }
}

/* Отбытие */

export async function teleportDeparture() {
  if (!game.user.isGM) return ui.notifications.warn("Круг телепортации — только для ГМа.");
  if (!canvas.ready) return ui.notifications.warn("Откройте сцену, с которой уходят персонажи.");
  if (!hasSequencer()) ui.notifications.warn("Sequencer не включён — токены исчезнут без анимации.");

  const options = await askOptions();
  if (!options) return;

  let center;
  let tokens;
  let diameterCells;
  if (options.mode === "list") {
    tokens = await chooseTokens(options.whom);
    if (!tokens?.length) return;
    center = {
      x: tokens.reduce((sum, t) => sum + t.center.x, 0) / tokens.length,
      y: tokens.reduce((sum, t) => sum + t.center.y, 0) / tokens.length,
    };
    diameterCells = circleDiameterCells(center, tokens.map(t => t.center));
  } else {
    const picked = await chooseSphere(options.radius, options.whom);
    if (!picked?.tokens.length) return;
    ({ center, tokens } = picked);
    diameterCells = Math.max(2, Math.ceil((options.radius * 2) / canvas.dimensions.distance));
  }

  const closeCircle = await openCircle(center, diameterCells, 1200 + tokens.length * 1500);

  const departed = [];
  for (const token of tokens) {
    const doc = token.document;
    try {
      flash(token.center, SOUNDS.depart);
      await wait(300);
      await doc.update({ alpha: 0 }, { animation: { duration: 700 } });
      await wait(750);
      if (options.removal === "delete") await doc.delete();
      else await doc.update({ hidden: true, alpha: 1 }, { animate: false });
      departed.push(doc.name);
    } catch (err) {
      console.error(`${LOG} teleportDeparture: ${doc.name}`, err);
    }
  }

  await closeCircle();
  if (departed.length) {
    await ChatMessage.create({
      content: `<p><em>Руны круга вспыхивают в последний раз, и портал уносит: `
        + `<strong>${departed.map(escapeHtml).join(", ")}</strong>.</em></p>`,
    });
  }
}

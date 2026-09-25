import { LOG } from "../../core/constants.js";
import { wait } from "../../core/utils.js";
import { SOUNDS, circleDiameterCells, escapeHtml, flash, hasSequencer, openCircle, pickPoint } from "./shared.js";

/*
 * «Круг телепортации: прибытие». ГМ выбирает персонажей и кликает точку на сцене:
 * появляется магический круг, персонажи по одному материализуются вокруг него.
 * Токен, уже стоящий на сцене, переносится в круг; иначе создаётся из прототипа актёра.
 */

async function chooseActors() {
  const candidates = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!candidates.length) {
    ui.notifications.warn("Нет персонажей игроков.");
    return null;
  }
  const rows = candidates.map(a => {
    const activeOwner = game.users.some(u => u.active && !u.isGM && a.testUserPermission(u, "OWNER"));
    return `<label style="display:flex;align-items:center;gap:.5em;margin:.2em 0">
      <input type="checkbox" name="actor" value="${a.id}" ${activeOwner ? "checked" : ""}>
      <img src="${a.prototypeToken.texture.src || a.img}" width="28" height="28" style="border:none">
      ${escapeHtml(a.name)}</label>`;
  }).join("");

  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Круг телепортации: прибытие" },
    position: { width: 380 },
    content: "<p>Кто появляется? Отмечены персонажи игроков, которые сейчас в сети.</p>"
      + `<div style="max-height:360px;overflow-y:auto">${rows}</div>`
      + "<p><em>После выбора кликните на сцене центр круга (ПКМ или Esc — отмена).</em></p>",
    ok: {
      label: "Выбрать место",
      callback: (event, button) => [...button.form.querySelectorAll("input[name=actor]:checked")]
        .map(input => game.actors.get(input.value)).filter(Boolean),
    },
    rejectClose: false,
  });
}

/** Свободные клетки по спирали вокруг центра */
function arrivalCells(center, count, movingTokenIds) {
  const size = canvas.dimensions.size;
  const occupied = point => canvas.tokens.placeables.some(t =>
    !movingTokenIds.has(t.id) && t.bounds.contains(point.x, point.y));
  const cells = [];
  for (let ring = 0; cells.length < count && ring < 10; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const point = { x: center.x + dx * size, y: center.y + dy * size };
        if (point.x < 0 || point.y < 0 || point.x > canvas.dimensions.width || point.y > canvas.dimensions.height) continue;
        if (!occupied(point)) cells.push(point);
      }
    }
  }
  return cells.slice(0, count);
}

export async function teleportArrival() {
  if (!game.user.isGM) return ui.notifications.warn("Круг телепортации — только для ГМа.");
  if (!canvas.ready) return ui.notifications.warn("Откройте сцену назначения.");
  if (!hasSequencer()) ui.notifications.warn("Sequencer не включён — персонажи появятся без анимации.");

  const actors = await chooseActors();
  if (!actors?.length) return;
  const clicked = await pickPoint("Кликните центр круга телепортации (ПКМ или Esc — отмена).");
  if (!clicked) return;

  const scene = canvas.scene;
  const center = canvas.grid.getCenterPoint(clicked);
  const existing = new Map(actors.map(a => [a.id, scene.tokens.find(t => t.actorId === a.id)]).filter(([, t]) => t));
  const cells = arrivalCells(center, actors.length, new Set([...existing.values()].map(t => t.id)));
  if (cells.length < actors.length) ui.notifications.warn("Не хватило свободных клеток — часть персонажей не появится.");

  const closeCircle = await openCircle(center, circleDiameterCells(center, cells), 1200 + cells.length * 1500);

  const arrived = [];
  for (const [i, actor] of actors.entries()) {
    const cell = cells[i];
    if (!cell) break;
    try {
      const token = existing.get(actor.id);
      const width = (token?.width ?? actor.prototypeToken.width ?? 1) * canvas.dimensions.size;
      const height = (token?.height ?? actor.prototypeToken.height ?? 1) * canvas.dimensions.size;
      const position = { x: cell.x - width / 2, y: cell.y - height / 2 };

      flash(cell, SOUNDS.arrive);
      await wait(350);

      let doc;
      if (token) {
        await token.update({ ...position, alpha: 0, hidden: false }, { animate: false });
        doc = token;
      } else {
        const data = (await actor.getTokenDocument({ ...position, alpha: 0, hidden: false })).toObject();
        [doc] = await scene.createEmbeddedDocuments("Token", [data]);
      }
      await doc?.update({ alpha: 1 }, { animation: { duration: 700 } });
      arrived.push(actor.name);
      await wait(450);
    } catch (err) {
      console.error(`${LOG} teleportArrival: ${actor.name}`, err);
    }
  }

  await closeCircle();
  if (arrived.length) {
    await ChatMessage.create({
      content: `<p><em>Сияющие руны вспыхивают на земле, и из мерцающего портала шагают: `
        + `<strong>${arrived.map(escapeHtml).join(", ")}</strong>.</em></p>`,
    });
  }
}

import { teleportArrival } from "./arrival.js";
import { teleportDeparture } from "./departure.js";
import { ensureMacro } from "./shared.js";

/*
 * Инструменты ГМа «Круг телепортации»: прибытие и отбытие персонажей с анимацией и звуком.
 * Запуск из макросов (создаются автоматически у активного ГМа):
 *   spellAutomation.teleportArrival()   — персонажи появляются в круге
 *   spellAutomation.teleportDeparture() — токены уходят со сцены (списком или сферой)
 */

export function installTeleportCircle() {
  globalThis.spellAutomation = Object.assign(globalThis.spellAutomation ?? {}, { teleportArrival, teleportDeparture });
  Hooks.once("ready", async () => {
    await ensureMacro({ flag: "teleportArrivalMacro", name: "Круг телепортации: прибытие", command: "spellAutomation.teleportArrival();" });
    await ensureMacro({ flag: "teleportDepartureMacro", name: "Круг телепортации: отбытие", command: "spellAutomation.teleportDeparture();" });
  });
}

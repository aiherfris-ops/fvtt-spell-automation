import { registerBeamSpell } from "../core/beam-attacks.js";

/*
 * Jim's Magic Missile (AI): 3 снаряда (+1 за уровень ячейки выше 1-го), атака на каждый.
 * Попадание — 2d4, крит — ровно 5d4 без удвоения. Натуральная 1 на любом снаряде:
 * все промахиваются и взрываются у заклинателя (1 урона силовым полем за снаряд).
 */

export default {
  id: "jims-magic-missile",
  label: "Jim's Magic Missile",
  hint: "Атака на каждый снаряд, крит 5d4, откат на натуральной 1.",

  register() {
    registerBeamSpell({
      identifier: "jims-magic-missile",
      name: /^\s*(jim['’]?s magic missile|волшебная стрела джима|магическая стрела джима)\s*$/i,
      noun: "Снаряды",
      count: (item, scaling) => 3 + scaling,
      fixedDamage: { hit: "2d4", crit: "5d4", type: "force" },
      backfire: true
    });
  },
};

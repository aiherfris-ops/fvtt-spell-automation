import { registerBeamSpell } from "../core/beam-attacks.js";

/* Scorching Ray: 3 луча (+1 за уровень ячейки выше 2-го), отдельная атака на каждый */

export default {
  id: "scorching-ray",
  label: "Scorching Ray",
  hint: "Распределение лучей по целям, отдельный бросок атаки на каждый луч.",

  register() {
    registerBeamSpell({
      identifier: "scorching-ray",
      name: /^\s*(scorching ray|палящий луч|обжигающий луч)\s*$/i,
      noun: "Лучи",
      count: (item, scaling) => 3 + scaling,
      scaleDamage: false
    });
  },
};

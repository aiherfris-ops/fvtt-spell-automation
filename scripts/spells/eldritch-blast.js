import { registerBeamSpell } from "../core/beam-attacks.js";

/* Eldritch Blast: 1 луч, +1 на 5, 11 и 17 уровне персонажа; отдельная атака на каждый */

export default {
  id: "eldritch-blast",
  label: "Eldritch Blast",
  hint: "Число лучей по уровню персонажа, отдельный бросок атаки на каждый луч.",

  register() {
    registerBeamSpell({
      identifier: "eldritch-blast",
      name: /^\s*(eldritch blast|мистический заряд|сверхъестественный взрыв|потусторонний взрыв|жуткий взрыв)\s*$/i,
      noun: "Лучи",
      count: item => {
        const sys = item.actor?.system;
        const level = sys?.details?.level ?? sys?.attributes?.spell?.level ?? 1;
        return 1 + (level >= 5) + (level >= 11) + (level >= 17);
      },
      scaleDamage: true
    });
  },
};

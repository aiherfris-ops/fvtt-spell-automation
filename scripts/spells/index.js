/**
 * Все автоматизированные заклинания. Чтобы добавить новое — создайте файл spells/<заклинание>.js
 * (контракт — core/registry.js) и допишите его сюда.
 * Для заклинаний «несколько снарядов с атакой на каждый» используйте core/beam-attacks.js.
 */

import alterSelf from "./alter-self.js";
import ectoplasmicTrail from "./ectoplasmic-trail.js";
import eldritchBlast from "./eldritch-blast.js";
import faerieFire from "./faerie-fire.js";
import goodberry from "./goodberry.js";
import greaterRestoration from "./greater-restoration.js";
import heatMetal from "./heat-metal.js";
import healingWord from "./healing-word.js";
import huntersMark from "./hunters-mark.js";
import jimsMagicMissile from "./jims-magic-missile.js";
import lesserRestoration from "./lesser-restoration.js";
import magicMissile from "./magic-missile.js";
import mirrorImage from "./mirror-image.js";
import raySickness from "./ray-of-sickness.js";
import scorchingRay from "./scorching-ray.js";
import shadowBlade from "./shadow-blade.js";
import shield from "./shield.js";
import trueStrike from "./true-strike.js";

export default [
  alterSelf,
  ectoplasmicTrail,
  eldritchBlast,
  faerieFire,
  goodberry,
  greaterRestoration,
  healingWord,
  heatMetal,
  huntersMark,
  jimsMagicMissile,
  lesserRestoration,
  magicMissile,
  mirrorImage,
  raySickness,
  scorchingRay,
  shadowBlade,
  shield,
  trueStrike,
];

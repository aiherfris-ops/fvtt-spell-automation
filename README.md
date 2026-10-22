# Spell Automation

Автоматизация заклинаний **dnd5e** в Foundry VTT: исправляет импорт Plutonium и добавляет механику,
которой в данных нет, — множественные снаряды, эффекты, карточки урона, инструменты ГМа.

## Требования

- Foundry VTT 14
- dnd5e 5.3.x
- **midi-qol 14.6+ обязателен** (эта ветка собрана под него)
- Необязательно: Sequencer и JB2A (анимации круга телепортации)

## Заклинания

Magic Missile и Jim's Magic Missile (раздельный выбор целей, проверка Щита), Scorching Ray, Eldritch Blast
(несколько атак одним окном), Goodberry, Healing Word, Hunter's Mark, Faerie Fire, Mirror Image, Shield,
Ray of Sickness, Shadow Blade, Ectoplasmic Trail, Heat Metal, True Strike, Alter Self,
Lesser Restoration, Greater Restoration.

## Инструменты ГМа

- **Круг телепортации: прибытие** — персонажи появляются в заданной точке с анимацией и звуком.
- **Круг телепортации: отбытие** — забирает токены с поля списком или сферой заданного радиуса.

Макросы создаются автоматически при загрузке мира.

## Как устроено

- `scripts/spells/` — по файлу на заклинание, контракт `{ id, label, hint, identifiers, migrate(actor), register() }`.
  Каждое заклинание — отдельный переключатель в настройках.
- `scripts/core/` — диспетчер использования заклинаний, карточка урона с кнопкой «Применить»,
  общий модуль «несколько снарядов с атакой на каждый», кэш настроек, миграции.
- Режим проверки данных общий с Features Automation (вариант «Как в Features Automation»),
  либо собственные списки персонажей.

## Ветка `midiqol`

Это сборка под midi-qol: своих подпорок для работы без него здесь нет.

- Преимущество Faerie Fire и помеха Heat Metal — только флаги `flags.midi-qol.*`.
- Mirror Image слушает `midi-qol.AttackRollComplete`, Magic Missile распределяет дротики
  по `midi-qol.preDamageRoll`; перехвата `rollDamage` больше нет.
- Эффекты на чужих персонажах накладывает `MidiQOL.createEffects`, запрос к ГМу не нужен.
- Карточка урона следует настройке автоприменения самого midi.

Без midi-qol модуль не запускается и сообщает об этом в уведомлении. Универсальная версия
живёт в ветке `nomidiqol` — релизы собираются с неё.

## Установка

Скопировать папку модуля в `Data/modules/spell-automation` и включить в управлении модулями.

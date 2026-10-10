# Источники для развития Agent Motion Studio

Дата сверки: **10 октября 2026**. Каталог содержит **21 основной источник: /brag и все 20 позиций из присланного поста**. Это справочник к [единственному плану](PLAN_V0.2_RU.md), не дополнительный backlog и не команда установить все skills.

Все 20 коротких ссылок основного списка раскрыты до GitHub; исходные токены сохранены ниже. Для каждого репозитория получен README на зафиксированном commit SHA и сверено соответствие Git blob. Описание возможностей ниже — назначение по материалам автора, **не результат нашего сравнительного запуска**.

[Машиночитаемый реестр](MOTION_STACK_SOURCES.json) содержит все 21 ID, исходные и прямые ссылки, полные commit SHA, pinned README URLs, Git blob IDs и уровень чтения. Детальнее README изучены материалы 6 источников; остальные 15 имеют первичную сверку README.

## Уровни проверки

- **A — выборочно изучено глубже README:** SKILL, отдельные helpers либо QA/лицензионные материалы. Это не полный аудит репозитория.
- **B — первичная сверка README/официального описания:** источник доступен и его назначение установлено; реализация и пользовательский workflow не проверены.
- Ни A, ни B не означают новый успешный model run, человеческую приёмку, безопасность установки или превосходство над AMS. Опубликованные /brag-примеры отдельно декодировались; это не новый прогон генерации.

## Основной список

| ID | Источник | Уровень и слой | Что полезно для AMS / граница |
| --- | --- | --- | --- |
| S01 | **latent-spaces/brag** — /brag и /brag-slim | A; director workflow | Product inspection, hook, история, звук, итоговая упаковка. Full использует HyperFrames; slim делегирует реализацию модели. Не переносить poster-postprocess и backend-команды вслепую.[1] |
| S02 | **whaleyxbt/claude-motion** | A; motion/audio workflow | Режиссура, общий timing, procedural sound и review-loop с draft/contact sheets. Инструкции связаны с собственными Remotion/sim helpers.[2] |
| S03 | **howseen-ai/claude-motion-design** | A; HTML/Playwright/FFmpeg workflow | Director brief, frame probes, музыкальные акценты, диагностика вспышек/швов. Есть личные workdir/library references; описания не равны полностью переносимому окружению.[3] |
| S04 | **charlie947/motion-graphics-skills** | A; набор creative skills | Brand intake, `brand.md`/`MOTION.md`, brief и специализированные сценарии. Взять согласованный небольшой workflow, не все вкусовые правила сразу.[4] |
| S05 | **haidrrrry/claude-remotion-skill** | B; Remotion workflow | Motion graphics, captions, B-roll и звук. Рассматривать как альтернативный процесс с Remotion, не как расширение нашего Canvas API.[5] |
| S06 | **t3knobox/klik-anim-skill-creation** | B; craft + Remotion method | Законы движения, camera grammar, storyboard в rendered stills и QA в свежем контексте. Авторы отдельно предупреждают о модельных usage limits.[6] |
| S07 | **Sunwood-ai-labs/hyperframes-motion-reel-skill** | B; HyperFrames showreel recipe | Beat-synced reel, общая визуальная система и подготовка к рендеру. Не считать конфигурацию showreel универсальной нормой для любого продукта.[7] |
| S08 | **AbubakrChan/product-launch-motion** | B; product-launch direction | Voice/word timing, камера, звук, mastering и измеряемые проверки. Авторские результаты и сроки не перенесены на нашу машину/клиент.[8] |
| S09 | **cth9191/animate** | A; Canvas animation toolkit | Story/look/storyboard check-ins, style kits, сохранение нового look, `textcheck` и `framehash`. Проверки выборочные; это не доказательство качества всего MP4 или транзакционной истории.[9] |
| S10 | **iart-ai/motion-design-skills** | B; fundamentals + engine guidance | Timing, typography, color, composition, art direction и beat sync. Источник принципов, не обязательный новый backend.[10] |
| S11 | **nateherkai/hyperframes-student-kit** | A; editing kit + catalog | Footage/storytelling workflow, named slots и reusable cards. 406 cards имеют статус draft, а не индивидуально принятых recipes; сторонние assets имеют отдельные условия.[11] |
| S12 | **heygen-com/hyperframes** | B; renderer/studio/agent stack | Первый кандидат backend и основа сильного сравнения вместе с /brag. Официальные SDK/typed edits учитывать; не сравнивать с искусственно слабым свободным переписыванием HTML.[12] |
| S13 | **remotion-dev/remotion** | B; React video engine | Альтернативный renderer и Studio. Условия коммерческого использования проверять отдельно до выбора backend, не выводить их из лицензии стороннего skill.[13] |
| S14 | **remotion-dev/skills** | B; official agent skills | Рекомендуемый способ работы агента с Remotion: create, render, docs, Studio/interactivity. Использовать при честном сравнении Remotion-процесса.[14] |
| S15 | **greensock/GSAP** | B; animation library | Timeline/easing/choreography. Сам по себе не заменяет монтажный проект, историю и MP4 export; требует renderer и frame-driven интеграции.[15] |
| S16 | **LottieFiles/motion-design-skill** | B; engine-agnostic principles | Timing, easing, choreography, emotional intent и motion identity до реализации. Не путать с lottie-web runtime.[16] |
| S17 | **frankxai/awesome-motion-design-agent-skills** | B; curated resources + skills | Навигация по GSAP/Motion/Remotion/Lottie/Rive и motion QA. Вспомогательный каталог, не самостоятельная замена студии.[17] |
| S18 | **Barty-Bart/motion-graphics** | B; transcript/B-roll workflow | Графические вставки по transcript, compare/viewer и timing table. Упомянутый object-separation — отдельная ML-задача, не функция AMS и не текущий scope.[18] |
| S19 | **199-biotechnologies/motion-dev-animations-skill** | B; web-motion skill | Web interactions, springs, scroll/gesture motion. Не добавлять в основной путь создания фильма только ради присутствия в подборке.[19] |
| S20 | **motiondivision/motion** | B; React/JavaScript animation library | Библиотека движения для веба. Не самостоятельный формат видеопроекта или MP4-export pipeline.[20] |
| S21 | **airbnb/lottie-web** | B; vector-animation runtime | Проигрывание Lottie-анимаций. Возможный источник vector assets/идей, не приоритетная зависимость AMS сейчас.[21] |

Номера S02–S21 соответствуют позициям 1–20 поста. Дублирование похожих названий намеренно сохранено: S04, S10 и S16 — разные репозитории; S19 и S20 — skill и библиотека, не один продукт.

## Что читать первым

1. **S01 + S12:** сильная контрольная альтернатива для короткого product-launch фильма.
2. **S09:** story/look approvals, reusable styles и настоящие helpers проверки текста/кадров.
3. **S04 + S02:** сохранённый бренд, режиссёрская дисциплина, звук и review-loop.
4. **S03 + S08:** конкретные приёмы режиссуры и диагностики; сначала проверить переносимость и реальные сигналы failure.
5. **S11:** выбирать нужные карточки по задаче и проверять их с реальными данными; не переносить весь каталог ради количества.

Это порядок изучения, не разрешение копировать код, устанавливать зависимости или запускать платные services. Для procedural explainer альтернативой S01 + S12 может стать S09; не нужно тестировать все engines в одном пилоте.

## Правила заимствования

- Читать фактический LICENSE и notices выбранного snapshot. Публичность GitHub и поле `license` API сами по себе не дают универсального права на software, media, fonts, brand assets и reference material.
- Фиксировать repo, commit, конкретные файлы, тип использования, обязательные notices/credits и изменения адаптации.
- Для /brag уже проверено MIT-разрешение на software/instructions; музыка/SFX имеют отдельное происхождение. Не переносить их под Apache автоматически.
- Для student kit отдельно прочитаны root MIT с исключением AIS brand assets и permission для imported pipeline materials; не использовать чужой бренд как свой.
- Для остальных материалов первичная сверка README не заменяет лицензионную проверку перед переносом.
- Не ставить чужие skills глобально и не переносить их личные пути, housekeeping, credentials handling, модельный routing или browser flags без проверки.
- Numeric quality checks и модельные оценки не заменяют просмотра движения и прослушивания человеком. Выборочные PNG hashes не равны проверке всех decoded MP4 frames.

## Сопутствующие официальные материалы

Эти ссылки дополняют основные позиции, а не увеличивают список основных репозиториев:

- GSAP agent skills: https://github.com/greensock/gsap-skills
- Motion.dev: https://motion.dev/
- Его сопутствующая ссылка из поста `http://t.co/V19R87wQid` отдельно раскрыта в https://motion.dev/; сайт дополняет S19/S20 и не считается ещё одним репозиторием.
- HyperFrames SDK: https://hyperframes.heygen.com/developers/overview
- Remotion agent workflow: https://www.remotion.dev/docs/ai/skills

## Исходные ссылки из поста

Токены ниже сохранены как были присланы; раскрытие выполнялось HTTPS-запросом с тем же токеном после неуспешного HTTP-доступа. Ошибки экстрактора/HTTP не трактовались как отсутствие репозитория.

| Позиция поста | ID | Исходная ссылка |
| --- | --- | --- |
| 1 | S02 | `http://t.co/TtBtU2nVrN` |
| 2 | S03 | `http://t.co/iOsyrWUvKE` |
| 3 | S04 | `http://t.co/yNZhCZO8wT` |
| 4 | S05 | `http://t.co/immhzwVP5i` |
| 5 | S06 | `http://t.co/XWqUnn4v7o` |
| 6 | S07 | `http://t.co/E96s10io4Q` |
| 7 | S08 | `http://t.co/VBfllJ6j1K` |
| 8 | S09 | `http://t.co/xafT2UPXUe` |
| 9 | S10 | `http://t.co/gKUqO9P2Xe` |
| 10 | S11 | `http://t.co/fJmzb9I5z0` |
| 11 | S12 | `http://t.co/4rIffGKusx` |
| 12 | S13 | `http://t.co/o5zRdBgcS0` |
| 13 | S14 | `http://t.co/EieoL5Quaq` |
| 14 | S15 | `http://t.co/LYRTAx5wvF` |
| 15 | S16 | `http://t.co/Vgr318UX9h` |
| 16 | S17 | `http://t.co/hF0ZxWyjcI` |
| 17 | S18 | `http://t.co/Gwi9SKlS9C` |
| 18 | S19 | `http://t.co/YOL7zHaCB5` |
| 19 | S20 | `http://t.co/Jp9AReFaWe` |
| 20 | S21 | `http://t.co/TEG0FY4vFg` |

## Sources

[1] https://github.com/latent-spaces/brag
[2] https://github.com/whaleyxbt/claude-motion
[3] https://github.com/howseen-ai/claude-motion-design
[4] https://github.com/charlie947/motion-graphics-skills
[5] https://github.com/haidrrrry/claude-remotion-skill
[6] https://github.com/t3knobox/klik-anim-skill-creation
[7] https://github.com/Sunwood-ai-labs/hyperframes-motion-reel-skill
[8] https://github.com/AbubakrChan/product-launch-motion
[9] https://github.com/cth9191/animate
[10] https://github.com/iart-ai/motion-design-skills
[11] https://github.com/nateherkai/hyperframes-student-kit
[12] https://github.com/heygen-com/hyperframes
[13] https://github.com/remotion-dev/remotion
[14] https://github.com/remotion-dev/skills
[15] https://github.com/greensock/GSAP
[16] https://github.com/LottieFiles/motion-design-skill
[17] https://github.com/frankxai/awesome-motion-design-agent-skills
[18] https://github.com/Barty-Bart/motion-graphics
[19] https://github.com/199-biotechnologies/motion-dev-animations-skill
[20] https://github.com/motiondivision/motion
[21] https://github.com/airbnb/lottie-web

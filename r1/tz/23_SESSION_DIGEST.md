# Дайджест сессии Claude Code — всё для передачи в новую сессию

**Проект:** AI Авитолог PRO
**Автор:** Лера (saltykovatarget@gmail.com)
**Дата:** Июнь–Июль 2026
**Назначение:** передать контекст в новую сессию Claude Code — что обсудили, что установили, все ссылки

---

## 0. КОНТЕКСТ ПРОЕКТА

**AI Авитолог PRO** — сервис/ИИ-агент для работы с Авито:
- Парсер ниши + vision-анализ фото конкурентов
- AI-чат (GPT-5) даёт стратегию по объявлениям, VAS, позициям
- Telegram-агент (в планах)
- GEO-продвижение (чтобы нейросети рекомендовали)

**Инфраструктура:**
- Сервер (VPS Германия/Нидерланды): `186.246.30.227`
- Мокап мониторинга: `186.246.30.227:8080`
- Репозиторий: `saltykovatarget-crypto/avito-tools-mockup`
- Ветка разработки: `claude/add-server-monitoring-DKrj7`
- Дизайн-мокап: https://saltykovatarget-crypto.github.io/avito-tools-mockup/

**Команда:** Лера (продукт, стратегия) + Иван (разработчик, бэкенд/парсер)

---

## 1. УСТАНОВЛЕННЫЕ СКИЛЛЫ CLAUDE CODE

### GEO-SEO (15 скиллов) ✅ установлен
**Репо:** https://github.com/zubair-trabzada/geo-seo-claude
**Установка:**
```bash
curl -fsSL https://raw.githubusercontent.com/zubair-trabzada/geo-seo-claude/main/install.sh | bash
```
**Команды:** `/geo audit <url>`, `/geo citability <url>`, `/geo crawlers <url>`, `/geo llmstxt <url>`, `/geo report <url>`, `/geo report-pdf`
**Зачем:** оптимизация сайта под AI-поиск (ChatGPT, Claude, Perplexity, Gemini), генерация llms.txt, PDF-отчёты. Задача №1 в проекте.

### UI UX Pro Max (8 скиллов) ✅ установлен — ГЛАВНЫЙ ДЛЯ ДИЗАЙНА
**Репо:** https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
**Установка:**
```bash
git clone https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git
cp -r ui-ux-pro-max-skill/.claude/skills/* ~/.claude/skills/
```
**Скиллы:** `ui-ux-pro-max`, `design-system`, `design`, `brand`, `banner-design`, `slides`, `ui-styling`
**Что внутри:** 50+ стилей, 161 палитра, 57 шрифтовых пар, 161 тип продукта, 99 UX-правил, 25 типов графиков. Стеки: React, Next.js, Vue, Svelte, Tailwind, shadcn/ui, HTML/CSS.
**Зачем:** профессиональный дизайн сайта и лендинга AI Авитолог PRO.

### Marketing Skills (~40 скиллов) ✅ установлен
**Репо:** https://github.com/coreyhaines31/marketingskills
**Установка:**
```bash
git clone https://github.com/coreyhaines31/marketingskills.git
cp -r marketingskills/skills/* ~/.claude/skills/
```
**Скиллы:** seo-audit, ai-seo, programmatic-seo, emails, social, competitors, offers, marketing-plan, public-relations, referrals, copy-editing, prospecting, site-architecture, schema, free-tools и др.
**Зачем:** продвижение, лид-магниты, продающие тексты, анализ конкурентов, SEO.

### Remotion (видео) ✅ установлен
**Репо:** https://github.com/remotion-dev/skills
**Установка:**
```bash
npx skills add remotion-dev/skills
```
**Скилл:** `remotion-best-practices`
**Зачем:** создание анимированных видео в React (промо-ролики, контент). ⚠️ Рендер требует Chromium — в облачном контейнере блокируется загрузка, рендерить на своём компьютере/сервере.

---

## 2. СКИЛЛЫ ИЗ ПОДБОРКИ kirill.leeks (НЕ установлены — доставить при желании)

Источник: Notion «СКИЛЛЫ ДЛЯ CLAUDE» от kirill.leeks — «6 скиллов, которые реально меняют скорость работы».

| Скилл | Репо / ссылка | Что делает | Статус |
|---|---|---|---|
| Marketing Skills | github.com/coreyhaines31 | ~40 маркетинговых скиллов | ✅ установлен |
| UI UX Pro Max | github.com/nextlevelbuilder | дизайн сайтов как сеньор | ✅ установлен |
| Remotion Skill | github.com/wshuyi | анимированные видео | ⚠️ поставили вариант remotion-dev |
| Stop Slop Skill | github.com/hardikpandya | 8 правил, вычищает нейро-шаблонный текст | ❌ не установлен |
| Context Engineering Skills | github.com/muratcankoylan | уменьшает токены в ответах, агент не теряет нить | ❌ не установлен |
| Discovery Interview | awesomeskill.ai/skill/parcadei-continuous-claude-v3-discovery-interview | вытаскивает нормальное ТЗ через 10-15 вопросов | ❌ не установлен |

**Discovery Interview** — Лера отметила как «самый полезный»: превращает сырую идею в чёткое ТЗ. Стоит доставить.

---

## 3. УСТАНОВЛЕННЫЕ PYTHON-ПАКЕТЫ

### browser-use ✅
**Репо:** https://github.com/browser-use/browser-use
**Установка:** `pip install browser-use`
**Зачем:** ИИ управляет браузером (заполнение форм, сбор данных, автоматизация Авито-кабинета). ⚠️ Нужен API-ключ (OpenAI/Claude) + браузер на сервере.

### sentry-sdk ✅
**Репо:** https://github.com/getsentry/sentry
**Установка:** `pip install sentry-sdk`
**Зачем:** отслеживание ошибок в продакшне. Подключить к FastAPI-бэкенду при R1.

---

## 4. ИНСТРУМЕНТЫ КОМАНДЫ (обсуждали, репозитории — записаны в CLAUDE.md)

| Инструмент | Репо | Когда подключить |
|---|---|---|
| Sentry | github.com/getsentry/sentry | R1, к бэкенду сразу |
| Plausible | github.com/plausible/analytics | R1, к лендингу |
| Plane | github.com/makeplane/plane | сейчас, задачи команды |
| Docmost | github.com/docmost/docmost | после R1, база знаний |
| Inbox Zero | github.com/elie222/inbox-zero | после R1, почта клиентов |
| Formbricks | github.com/formbricks/formbricks | R1, опросы пользователей |
| Keycloak | github.com/keycloak/keycloak | R2, OAuth/SSO |
| TON/Telegram Pay | github.com/TegroTON/ai-telegram-pay-miniapp | при Telegram-агенте |
| Twenty CRM | github.com/twentyhq/twenty | первые 10+ клиентов |
| Composio | composio.dev | для Telegram-агента — коннекторы к 1000+ сервисам через MCP |

---

## 5. ЛИЧНЫЙ СТЕК ЛЕРЫ (в работе над проектом)

**ИИ-модели:** Claude (код/стратегия), ChatGPT GPT-5 (AI в продукте), Perplexity (ресёрч), NotebookLM (документы), Grok/DeepSeek/Qwen/Gemini (перепроверка), OpenRouter (один API ко всем).

**Контент:** Publora (автопубликация + MCP → контент-завод для GEO), ChatPlace/Virale (Instagram), Gamma (презентации), Kling/Higgsfield (видео), Turbo Scribe (транскрибация).

**Голос:** Aqua Voice (диктовка, Лера использует на 99.9%).

**Инфра:** VPS Германия/Нидерланды (186.246.30.227), Bot-t (конструктор TG-ботов), Tilda (лендинги).

**Дизайн:** Figma, Miro.

**Генерация презентаций (как у mama_mozg):** Claude Code + Nano Banana Pro (Google Gemini image 16:9) / Higgsfield для слайдов. Единый промт-стиль (мем-коллаж, #F5E94E acid-yellow) → 70+ слайдов автоматом.

---

## 6. ПАРСЕР — ГЛАВНОЕ ТЕХНИЧЕСКОЕ РЕШЕНИЕ

### Проблема Ивана
Парсер не работает с прокси — упирается в капчу/баны.

### Решение (документы созданы)
- `20_PARSER_ANTIBOT_FOR_IVAN.md` — полная anti-bot стратегия
- `21_PARSER_REPLY_TO_IVAN.md` — ответ на анализ Ивана

### Ключевые выводы
1. **Playwright + stealth + Xvfb (headless=False)** — не Selenium headless
2. **Мобильные прокси** (mobileproxy.space, Beeline, не Москва) — не дата-центровые
3. **curl_cffi** с `impersonate="chrome120"` — правильный TLS fingerprint
4. **Пул из 3-5 прогретых аккаунтов Авито** — один аккаунт = один прокси = один профиль
5. **Мобильный API Авито** — отдельный R&D, быстрее браузера

### Позиция Ивана (принята)
- `curl_detail` как primary (у него работает на 5/5 URL)
- Browser-fallback (Playwright+Xvfb) на этапе C
- AccountPool — усиление после MVP
- Не делать хаотичную ротацию UA

### Архитектура парсера
```
listing:   curl
detail:    curl_detail (primary)
photos:    из HTML
browser:   limited fallback (Playwright+Xvfb)
AccountPool: после MVP
```

Полное ТЗ парсера: `01_parser_integration.md`, `15_PARSER_VISION_ARCHITECTURE.md`

### Прокси через свой аккаунт для клиентов
Обсудили «сервисный аккаунт» — парсинг через аккаунты компании для всех клиентов.
- Плюс: высокий trust, не нужны покупные куки
- Минус: единая точка отказа, риск бана
- Решение: пул из 3-5 прогретых аккаунтов + ротация, прогревать 2-3 месяца

---

## 7. КОНЦЕПЦИЯ ПРОДУКТА КАК ИИ-АГЕНТА

Документ: `22_AI_AGENT_CONCEPT.md`

**Тезис:** AI Авитолог PRO = не «сервис аналитики», а автономный ИИ-агент.
- 🧠 Мозг (LLM) + 👁 Глаза (vision) + 🔧 Руки (инструменты) + 📚 Память (контекст)
- 3 уровня автономности: советует → делает с подтверждением → ведёт аккаунт сам
- Ценность: «ИИ-сотрудник вместо авитолога за 50к/мес»

**Формулировка для Сколково/инвесторов:**
> «Автономный ИИ-агент для управления продажами на маркетплейсах с компьютерным зрением и мультимодальным анализом»

---

## 8. РЕЗИДЕНТСТВО СКОЛКОВО

Обсудили — у AI Авитолог PRO хорошие шансы:
- ✅ AI/ML, компьютерное зрение, своя разработка, автономность
- Налоги: 0% прибыль, 0% НДС, 15% взносы
- Гранты: микрогранты до 1,5 млн, до 30+ млн
- Само резидентство бесплатно, заявка онлайн
- Подчёркивать: мультимодальность, автономное принятие решений, не «парсинг»

---

## 9. TELEGRAM-БОТ / АГЕНТ

### Что можно сделать
- **Уровень 1:** уведомления (парсер готов, позиция упала, баланс) — 1-2 дня
- **Уровень 2:** Telegram Mini App = сайт внутри Telegram, авторизация автоматом
- **Уровень 3:** AI-чат — консультант-авитолог (псевдо-человек)

### Совмещение с сервисом
Один бэкенд, два входа: сайт ↔ бот, общая БД, один пользователь.

### Проблема утечки гайдов из воронки
Решение: `protect_content=True` + уникальные ссылки на гайд + главная ценность в живом AI-диалоге (переслать нельзя).

### Быстрый MVP без бэкенда
Bot-t + Claude/GPT API + TON Pay = продавать пока Иван строит полную версию.

### Лид-магнит нового формата (образец mama_mozg)
Гайд «Утреннее письмо от ИИ» — красивый PDF, ведёт к главному промту в конце. Идея: сделать аналог «Твой личный ИИ-авитолог» — гайд + готовый промт как магнит воронки.

---

## 10. КОНТЕНТ-ФОРМУЛА ДЛЯ ПРОДВИЖЕНИЯ (из анализа блогеров)

Наблюдение по bymorozov/mama_mozg/kirill.leeks — все работают по формуле:
```
Хук (боль) → Карусель-гайд → Слайд с ГОТОВЫМ ПРОМТОМ → @ник → воронка
```
**Промт — новая валюта контента.** Люди сохраняют/репостят ради готового промта.

Применить к AI Авитолог PRO: пост «Преврати Claude в личного авитолога» + готовый промт «проанализируй мою нишу на Авито». Автопубликация через Publora (GEO).

---

## 11. СОЗДАННЫЕ ДОКУМЕНТЫ (в r1/tz/)

| Файл | Содержание |
|---|---|
| `20_PARSER_ANTIBOT_FOR_IVAN.md` | Anti-bot стратегия парсинга (полный код) |
| `21_PARSER_REPLY_TO_IVAN.md` | Ответ на анализ Ивана |
| `22_AI_AGENT_CONCEPT.md` | Концепция ИИ-агента (Сколково/инвесторы) |
| `23_SESSION_DIGEST.md` | Этот документ |

Плюс существующие: `01_parser_integration.md`, `15_PARSER_VISION_ARCHITECTURE.md`, `11_AI_SYSTEM_PROMPT.md` и др.

---

## 12. ОТКРЫТЫЕ ЗАДАЧИ (следующие шаги)

- [ ] Запустить `/geo audit` когда откроется сайт AI Авитолог PRO
- [ ] Переделать дизайн сайта через `ui-ux-pro-max`
- [ ] Починить паузы в промо-видео (Remotion)
- [ ] Написать бота-уведомлятора (парсер готов → Telegram)
- [ ] Создать 3 аккаунта Авито и начать прогрев (для парсера)
- [ ] Купить 3 мобильных прокси (mobileproxy.space)
- [ ] Подать заявку в Сколково
- [ ] Настроить Obsidian ↔ git синхронизацию (Obsidian Git плагин)
- [ ] Доставить скилл Discovery Interview (самый полезный по мнению Леры)

---

## ВАЖНЫЕ ЗАМЕТКИ ДЛЯ НОВОЙ СЕССИИ

1. **Обращаться к пользователю по имени — Лера.**
2. Всё в этом облачном контейнере (пакеты, скиллы) — временное, сбрасывается. Постоянное — только в git.
3. Скиллы устанавливать в `~/.claude/skills/`.
4. Развитие — на ветке `claude/add-server-monitoring-DKrj7`, коммитить и пушить.
5. Иван работает над парсером — не переписывать его curl-подход, уважать production-факт.

---

**Контакт:** Лера, saltykovatarget@gmail.com

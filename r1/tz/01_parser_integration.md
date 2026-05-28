# ТЗ — Парсер ниши Авито: интеграция в AI Авитолог PRO

**Автор:** Лера (saltykovatarget@gmail.com)
**Версия:** 1.0
**Дата:** 27.05.2026

---

## 1. Продуктовое позиционирование

**Парсер ниши — самостоятельный продукт И инструмент чата AI Авитолога.**

Двусторонний cross-sell:
- Юзер пришёл **на парсер напрямую** → получил отчёт → CTA «Расшифровать с AI Авитологом» → попадает в чат с предзагруженным брифом
- Юзер пришёл **в чат AI** → дошёл до Шага 1 (анализ конкурентов) → AI продаёт парсер → юзер запускает прямо из чата → результат сразу в чате с интерпретацией

Один и тот же продукт, два разных входа, разные сценарии использования.

---

## 2. Два сценария пользователя

### Сценарий A — Парсер как самостоятельный вход

```
1. Юзер заходит на aiavitologpro.ru/parser
2. Видит лендинг: «Парсер ниши Авито — 190 ₽ за анализ»
3. Авторизация (или регистрация)
4. Форма: URL Авито + страницы + режим (все/уникальные продавцы)
5. Списываем 190 ₽ с баланса (если нет — оплата ЮКассой)
6. Парсер запускается в очереди → юзер видит прогресс на странице
7. Через ~15-20 мин → готовый отчёт:
   - KPI-блок (объявлений / продавцов / медиана / VAS%)
   - Топ-10 объявлений (фото, заголовки, просмотры)
   - 🏆 Кто забирает просмотры (5 лидеров с барами)
   - Кнопка «📥 Скачать XLSX»
   - 🟢 БОЛЬШАЯ КНОПКА «🤖 Расшифровать с AI Авитологом → Чат»
        ↓ при нажатии
   - Создаётся новый чат, в первое сообщение от AI автоматически
     вставляется бриф этого прогона
   - AI приветствует: «Я разобрал твой анализ ниши, давай начнём с...»
```

### Сценарий B — Парсер как инструмент чата

```
1. Юзер в чате с AI Авитологом
2. Доходит до Шага 1 (анализ конкурентов)
3. AI присылает карточку:
   ┌──────────────────────────────────────┐
   │ 🔍 Анализ конкурентов                │
   │ ~10 минут, 150 объявлений с фото     │
   │ [URL Авито ____________]              │
   │ Режим: [Полный ▼] Страниц: [3 ▼]    │
   │           [Запустить — 190 ₽]        │
   └──────────────────────────────────────┘
4. Юзер заполняет, жмёт «Запустить» (списываем 190 ₽)
5. Карточка в чате обновляется живым прогрессом:
   ✓ Выдача (150 объявлений)
   ⏳ Детали 87/150
   ⏳ Аккаунты
6. По завершении карточка превращается в результат:
   - KPI-блок
   - Топ-10 фото (горизонтальный скролл)
   - Текст AI-анализа сразу под цифрами
   - Кнопки: «📊 Открыть полный отчёт» (новая вкладка с HTML)
             «📥 Скачать XLSX»
             «➡ Продолжить → Шаг 2»
7. AI пишет следующее сообщение с разбором ниши
8. Юзер переходит к Шагу 2 (сегментация аудитории)
```

---

## 3. Архитектура (high-level)

```
┌──────────────────────────────────────────────────────────────────┐
│                      AI АВИТОЛОГ PRO SaaS                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [Frontend React]                                                 │
│    /parser           ← страница парсера (Сценарий A)             │
│    /parser/jobs/:id  ← страница отчёта                           │
│    /chat             ← чат с AI (Сценарий B), встраивает карточку│
│                                                                   │
│         ↓ ↑ (REST + SSE для прогресса)                           │
│                                                                   │
│  [Backend FastAPI]                                                │
│    /api/parse/*           ← для юзера в кабинете                 │
│    /api/internal/parser/* ← для парсер-сервиса (X-Parser-Token)  │
│                                                                   │
│         ↓                                                         │
│                                                                   │
│  [PostgreSQL]  ParseJob, ParseReport                              │
│                                                                   │
│         ↑ опрос /internal/parser/jobs/next                       │
│                                                                   │
│  [Парсер-сервис на VPS]                                           │
│    Playwright + Xvfb + мобильный прокси                          │
│    Опрашивает backend → парсит → отдаёт JSON                    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Backend ТЗ

### 4.1 Новые модели

**`app/models/parse_job.py`**
```python
class ParseJobStatus(str, Enum):
    queued    = "queued"      # в очереди
    running   = "running"     # парсится сейчас
    done      = "done"        # готово
    failed    = "failed"      # ошибка
    cancelled = "cancelled"   # отменён юзером


class ParseJob(Base):
    __tablename__ = "parse_jobs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))

    # Параметры прогона
    url: Mapped[str]                           # URL выдачи Авито
    pages: Mapped[int] = mapped_column(default=3)
    unique_sellers: Mapped[bool] = mapped_column(default=False)

    # Статус
    status: Mapped[ParseJobStatus] = mapped_column(default=ParseJobStatus.queued)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    # progress = {"stage": "details", "current": 87, "total": 150, "log": ["..."]}

    error: Mapped[str | None]

    # Биллинг
    cost_kopeks: Mapped[int] = mapped_column(default=19000)  # 190 ₽

    # Результат (заполняется парсером по завершении)
    result_json: Mapped[dict | None] = mapped_column(JSON)
    # result_json = весь output парсера: meta, items, accounts, stats

    # AI-анализ (генерится после готовности парсера)
    ai_brief: Mapped[str | None]               # тот же бриф что в build_brief()
    ai_analysis: Mapped[str | None]            # ответ GPT на бриф

    # Привязка к чату (если запускался из чата)
    source: Mapped[str] = mapped_column(default="direct")  # "direct" | "chat"
    chat_id: Mapped[UUID | None] = mapped_column(ForeignKey("chats.id"))

    # Тайминги
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
```

**Миграция Alembic:** одна, новая таблица `parse_jobs`, индексы по `user_id`, `status`, `created_at`.

### 4.2 Эндпоинты для юзера (`/api/parse/*`)

```
POST   /api/parse/start              запустить прогон, списать 190 ₽, создать job
       body: {url, pages, unique_sellers, source: "direct"|"chat", chat_id?}
       resp: {job_id, status}

GET    /api/parse/jobs               список моих прогонов (пагинация)
       resp: [{id, url, status, created_at, query, total_ads}]

GET    /api/parse/jobs/{id}          детали + статус
       resp: {ParseJob} включая result_json если готово

GET    /api/parse/jobs/{id}/stream   SSE-стрим прогресса
       events: progress {stage, current, total}, log, done, failed

GET    /api/parse/jobs/{id}/xlsx     отдать XLSX-файл (стрим)
GET    /api/parse/jobs/{id}/html     отдать HTML-отчёт (стрим)
GET    /api/parse/jobs/{id}/brief    отдать текст брифа

POST   /api/parse/jobs/{id}/to-chat  создать новый чат с предзагруженным брифом
       resp: {chat_id} — фронт редиректит на /chat/{chat_id}

POST   /api/parse/jobs/{id}/cancel   отменить, вернуть кредиты если ещё в queued
```

### 4.3 Эндпоинты для парсер-сервиса (`/api/internal/parser/*`)

Защищены `X-Parser-Token` header (паттерн как в `internal_bot.py`).

```
GET    /api/internal/parser/jobs/next?worker_id=...
       resp: {id, url, pages, unique_sellers} | null (если очередь пуста)
       side-effect: status=running, started_at=now

POST   /api/internal/parser/jobs/{id}/progress
       body: {stage, current, total, log_line?}
       side-effect: обновляет progress, пушит в SSE-стрим юзеру

POST   /api/internal/parser/jobs/{id}/result
       body: {result_json: {...}}
       side-effect: status=done, finished_at=now
                    → триггерит AI-анализ (фоновая задача)
                    → пушит TG-уведомление юзеру

POST   /api/internal/parser/jobs/{id}/failed
       body: {error: "..."}
       side-effect: status=failed, возвращает кредиты юзеру
```

### 4.4 AI-анализ после готовности

После `POST /jobs/{id}/result` backend в фоновой задаче (Celery / APScheduler):

```python
async def generate_ai_analysis(job_id: UUID):
    job = await db.get(ParseJob, job_id)

    # 1. Генерим бриф локально (импорт из парсера или своя копия build_brief)
    brief = build_brief(job.result_json)
    job.ai_brief = brief

    # 2. Отправляем в OpenAI с системным промптом «Ты AI Авитолог...»
    response = await openai_client.responses.create(
        model="gpt-5",
        input=[
            {"role": "system", "content": SYSTEM_PROMPT_AVITOLOG},
            {"role": "user", "content": brief},
        ],
    )
    job.ai_analysis = response.output_text
    await db.commit()

    # 3. Если source=chat — добавляем сообщение в чат
    if job.source == "chat" and job.chat_id:
        await append_chat_message(job.chat_id, job.ai_analysis, role="assistant")

    # 4. TG-уведомление
    await send_tg_notification(job.user_id, f"Анализ ниши «{query}» готов!")
```

### 4.5 Биллинг

При `POST /api/parse/start`:
1. Проверить `user.credits_balance >= 19000` (в копейках)
2. Списать: `user.credits_balance -= 19000`
3. Создать transaction record
4. Если баланс < 19000 → 402 Payment Required, фронт ведёт на оплату

При `POST /jobs/{id}/failed`:
1. Вернуть `user.credits_balance += 19000`
2. Создать refund transaction

---

## 5. Frontend ТЗ

### 5.1 Страница `/parser` — Сценарий A

```
┌─────────────────────────────────────────────────────────────┐
│  Парсер ниши Авито                              [Баланс: ₽] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   🔍 Узнай за 20 минут кто твои конкуренты                  │
│   и как с ними играть                                       │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ Ссылка на выдачу Авито                                │  │
│   │ [_____________________________________________]        │  │
│   │ Скопируй URL из адресной строки со всеми фильтрами   │  │
│   │                                                        │  │
│   │ Страниц: [3 ▼]    Продавцы: ● Все ○ Уникальные      │  │
│   │                                                        │  │
│   │              [Запустить анализ — 190 ₽]               │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│   Что внутри отчёта:                                         │
│   ✓ Топ-10 объявлений с фото и просмотрами                  │
│   ✓ Кто доминирует — главные хищники внимания               │
│   ✓ Доля рынка каждого аккаунта                             │
│   ✓ Цены, медиана, VAS-стратегия                            │
│   ✓ Скачать XLSX                                            │
│   ✓ 🤖 Расшифровать с AI Авитологом — стратегия входа      │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  МОИ ПРОГОНЫ                                                 │
│  ─────────────────────────────────────────────────────────  │
│  ✅ Ворота гаражные · Москва · 27 мая            [Открыть]  │
│  ⏳ Юрист грузоперевозчики · идёт 87/150                    │
│  ✅ Юрист грузоперевозчики · 20 мая              [Открыть]  │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Страница `/parser/jobs/{id}` — Отчёт

Использует наш текущий HTML-вид (`html_exporter.py`), встроенный как iframe или отрендеренный React-компонентом из JSON.

Сверху над отчётом — sticky bar:
```
[← Назад]   Ворота гаражные · Москва · 27 мая
                                    [📥 XLSX] [🤖 Расшифровать с AI →]
```

«Расшифровать с AI» вызывает `POST /api/parse/jobs/{id}/to-chat` → редирект на `/chat/{new_chat_id}`.

### 5.3 Компонент `<ParserCard>` для чата (Сценарий B)

Три состояния одной карточки:

**Состояние 1: Форма**
```
┌──────────────────────────────────────────────┐
│ 🔍 Анализ конкурентов                         │
│ ~10 минут, 150 объявлений с фото              │
│ ┌──────────────────────────────────────────┐ │
│ │ URL Авито: [____________________]         │ │
│ │ Страниц: [3 ▼]                            │ │
│ └──────────────────────────────────────────┘ │
│         [Запустить — 190 ₽]                   │
└──────────────────────────────────────────────┘
```

**Состояние 2: Прогресс** (через SSE)
```
┌──────────────────────────────────────────────┐
│ 🔍 Парсер работает...                         │
│ ✓ Выдача — 150 объявлений                     │
│ ⏳ Детали 87/150 (~7 мин)                     │
│ □ Аккаунты                                    │
│              [⏹ Остановить]                   │
└──────────────────────────────────────────────┘
```

**Состояние 3: Результат**
```
┌──────────────────────────────────────────────┐
│ ✅ Анализ ниши «ворота гаражные»             │
│                                                │
│  ┌─────┬─────┬─────┬─────┐                   │
│  │ 150 │ 19  │ 78% │ ×5  │                   │
│  │объяв│акк. │ VAS │выгод│                   │
│  └─────┴─────┴─────┴─────┘                   │
│                                                │
│  Топ-10 фото:                                 │
│  [🚪948] [🚪891] [🚪437] [🚪...] →           │
│                                                │
│  [📊 Открыть полный отчёт] [📥 XLSX]         │
│                                                │
│  ─────────────────────────────                │
│  💬 AI: Ниша насыщенная, лидер DoorHan...    │
│         (анализ продолжается в чате ниже)    │
└──────────────────────────────────────────────┘
```

### 5.4 React-структура

```
src/
├── pages/
│   ├── Parser/
│   │   ├── ParserLanding.tsx          # /parser — форма + история
│   │   ├── ParserJobPage.tsx          # /parser/jobs/{id} — отчёт
│   │   └── ParserPaymentRequired.tsx  # если баланс < 190
│   └── Chat/
│       └── ChatPage.tsx               # уже есть
├── components/
│   ├── parser/
│   │   ├── ParserCard.tsx             # карточка для чата (3 состояния)
│   │   ├── ParserReportView.tsx       # рендер отчёта из JSON
│   │   ├── TopAdsCarousel.tsx         # горизонтальный скролл фото
│   │   ├── DominanceBlock.tsx         # хищники внимания
│   │   └── ParserHistoryList.tsx      # список прогонов
│   └── shared/
│       └── KPICard.tsx
├── api/
│   └── parser.ts                      # клиент для /api/parse/*
└── hooks/
    └── useParserStream.ts             # SSE-стрим прогресса
```

---

## 6. Парсер-сервис ТЗ (VPS)

Текущий код `~/Desktop/avito_parser` переезжает в `/opt/parser` на VPS и превращается в worker-сервис.

### 6.1 Изменения в коде

**1. Переход с undetected_chromedriver на Playwright + stealth**
По образцу avito-monitor (`~/Desktop/avito-monitor/monitor.py:179-230`):
- `from playwright.sync_api import sync_playwright`
- `playwright_stealth.Stealth().apply_stealth_sync(page)`
- Системный Chrome `/opt/google/chrome/chrome`
- Xvfb (не headless) — Авито детектирует headless

**2. Мобильный прокси**
`PROXY_URL=http://login:pass@host:port` в env. Парсить через `playwright.chromium.launch(proxy={...})`.

**3. Worker-режим вместо CLI**
Новый файл `worker.py`:
```python
import time, requests
from main import run_full_pipeline

BACKEND = "https://api.aiavitologpro.ru"
TOKEN = os.environ["PARSER_TOKEN"]
WORKER_ID = os.environ.get("WORKER_ID", socket.gethostname())

def loop():
    while True:
        # Берём job
        r = requests.get(f"{BACKEND}/api/internal/parser/jobs/next",
                         params={"worker_id": WORKER_ID},
                         headers={"X-Parser-Token": TOKEN}, timeout=10)
        job = r.json()
        if not job:
            time.sleep(30)
            continue

        try:
            # Парсим с прогресс-колбэком
            def progress(stage, current, total):
                requests.post(f"{BACKEND}/api/internal/parser/jobs/{job['id']}/progress",
                              json={"stage": stage, "current": current, "total": total},
                              headers={"X-Parser-Token": TOKEN}, timeout=10)

            result = run_full_pipeline(
                url=job["url"],
                pages=job["pages"],
                unique_sellers=job["unique_sellers"],
                on_progress=progress,
            )

            # Отдаём результат
            requests.post(f"{BACKEND}/api/internal/parser/jobs/{job['id']}/result",
                          json={"result_json": result},
                          headers={"X-Parser-Token": TOKEN}, timeout=30)

        except Exception as e:
            requests.post(f"{BACKEND}/api/internal/parser/jobs/{job['id']}/failed",
                          json={"error": str(e)[:500]},
                          headers={"X-Parser-Token": TOKEN}, timeout=10)
```

### 6.2 systemd-сервис

`/etc/systemd/system/avitolog-parser.service`:
```ini
[Unit]
Description=AI Avitolog PRO Parser Worker
After=network.target

[Service]
Type=simple
User=parser
WorkingDirectory=/opt/parser
ExecStartPre=/bin/bash -c 'pkill Xvfb 2>/dev/null; sleep 1; Xvfb :99 -screen 0 1280x800x24 -ac &'
ExecStartPre=/bin/sleep 3
Environment=DISPLAY=:99
Environment=PARSER_TOKEN=...
Environment=PROXY_URL=http://login:pass@host:port
ExecStart=/opt/parser/.venv/bin/python worker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 6.3 Масштабирование

Один worker = один Chrome = последовательная обработка.
Для масштаба: N workers с разными `WORKER_ID`, каждый со своим прокси.
Backend `/jobs/next` отдаёт по одному job на запрос — конкуренция в очереди решается через `SELECT ... FOR UPDATE SKIP LOCKED`.

---

## 7. Пошаговый план внедрения

### Этап 0 — Подготовка (готово / в процессе)
- ✅ Парсер на Mac работает (нестабильно, но работает)
- ✅ JSON-выход стабилен
- ✅ HTML-отчёт с фото
- ✅ XLSX-экспорт
- ✅ Бриф для AI
- ✅ Сравнение прогонов

### Этап 1 — Парсер-сервис на VPS (3-4 дня)
1. Купить VPS Timeweb (2GB RAM, Ubuntu 22.04) — или взять рядом с avito-monitor
2. Поставить Chrome, Xvfb, Python 3.10
3. Мигрировать `scraper.py`, `detail_scraper.py`, `account_scraper.py` с undetected_chromedriver на Playwright + stealth
4. Купить мобильный прокси на mobileproxy.space (Beeline, не Москва — как у монитора)
5. Тест: запустить полный прогон на VPS, убедиться что не детектится
6. Стабильность: 5 прогонов подряд должны пройти без падения

### Этап 2 — Backend (3-4 дня)
1. Модель `ParseJob` + миграция Alembic
2. Эндпоинты `/api/parse/*` (start, jobs list, jobs detail, xlsx, html, brief, to-chat, cancel)
3. Эндпоинты `/api/internal/parser/*` (next, progress, result, failed) с X-Parser-Token
4. Биллинг: списание 190 ₽ при start, возврат при failed
5. SSE-стрим прогресса
6. Фоновая задача AI-анализа (Celery / APScheduler)
7. Интеграция с TG-уведомлениями (через существующий `_send_tg`)

### Этап 3 — Worker подключается к backend (1 день)
1. В `/opt/parser` написать `worker.py` (loop с polling)
2. Прописать `PARSER_TOKEN`, `BACKEND_URL`, `WORKER_ID` в env
3. systemd-сервис
4. Тест end-to-end: создать job через `/api/parse/start` (curl) → worker берёт → парсит → результат в БД

### Этап 4 — Frontend (5-7 дней)
1. Страница `/parser` (форма + история) — Сценарий A
2. Страница `/parser/jobs/{id}` (отчёт)
   - Использует React-компонент `<ParserReportView>` который рендерит из JSON (берёт логику из нашего `html_exporter.py`)
3. Sticky bar «Скачать XLSX / Расшифровать с AI»
4. Компонент `<ParserCard>` для встраивания в чат (3 состояния)
5. `useParserStream` хук для SSE
6. Интеграция с биллингом (если баланс < 190 → редирект на оплату)

### Этап 5 — Чат-инструмент (3-4 дня)
1. Tool calling / function calling: в системном промпте AI Авитолога описать инструмент «парсер»
2. При вызове tool — backend создаёт ParseJob с `source=chat, chat_id=...`
3. В чат UI добавить рендер `<ParserCard>` когда AI вызвал tool
4. После результата — auto-сообщение AI с `ai_analysis` появляется в чате
5. Кнопка «Продолжить → Шаг 2» — заглушка пока

### Этап 6 — Cross-sell (2 дня)
1. На странице отчёта (`/parser/jobs/{id}`) — большая кнопка «Расшифровать с AI» → создаёт чат с предзагруженным брифом
2. В чате при первом входе на Шаг 1 — AI присылает `<ParserCard>`
3. Email/TG-капельницы: «У тебя есть отчёт от X, давно не открывал — давай расшифруем»

---

## 8. Цифры

**Сроки:** 15-20 рабочих дней одним разработчиком (full-stack)
- Этап 1: 3-4 дня (VPS + Playwright)
- Этап 2: 3-4 дня (Backend)
- Этап 3: 1 день (Worker)
- Этап 4: 5-7 дней (Frontend)
- Этап 5: 3-4 дня (Chat-tool)
- Этап 6: 2 дня (Cross-sell)

**Косты на инфру:**
- VPS Timeweb 2GB: ~600 ₽/мес
- Мобильный прокси: ~1500 ₽/мес (один)
- При масштабе: +1500 ₽/мес за каждые ~20 одновременных пользователей
- GPT-5 API на AI-анализ: ~5 ₽/прогон при средней нагрузке

**Юнит-экономика прогона:**
- Доход: 190 ₽
- Прямые расходы: ~10 ₽ (доля прокси + GPT + электричество)
- Маржа: ~180 ₽ с прогона

---

## 9. Открытые вопросы для разработчика

1. **Очередь:** PostgreSQL + `SELECT FOR UPDATE SKIP LOCKED` или Redis Streams / RabbitMQ?
   Рекомендую: PG для старта (одна зависимость меньше).

2. **Хранилище JSON:** в колонке `result_json JSONB` или отдельный объектный сторэдж?
   Рекомендую: JSONB для старта. ~50 объявлений = ~600KB JSON, до 1000 прогонов влезет легко.

3. **SSE vs WebSocket:** SSE проще, достаточно для прогресса.
   Рекомендую: SSE.

4. **AI-анализ:** синхронно после парсинга или по запросу юзера?
   Рекомендую: автоматически после, всегда. Уже включено в цену 190 ₽.

5. **Доступ к старым отчётам:** хранить вечно или 30/90 дней?
   Рекомендую: вечно. Они занимают копейки в JSONB.

6. **Перезапуск failed:** автоматический ретрай или ручной?
   Рекомендую: 1 автоматический ретрай при таймаутах, при capсhe — без ретрая.

---

## 10. Файлы которые передаются разработчику

1. **Этот документ** (`ТЗ_парсер_интеграция.md`)
2. **Исходники парсера** (`~/Desktop/avito_parser/`) — рабочий код, надо мигрировать на Playwright
3. **Образец работающего сервиса с Playwright** (`~/Desktop/avito-monitor/`) — VPS-сетап и паттерны
4. **Backend-проект** (`~/Desktop/avitolog-2026-05-15-lite-for-audit/app/`) — куда добавляем эндпоинты
5. **Шаблон internal API** (`~/Desktop/backend_patch/internal_bot.py`) — паттерн для `internal_parser.py`
6. **HTML-рендер отчёта** (`~/Desktop/avito_parser/html_exporter.py`) — основа для React-компонента
7. **Дизайн-мокап** — https://saltykovatarget-crypto.github.io/avito-tools-mockup/ экраны 3-5

---

**Контакт:** Лера, saltykovatarget@gmail.com

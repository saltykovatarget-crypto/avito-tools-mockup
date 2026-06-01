# ТЗ — Дополнение к интеграции парсера: кабинет, кошелёк, биллинг, единая абстракция инструментов

**Автор:** Лера (saltykovatarget@gmail.com)
**Версия:** 2.0 (финальная для R1)
**Дата:** 2026-05-28
**Дополнение к:** `ТЗ_парсер_интеграция.md`

---

## 🎨 Мокапы UI (онлайн, кликабельны, тёмная/светлая темы)

**Все экраны R1 доступны для предпросмотра:**

👉 **https://saltykovatarget-crypto.github.io/avito-tools-mockup/r1/**

Конкретные страницы:
- [Дашборд кабинета](https://saltykovatarget-crypto.github.io/avito-tools-mockup/r1/cabinet.html)
- [Парсер — форма + история](https://saltykovatarget-crypto.github.io/avito-tools-mockup/r1/parser.html)
- [Парсер — отчёт по прогону](https://saltykovatarget-crypto.github.io/avito-tools-mockup/r1/parser-report.html)
- [Биллинг и подписка](https://saltykovatarget-crypto.github.io/avito-tools-mockup/r1/billing.html)
- [Кошелёк — пакеты парсера](https://saltykovatarget-crypto.github.io/avito-tools-mockup/r1/wallet.html)

Стиль сверен с реальным `localhost:5173`. Палитра, типографика и компоненты используют те же CSS-переменные, что и текущий `app/src/index.css`.

---

## 0. Зачем это дополнение

В оригинальном ТЗ парсер описан как отдельная фича со своей таблицей `ParseJob` и эндпоинтами `/api/parse/*`. Это корректно для одного инструмента, но AI Авитолог PRO планирует ещё 9 инструментов под методологию из 10 шагов.

Поэтому **парсер с самого начала делается как первый экземпляр обобщённой абстракции `ToolRun`**. Также вводится **кошелёк парсера** (счётчик прогонов из купленных пакетов) и **гибридная модель списания** (квота подписки → пакет из кошелька → пейволл).

Дополнительные затраты: +1 день на абстракцию, +1 день на frontend кошелька — итого ~17–22 рабочих дня вместо 15–20 в оригинальном ТЗ.

---

## 1. Финальные цены и модели (зафиксировано)

### 1.1 Тарифы подписки (без изменений)

Уже в коде `app/src/lib/plansCatalog.ts` и `backend/app/services/billing_plans.py`:

| План | ID | Цена/мес | AI-запросы | Парсер в подарок/мес |
|---|---|---|---|---|
| free | `free` | 0 | 15 lifetime | 0 (+1 промо при регистрации) |
| Базовый | `basic` | 1 590 ₽ | 100 | **1** |
| Профессиональный | `plus` | 4 290 ₽ | 300 | **5** |
| Агентский | `premium` | 9 990 ₽ | 750 | **15** |

Квота парсера в подписках обнуляется в первый день каждого месяца подписки. Не переносится.

### 1.1.1 ⚠️ ВАЖНО: модель подписки

- **Автопродления НЕТ.** Юзер сам платит каждый месяц через кнопку «Продлить ещё на месяц».
- **Годовых тарифов НЕТ.** Только помесячно.
- **Не нужны:** cron-задачи на автосписание, объект Subscription со статусом cancelled, поля `auto_renew`, `cancel_at`, `period`.
- **Достаточно:** `users.plan` + `users.plan_until` (уже есть в коде).
- В UI **не показывать:** «изменить способ оплаты», «отменить подписку», переключатель «месяц/год», скидку «−15%/год».
- Поле `yearlyPriceRub` в `plansCatalog.ts` существует, но **не используется** — игнорировать.
- «Следующее списание» → **«Действует до»** (в API и UI).

### 1.2 Парсер: пакеты на кошелёк (pay-per-use)

| Пакет | ID | Цена | Прогонов | За прогон | Скидка | Срок |
|---|---|---|---|---|---|---|
| 1 разовый | `single` | 190 ₽ | 1 | 190 ₽ | — | бессрочно |
| Пакет 5 | `pack5` | 790 ₽ | 5 | 158 ₽ | −17% | 30 дней |
| Пакет 15 | `pack15` | 1 990 ₽ | 15 | 133 ₽ | −30% | 30 дней |
| Пакет 50 | `pack50` | 4 990 ₽ | 50 | 100 ₽ | −47% | 30 дней |

```python
PARSER_PACKAGES = {
    "single": {"runs": 1,  "price_kopeks": 19_000,  "valid_days": None},
    "pack5":  {"runs": 5,  "price_kopeks": 79_000,  "valid_days": 30},
    "pack15": {"runs": 15, "price_kopeks": 199_000, "valid_days": 30},
    "pack50": {"runs": 50, "price_kopeks": 499_000, "valid_days": 30},
}
```

### 1.3 Промо при регистрации

- Все новые юзеры (включая free) получают **+1 промо-прогон парсера** при первой регистрации
- Lifetime, не ежемесячный
- Списывается из отдельного счётчика `promo_runs_remaining` либо помечается флагом транзакции

### 1.4 Логика списания при запуске парсера

Порядок проверки (стопаемся на первом источнике с балансом):

```python
async def charge_parser_run(user: User) -> ChargeResult:
    # 1. Промо-прогон (если ещё не использован)
    if user.promo_runs_remaining > 0:
        user.promo_runs_remaining -= 1
        return ChargeResult(source="promo", charged=0)

    # 2. Квота подписки (если есть и не кончилась)
    if user.has_active_subscription() and user.subscription_quota_remaining("parser") > 0:
        user.consume_subscription_quota("parser")
        return ChargeResult(source="quota", charged=0)

    # 3. Пакет на кошельке (FIFO по сроку — сначала те что ближе к истечению)
    pack = user.get_oldest_active_parser_pack()
    if pack and pack.runs_remaining > 0:
        pack.runs_remaining -= 1
        return ChargeResult(source="pack", charged=0, pack_id=pack.id)

    # 4. Нет ничего → 402 → фронт показывает /app/wallet
    raise InsufficientFundsError()
```

### 1.5 Возврат при failed

При `POST /api/internal/tools/runs/{id}/failed`:
- Если списано из промо/квоты/пакета → восстанавливаем тот же источник
- Записываем `WalletTransaction(kind="refund", source=<original>)`

---

## 2. Лимиты парсера

| Параметр | R1 | R2+ |
|---|---|---|
| Стандартный режим | до **200 объявлений** (4 страницы) | без изменений |
| Время прогона | ~20 мин | — |
| Цена | 190 ₽ (или из квоты) | — |
| Расширенный режим (до 500 объявлений) | ❌ | +200 ₽ доплата |
| Экспресс режим (~5 мин) | ❌ | +100 ₽ доплата |
| Максимум одновременных прогонов на юзера | 1 | 3 для Agency |

**Маркетинг лимита 200:** не «ограничение», а «топ-200 объявлений = весь активный рынок». Это позиционирование, не ограничение.

---

## 3. Модели AI

| Где | Модель | На R1 | Почему |
|---|---|---|---|
| Чат с юзером | `gpt-5-mini` (как сейчас) | **БЕЗ ИЗМЕНЕНИЙ** | Маржа 97%, OpenAI Vector Store работает, релиз не задерживается |
| AI-разбор отчёта парсера | **Claude Sonnet 4.6** с prompt caching | **новое** | Качество русского аналитического текста +30% vs GPT, ~3 ₽/прогон |

**В клиентских интерфейсах НИКОГДА не упоминаем модель/вендор.** AI везде называется «AI Авитолог». В коде — да, в UI — нет.

Переезд чата на Claude (с миграцией OpenAI Vector Store → pgvector) отложен в R3+ как отдельная задача на ~12-16 дней.

---

## 4. Модели БД

### 4.1 `Wallet` — счётчики пользователя

```python
class Wallet(Base):
    __tablename__ = "wallets"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), unique=True)

    # Промо-прогон при регистрации (lifetime)
    promo_runs_remaining: Mapped[int] = mapped_column(default=1)

    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
```

Создаётся автоматически при регистрации с `promo_runs_remaining=1`.

### 4.2 `ParserPack` — купленные пакеты прогонов

```python
class ParserPack(Base):
    __tablename__ = "parser_packs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    wallet_id: Mapped[UUID] = mapped_column(ForeignKey("wallets.id"))

    package_id: Mapped[str]                    # "single" | "pack5" | "pack15" | "pack50"
    runs_total: Mapped[int]                    # сколько было в пакете
    runs_remaining: Mapped[int]                # сколько осталось

    price_kopeks: Mapped[int]                  # сколько заплатил
    expires_at: Mapped[datetime | None]        # null для single, 30 дней для остальных
    tochka_payment_id: Mapped[str | None]      # для трекинга

    created_at: Mapped[datetime] = mapped_column(default=utcnow)
```

Индексы: `(wallet_id, expires_at)` — для быстрого FIFO-списания и проверки активных.

### 4.3 `WalletTransaction` — единая лента операций кошелька

```python
class WalletTransactionKind(str, Enum):
    pack_purchase = "pack_purchase"   # +N прогонов от покупки пакета
    parser_run    = "parser_run"      # −1 прогон списан
    refund        = "refund"          # +1 прогон возвращён при failed
    promo         = "promo"           # +1 промо-прогон при регистрации
    admin_adjust  = "admin_adjust"    # ручная коррекция

class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    wallet_id: Mapped[UUID] = mapped_column(ForeignKey("wallets.id"))
    kind: Mapped[WalletTransactionKind]
    runs_delta: Mapped[int]                    # +N или -N прогонов
    description: Mapped[str]

    related_pack_id: Mapped[UUID | None] = mapped_column(ForeignKey("parser_packs.id"))
    related_tool_run_id: Mapped[UUID | None] = mapped_column(ForeignKey("tool_runs.id"))
    source_label: Mapped[str | None]           # "promo" | "quota" | "pack5" — для аналитики

    created_at: Mapped[datetime] = mapped_column(default=utcnow)
```

Индекс: `(wallet_id, created_at desc)`.

### 4.4 `ToolRun` — единая абстракция любого инструмента

```python
class ToolType(str, Enum):
    competitor_analysis = "competitor_analysis"   # парсер ниши (R1)
    # будущие R3+: segmentation, semantics, headline_gen, ...

class ToolRunStatus(str, Enum):
    queued = "queued"; running = "running"; done = "done"; failed = "failed"; cancelled = "cancelled"

class ToolRunChargeSource(str, Enum):
    promo = "promo"; quota = "quota"; pack = "pack"; admin = "admin"

class ToolRun(Base):
    __tablename__ = "tool_runs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))

    tool_type: Mapped[ToolType]
    input_params: Mapped[dict] = mapped_column(JSON)
    # для парсера: {url, pages, unique_sellers}

    status: Mapped[ToolRunStatus] = mapped_column(default=ToolRunStatus.queued)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None]

    charge_source: Mapped[ToolRunChargeSource]
    charge_pack_id: Mapped[UUID | None] = mapped_column(ForeignKey("parser_packs.id"))

    result_json: Mapped[dict | None] = mapped_column(JSON)
    # для парсера: {meta, items, accounts, stats}

    ai_brief: Mapped[str | None]
    ai_analysis: Mapped[str | None]

    source: Mapped[str] = mapped_column(default="direct")  # "direct" | "chat"
    chat_id: Mapped[UUID | None] = mapped_column(ForeignKey("chats.id"))

    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
```

Индексы: `(user_id, created_at desc)`, `(status, tool_type)` для очереди worker'а.

---

## 5. Эндпоинты

### 5.1 Парсер для юзера

```
POST   /api/tools/competitor-analysis/runs
       body: {url, pages: 1-4, unique_sellers: bool, source: "direct"|"chat", chat_id?}
       flow:
         1. charge_parser_run(user)
         2. create ToolRun (status=queued, charge_source=..., charge_pack_id=...)
         3. resp: {run_id, charge_source}
       errors:
         402 InsufficientFunds {message, redirect: "/app/wallet"}

GET    /api/tools/competitor-analysis/runs                  # пагинация моих прогонов
GET    /api/tools/competitor-analysis/runs/{id}             # детали
GET    /api/tools/competitor-analysis/runs/{id}/stream      # SSE прогресса
GET    /api/tools/competitor-analysis/runs/{id}/xlsx        # XLSX-выгрузка
GET    /api/tools/competitor-analysis/runs/{id}/html        # HTML-отчёт
POST   /api/tools/competitor-analysis/runs/{id}/cancel
POST   /api/tools/competitor-analysis/runs/{id}/to-chat
       gate: user.has_active_subscription()
       error 403 → фронт показывает paywall "Нужна подписка чтобы расшифровать с AI"
```

### 5.2 Internal (для worker-сервиса)

```
GET    /api/internal/tools/runs/next?worker_id=&tool_type=competitor_analysis
POST   /api/internal/tools/runs/{id}/progress
POST   /api/internal/tools/runs/{id}/result
POST   /api/internal/tools/runs/{id}/failed
```

Защита `X-Parser-Token` (паттерн как в `internal_bot.py`).

### 5.3 Кошелёк

```
GET    /api/wallet                              # {promo_runs_remaining, active_packs: [...], subscription_quota: {...}}
GET    /api/wallet/transactions                 # пагинация, фильтр по kind
GET    /api/wallet/packages                     # список пакетов с ценами (для фронта)

POST   /api/wallet/buy-pack                     # body: {package_id: "pack5"}
       resp: {payment_url} -- редирект на ЮКассу
POST   /api/wallet/webhook                      # webhook от ЮКассы → создаёт ParserPack + транзакцию
```

### 5.4 Подписка (расширение существующего)

```
GET    /api/me/quotas       # {ai_requests: {limit, used, resets_at}, parser_runs: {limit, used, resets_at}}
```

### 5.5 Gate для чата

Существующая логика лимитов чата уже работает. Добавить только:
- При попытке создать новый чат / отправить сообщение без активной подписки и без оставшихся free-запросов → 403 `{code: "subscription_required", redirect: "/app/billing"}`

---

## 6. Алгоритм AI-разбора после прогона

После `POST /jobs/{id}/result` backend в фоновой задаче:

```python
async def generate_parser_analysis(run_id: UUID):
    run = await db.get(ToolRun, run_id)

    # 1. Бриф (та же функция что в парсере)
    brief = build_brief(run.result_json)
    run.ai_brief = brief

    # 2. Claude Sonnet 4.6 с prompt caching
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        system=[
            {"type": "text", "text": SYSTEM_PROMPT_AVITOLOG, "cache_control": {"type": "ephemeral"}}
        ],
        messages=[{"role": "user", "content": brief}],
    )
    run.ai_analysis = response.content[0].text
    await db.commit()

    # 3. Если source=chat → добавляем сообщение в чат
    if run.source == "chat" and run.chat_id:
        await append_chat_message(run.chat_id, run.ai_analysis, role="assistant")

    # 4. TG-уведомление
    await send_tg_notification(run.user_id, f"Анализ ниши готов!")
```

Расход на AI-разбор: ~3 ₽/прогон с кэшированным system-промптом.
Расход на парсер всего: ~20 ₽ (прокси + AI + ЮКасса 3% от 190 = 6 ₽).
**Маржа разовой продажи 190 ₽:** ~170 ₽ (89%).

---

## 7. Миграции

Одна Alembic-миграция создаёт 4 таблицы:
1. `wallets`
2. `parser_packs`
3. `wallet_transactions`
4. `tool_runs`

Плюс изменение в `billing_plans.py`: добавить поле `tool_quotas: dict[str, int]` в каждый план с `{"parser": 1|5|15}`.

**При деплое:** для каждого существующего юзера создать `Wallet` с `promo_runs_remaining=0` (новые получат 1). Существующие подписчики на текущий месяц получат полную квоту парсера.

---

## 8. Изменения в worker-сервисе

В оригинальном `worker.py` минимальное изменение:
- Эндпоинт `/api/internal/parser/jobs/next` → `/api/internal/tools/runs/next?tool_type=competitor_analysis`
- Поля в job: `input_params` вместо `url/pages/unique_sellers` напрямую

Всё остальное (Playwright, прогресс, итоговый JSON) — без изменений.

---

## 9. Frontend (на основе мокапов)

Все мокапы доступны для предпросмотра — ссылки в начале документа.

### Новые страницы (React):
- `/app/tools/competitor-analysis` — `parser.html` (форма + история)
- `/app/tools/competitor-analysis/runs/:id` — `parser-report.html` (отчёт)
- `/app/billing` — `billing.html` (текущий тариф + смена тарифа + история)
- `/app/wallet` — `wallet.html` (баланс прогонов + пакеты + история)

### Обновления существующих:
- `/chat` → переезжает в `/app/chat` (или оставить рядом)
- Дашборд `/app` — `cabinet.html` (новая страница после логина)

### Новые компоненты:
- `<ToolCard>` — карточка инструмента (для лендинга + /app/tools)
- `<RunListItem>` — строка в истории прогонов
- `<RunReportView>` — рендер отчёта из JSON (берёт логику из `html_exporter.py` парсера)
- `<ParserPackCard>` — карточка пакета на странице кошелька
- `<WalletBalanceCard>` — большой баланс-блок
- `<QuotaProgressBar>` — прогресс квоты с прогрессбаром
- `<PaywallModal>` — модалка «нужна подписка»
- `<InsufficientFundsModal>` — модалка «нет прогонов, купи пакет»

---

## 10. Открытые вопросы (отложено в R2+)

1. **Расширенный режим парсера** (до 500 объявлений за +200 ₽) — R2
2. **Экспресс режим** (5 мин вместо 20 за +100 ₽) — R2
3. **Подключение профиля Авито через API** — R2 (мониторинг, автопрогоны, алерты)
4. **Реферальная программа** «приведи друга +3 прогона» — R3
5. **Проекты** (несколько ниш/клиентов в одном кабинете) — R3, но БД готова с самого начала
6. **Миграция чата на Claude микс (Haiku+Sonnet)** — R3+ (~12-16 дней, главный затык — OpenAI Vector Store → pgvector)
7. **Корпоративные/командные подписки** (Agency tier с N юзерами) — R3+

---

## 11. Сроки и распределение

| Этап | Кто | Дней |
|---|---|---|
| 1. VPS + Playwright + worker-сервис | Иван | 4 |
| 2. Backend: модели + миграция + эндпоинты | Иван | 5 |
| 3. Backend: AI-разбор на Claude Sonnet (один файл, 20 строк) | Иван | 1 |
| 4. Frontend: страницы парсера + кабинет + биллинг + кошелёк | Лера + Claude (patch-files) | 6 |
| 5. QA end-to-end + правки | все | 2 |
| **Итого R1 до запуска** | | **~18 рабочих дней** |

---

## 12. Файлы передаваемые разработчику

1. **Этот документ** (`ТЗ_дополнение_кабинет_и_кошелёк.md`)
2. **Оригинальное ТЗ** (`ТЗ_парсер_интеграция.md`) — с базовой архитектурой парсера
3. **Исходники парсера** (`~/Desktop/avito_parser/`) — рабочий код, миграция на Playwright + stealth по образцу `~/Desktop/avito-monitor/`
4. **Backend-проект** (`~/Desktop/avitolog-2026-05-15-lite-for-audit/app/`) — куда добавляются эндпоинты
5. **Шаблон internal API** (`~/Desktop/backend_patch/internal_bot.py`) — паттерн для `X-Parser-Token`
6. **HTML-рендер отчёта** (`~/Desktop/avito_parser/html_exporter.py`) — основа для React-компонента
7. **Мокапы UI онлайн:** https://saltykovatarget-crypto.github.io/avito-tools-mockup/r1/

---

**Контакт:** Лера, saltykovatarget@gmail.com

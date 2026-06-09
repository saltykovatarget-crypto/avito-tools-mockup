# ТЗ для бэкенда — глубокое расширение R1

> ⚠️ **ВНИМАНИЕ — Иван, прочитай:** этот документ написан до миграции на чистую wallet-модель и содержит **legacy-логику подписочной модели** (промо-прогоны / квоты / гибридная схема списания). Актуальная модель — wallet-only, см. `00_WALLET_MODEL.md` и `02_wallet_backend_final.md`.
>
> Используй из этого файла **только разделы**: observability, security, race conditions, idempotency, testing, ops/runbook. **Игнорируй** любые упоминания «квота», «промо-прогон», «гибридная схема списания», «источник списания».

**Версия:** 1.0
**Дата:** 2026-05-28
**Автор:** Лера (saltykovatarget@gmail.com)
**Расширяет:** `ТЗ_парсер_интеграция.md` и `ТЗ_дополнение_кабинет_и_кошелёк.md`

---

## 0. Цель документа

Оригинальное ТЗ описывает «что делать». Это расширение описывает **«как делать правильно»** — углы которые легко упустить при первой реализации:
- Race conditions при конкурентных запусках/оплатах
- Идемпотентность платежей и webhook'ов
- Outbox-паттерн для надёжных уведомлений
- Логирование/метрики/трейсинг (что писать, что НЕ писать)
- Security: rate limiting, SSE auth, подписи webhook
- Тестирование (mock Avito, флейки)
- Деплой и rollback
- Операционные инструменты (как саппорту работать с инцидентами)
- Расширяемость под Шаги 2-10

Без этого парсер запустится, но через 2 недели начнёт падать в продакшене.

---

## 1. Архитектура верхнего уровня

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AI Авитолог PRO                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  [React Frontend]                                                     │
│      /app/chat            ← чат с полосой прогресса 10 шагов         │
│      /app/tools/...       ← отдельные страницы инструментов           │
│      /app/wallet          ← пакеты прогонов парсера                  │
│      /app/billing         ← подписка, тариф, история                 │
│                                                                       │
│         ↓ ↑  REST (HTTP) + SSE (для прогресса) + WebSocket (для      │
│              новых сообщений в чате, опционально в R1)               │
│                                                                       │
│  [FastAPI Backend]                                                    │
│      /api/tools/{tool}/*  ← публичные эндпоинты инструментов         │
│      /api/internal/*      ← закрытые эндпоинты для worker'ов         │
│      /api/wallet/*        ← операции кошелька                        │
│      /api/billing/*       ← подписка, продление                      │
│      /api/chats/*         ← чаты с полосой прогресса                 │
│                                                                       │
│         ↓                                                             │
│                                                                       │
│  [PostgreSQL]   users, chats, messages, tool_runs, wallets,          │
│                 parser_packs, wallet_transactions, audit_log         │
│                                                                       │
│  [Redis]        rate limits, SSE pub/sub, idempotency keys,          │
│                 worker queue (если выберем Redis-based)              │
│                                                                       │
│         ↑                                                             │
│                                                                       │
│  [Parser Worker (VPS)]                                                │
│      Polls /api/internal/tools/runs/next                             │
│      Playwright + Xvfb + мобильный прокси                            │
│      Posts progress + result обратно в backend                       │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Поток данных: парсер → JSON → бриф → AI → чат

Это критически важно понимать перед реализацией.

```
СОБЫТИЕ                       КТО                  ЧТО ДЕЛАЕТ
─────────────────────────────────────────────────────────────────
1. Worker завершил парсинг   parser-worker        POST /internal/runs/{id}/result
                                                  body: {result_json: {meta, items,
                                                  accounts, stats}}

2. Backend сохранил           backend              tool_run.result_json = ...
                                                  tool_run.status = "done"
                                                  enqueue: ai_analysis_job(run_id)

3. Background job             celery/dramatiq      brief = build_brief(result_json)
   генерирует бриф                                tool_run.ai_brief = brief

4. Background job             celery/dramatiq      response = claude.messages.create(
   зовёт Claude Sonnet                              system=SYSTEM_PROMPT,
                                                    messages=[{role:"user", content:brief}]
                                                  )
                                                  tool_run.ai_analysis = response.text

5. Если source=chat —        backend              chat_message = ChatMessage(
   создаём сообщение в                              chat_id=run.chat_id,
   чате                                             role="assistant",
                                                    content=tool_run.ai_analysis,
                                                    tool_run_id=run.id
                                                  )
                                                  pubsub.publish(chat_id, "new_message")

6. Frontend получает          react через SSE      Подписан на /api/chats/{id}/stream
   обновление                                     → рендерит новое сообщение
                                                  → обновляет ParserCard на state=done

7. TG-уведомление             background           send_tg(user.telegram_id, "Анализ готов!")
```

### 2.1 Что такое `build_brief(result_json)` (~200 строк кода)

Функция превращает структурированный JSON парсера в человекочитаемый текст ~8 000 токенов:

```python
def build_brief(result: dict) -> str:
    """Превращает result_json в текстовый бриф для AI."""
    meta = result["meta"]
    items = result["items"][:50]  # топ-50 объявлений
    accounts = sorted(result["accounts"], key=lambda a: a["views"], reverse=True)[:10]
    stats = result["stats"]

    parts = [
        f"# Анализ ниши: «{meta['query']}» в городе {meta['city']}",
        "",
        f"## Сводка",
        f"Всего объявлений: {stats['total_ads']}",
        f"Уникальных продавцов: {stats['unique_accounts']}",
        f"Медиана цены: {stats['median_price']:,} ₽ (от {stats['min_price']:,} до {stats['max_price']:,})",
        f"Просмотры суммарно: {stats['total_views']:,}",
        f"С VAS-продвижением: {stats['vas_share']*100:.0f}%",
        f"Доля топ-5 по просмотрам: {stats['top5_share']*100:.0f}%",
        "",
        "## Топ-10 объявлений по просмотрам",
    ]

    for i, item in enumerate(items[:10], 1):
        parts.append(
            f"{i}. {item['title']} — {item['price']:,} ₽, "
            f"{item['views']:,} просмотров, аккаунт «{item['seller_name']}»"
            + (", VAS: " + ", ".join(item['vas_types']) if item.get('vas_types') else "")
        )

    parts.append("")
    parts.append("## Топ-10 аккаунтов")
    for i, acc in enumerate(accounts, 1):
        parts.append(
            f"{i}. {acc['name']} — {acc['ads_count']} объявлений, "
            f"{acc['views']:,} просмотров ({acc['share']*100:.0f}% ниши), "
            f"★ {acc['rating']:.1f}, {acc['reviews_count']} отзывов"
        )

    return "\n".join(parts)
```

Размер брифа: 5 000–10 000 токенов в зависимости от объёма. Влезает в любой контекст.

### 2.2 System prompt для Claude Sonnet (хранить отдельно)

```python
SYSTEM_PROMPT_PARSER_ANALYSIS = """
Ты — AI Авитолог, эксперт по продвижению объявлений на Avito.
Методология из 10 шагов:
1. Анализ ниши и конкурентов (где мы сейчас)
2. Стратегия размещения
...

Юзер запустил парсер ниши. Твоя задача — дать **структурированный разбор результата**
в 6-8 абзацах:

1. **Концентрация ниши** — кто доминирует, какая доля у топ-5
2. **VAS-стратегия лидеров** — что покупают, без чего попасть в топ невозможно
3. **Ценовая стратегия** — медиана, разброс, кто демпингует
4. **Качество фото у лидеров** — что видно по обложкам топа
5. **Тексты топ-10** — что общее, штампы
6. **Где можно играть** — конкретные слабые места конкурентов
7. **Следующий шаг** — приглашение перейти к Шагу 2

Стиль:
- На «ты», женский род («ты прошла», «давай возьмём»)
- Короткие абзацы по 2-3 предложения
- Жирным выделять ключевые тезисы (DoorHan, 73% просмотров)
- Никаких упоминаний модели/вендора AI
- Не использовать слово «Claude» или «AI» в тексте — ты «AI Авитолог»

Не более 2000 токенов.
"""
```

### 2.3 Как чат-AI видит этот разбор в дальнейших ответах

Когда юзер пишет «расскажи подробнее про DoorHan» в этом же чате, backend собирает контекст для chat-AI (gpt-5-mini):

```python
def build_chat_context(chat: Chat) -> list[Message]:
    messages = []

    # 1. Базовый system prompt — методология
    messages.append({"role": "system", "content": SYSTEM_PROMPT_AVITOLOG_CHAT})

    # 2. Если есть прогон парсера в этом чате — добавить summary в system
    last_run = await db.scalar(
        select(ToolRun).where(ToolRun.chat_id == chat.id, ToolRun.status == "done")
        .order_by(ToolRun.created_at.desc()).limit(1)
    )
    if last_run:
        summary = build_brief_summary(last_run.result_json, max_tokens=500)
        messages.append({"role": "system", "content": f"Контекст прогона парсера:\n{summary}"})

    # 3. Полная история сообщений
    for msg in chat.messages:
        messages.append({"role": msg.role, "content": msg.content})

    return messages
```

`build_brief_summary()` — это **сжатая версия брифа на 500 токенов**, только сводка + топ-3 факта. Полный бриф в контекст не пихаем чтобы не раздувать.

---

## 3. UX-логика парсер-карточки в чате (3 состояния)

Карточка живёт как **одно сообщение** в чате (`ChatMessage`), привязанное к `tool_run_id`. Фронт рендерит её состояние в зависимости от `tool_run.status`.

### 3.1 Состояния

| status | Что показывает фронт |
|---|---|
| `queued` | Состояние «форма» — поля URL, страницы, режим, кнопка «Запустить» |
| `running` | Компактная пилюля «Парсер: 87/156 — 9 мин →» — клик ведёт на `/app/tools/parser/runs/{id}` |
| `done` | Карточка результата — 5 KPI + 8 фото + 3 кнопки + AI-разбор отдельным сообщением рядом |
| `failed` | Карточка ошибки — описание + кнопка «Прогнать заново» (без повторного списания) |
| `cancelled` | Карточка отменена — кнопка «Запустить ещё раз» |

### 3.2 Жизненный цикл (диаграмма состояний)

```
                     ┌────────┐
   user input   →    │ queued │
                     └────┬───┘
                          │ worker picked up
                          ▼
                     ┌─────────┐
                     │ running │  ←─── SSE updates progress
                     └────┬────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
       result │     failed│   user    │ cancel
              ▼           ▼           ▼
          ┌──────┐   ┌────────┐   ┌───────────┐
          │ done │   │ failed │   │ cancelled │
          └──────┘   └────────┘   └───────────┘
```

### 3.3 Что вызывает AI

В системном промпте чат-AI описана **функция**:

```python
{
  "name": "suggest_parser",
  "description": "Предложить юзеру запустить парсер ниши. Использовать когда юзер дал URL Avito или явно попросил анализ конкурентов на Шаге 1.",
  "parameters": {
    "url": "URL выдачи Avito",
    "default_pages": "Сколько страниц по умолчанию (1-4)",
    "default_mode": "all | unique_sellers"
  }
}
```

**Важно:** AI **не запускает парсер сам**. Он лишь создаёт сообщение с `tool_run` в статусе `queued` — карточка-форма. Юзер сам нажимает «Запустить» → backend меняет статус на `running` и помещает в очередь worker'а.

Это **safety-pattern**: AI предлагает, юзер подтверждает (и тратит деньги/квоту осознанно).

---

## 4. Полоска прогресса 10 шагов методологии

### 4.1 БД

Поля в таблице `chats`:

```python
class Chat(Base):
    # ... существующие поля
    current_step: Mapped[int] = mapped_column(default=1)        # 1..10
    completed_steps: Mapped[list[int]] = mapped_column(JSON, default=list)  # [1, 2]
    methodology_version: Mapped[str] = mapped_column(default="v1")  # для будущих изменений методологии
```

### 4.2 Эндпоинты

```
GET    /api/chats/{id}                            возвращает current_step и completed_steps
POST   /api/chats/{id}/advance-step               юзер «Я закончила, дальше»
POST   /api/chats/{id}/jump-to-step               body: {step: 3} — переход к шагу N
```

**`advance-step`** логика:
```python
def advance_step(chat: Chat):
    if chat.current_step >= 10:
        return  # уже на последнем
    if chat.current_step not in chat.completed_steps:
        chat.completed_steps.append(chat.current_step)
    chat.current_step += 1
    # эмитим в SSE — фронт обновит полоску
```

**`jump-to-step`** логика:
```python
def jump_to_step(chat: Chat, target: int):
    if target < 1 or target > 10:
        raise ValueError
    # При прыжке назад НЕ убираем из completed_steps (история сохраняется)
    chat.current_step = target
```

### 4.3 Что AI делает

В системном промпте чат-AI знает: «Юзер сейчас на Шаге N. Сфокусируйся на задачах этого шага.»

```python
def build_chat_system_prompt(chat: Chat) -> str:
    step = chat.current_step
    step_name = METHODOLOGY_STEPS[step]["name"]
    step_goal = METHODOLOGY_STEPS[step]["goal"]

    return f"""
    Ты — AI Авитолог. Юзер сейчас на **Шаге {step} из 10: {step_name}**.
    Цель этого шага: {step_goal}

    Не упоминай прогресс шагов в тексте — это видно в шапке чата.
    В конце ответа, если шаг завершён, спрашивай: «готова перейти к Шагу {step+1}?»
    """
```

### 4.4 R2: автоматическое завершение шага

В R1 кнопка «Я закончила, дальше →» — ручной триггер.
В R2 можно дать AI function call `mark_step_done(step_n)` — он сам помечает шаг завершённым когда уверен. Но для R1 — ручка чтобы не было сюрпризов.

---

## 5. Race conditions — что может пойти не так

### 5.1 Юзер кликает «Запустить парсер» дважды быстро

**Проблема:** оба запроса проходят charge_parser_run одновременно — списываются 2 прогона вместо 1.

**Решение:** идемпотентный ключ + транзакция с `SELECT FOR UPDATE`:

```python
@router.post("/api/tools/competitor-analysis/runs")
async def start_parser(
    body: StartParserRequest,
    user: User = Depends(current_user),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    # 1. Проверяем idempotency — если уже создавали этот run, возвращаем существующий
    existing = await db.scalar(
        select(ToolRun).where(
            ToolRun.user_id == user.id,
            ToolRun.idempotency_key == idempotency_key,
        )
    )
    if existing:
        return existing

    # 2. Транзакция со списанием
    async with db.begin():
        # Локаем wallet чтобы другая транзакция не списала параллельно
        wallet = await db.scalar(
            select(Wallet).where(Wallet.user_id == user.id).with_for_update()
        )
        charge_result = charge_parser_run(user, wallet)

        # Создаём run только после успешного списания
        run = ToolRun(
            user_id=user.id,
            tool_type="competitor_analysis",
            input_params=body.dict(),
            charge_source=charge_result.source,
            idempotency_key=idempotency_key,
            ...
        )
        db.add(run)
        await db.flush()
        return run
```

Фронт **обязан** генерировать `Idempotency-Key` (UUID v4) при формировании запроса. При retry (например юзер кликнул второй раз пока первый ответ не пришёл) — тот же UUID.

### 5.2 Worker берёт один job дважды

**Проблема:** 2 worker'а одновременно опрашивают `/api/internal/tools/runs/next`, оба получают тот же job.

**Решение:** `SELECT ... FOR UPDATE SKIP LOCKED`:

```python
@router.get("/api/internal/tools/runs/next")
async def get_next_run(worker_id: str):
    async with db.begin():
        run = await db.scalar(
            select(ToolRun)
            .where(ToolRun.status == "queued")
            .order_by(ToolRun.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if not run:
            return None
        run.status = "running"
        run.started_at = datetime.utcnow()
        run.worker_id = worker_id
        return run
```

Это PostgreSQL-фича. `SKIP LOCKED` пропускает строки которые залочены другой транзакцией.

### 5.3 Пакет истёк пока парсер крутился

**Проблема:** юзер купил пакет 30 мая, 29 июня в 23:59 запустил парсер из пакета (списан 1 прогон). 30 июня в 00:01 пакет «истёк» по сроку. Но парсер ещё крутится — что с ним?

**Решение:** **списание происходит при запуске, не при завершении**. Если списан — парсер должен дойти до конца независимо от истечения пакета. `ParserPack.expires_at` влияет только на **новые запуски**, не на уже идущие.

Если парсер `failed` — возврат прогона **в тот же пакет даже если он уже истёк** (потому что списан был с него). Опционально: продлить срок пакета на 1 день при возврате чтобы юзер мог использовать.

### 5.4 ЮКасса прислала webhook дважды (сетевые ретраи)

**Проблема:** webhook о успешной оплате пакета приходит 2 раза → создаём 2 пакета → юзер получает в 2 раза больше прогонов.

**Решение:** идемпотентность по `tochka_payment_id`:

```python
@router.post("/api/wallet/webhook")
async def webhook(body: TochkaWebhook):
    if body.event != "payment.succeeded":
        return {"ok": True}

    # Проверяем что мы ещё не обработали этот payment
    existing = await db.scalar(
        select(ParserPack).where(ParserPack.tochka_payment_id == body.payment_id)
    )
    if existing:
        return {"ok": True, "duplicate": True}  # idempotent

    # Создаём пакет
    pack = ParserPack(
        wallet_id=...,
        package_id=body.metadata["package_id"],
        ...
        tochka_payment_id=body.payment_id,
    )
    db.add(pack)
```

### 5.5 Юзер отменил подписку (или она истекла) пока парсер крутился

**Решение:** парсер запущен → list charge_source — если из квоты подписки, и подписка истекла, прогон **всё равно завершается** (юзер уже потратил квоту). Возврат при failed возвращает квоту в **текущий или следующий месяц** (если подписка ещё активна).

Если подписка истекла и failed — пишем `WalletTransaction(kind="refund", source_label="expired_subscription")`, прогон **сгорает** (нет куда вернуть). Юзеру в чате сообщение «прогон не получился, к сожалению подписка истекла, продли чтобы получить компенсацию».

---

## 6. Background jobs — выбор очереди

**Что нужно делать в фоне:**
- AI-анализ после готовности парсера (один вызов Claude, ~5 сек)
- TG-уведомления
- Webhook-логика (можно синхронно, но лучше в фон для надёжности)
- Очистка истёкших пакетов (раз в день)
- Reconciliation с ЮКассой (раз в день)

**Варианты:**

| Решение | Плюсы | Минусы | Когда выбирать |
|---|---|---|---|
| **APScheduler** | Уже в проекте? простой in-process | Падает с процессом, нет retries | Простые крон-задачи |
| **Celery + Redis** | Стандарт индустрии | Тяжёлый, требует Redis | Если планируется много фоновых задач |
| **Dramatiq + Redis** | Проще Celery, хорошие retries | Меньше экосистема | Хороший баланс для среднего объёма |
| **arq + Redis** | Лёгкий, async-нативный | Молодой проект | Для FastAPI-проектов с async |

**Рекомендация для R1:** **`arq`** — он async-native (как FastAPI), простой, использует Redis который уже есть в проекте. ~200 строк кода для setup. Альтернатива: dramatiq.

**Что НЕ использовать:** Threading.Thread, BackgroundTasks из FastAPI (теряются при падении), сырые asyncio.create_task без supervisor.

---

## 7. Observability

### 7.1 Логи — что логировать (и что НЕ логировать)

**Логировать:**
- Все 4xx/5xx ответы API
- Запуск/завершение каждого tool_run (с user_id, charge_source, длительностью)
- Все списания/возвраты прогонов
- Webhook'и платёжной системы (без секретов)
- Ошибки парсер-worker (с stacktrace)
- Аномалии: парсер крутится > 30 мин, worker не отвечает > 5 мин

**НЕ логировать (PII/секреты):**
- Содержимое чатов с юзером
- Полные `result_json` парсера (только мета: количество объявлений)
- Пароли, токены, ключи
- Платёжные данные (карты)
- Email/телефон юзера в plain виде (заменять на user_id)

### 7.2 Структурированные логи

```python
logger.info("tool_run.started", extra={
    "run_id": run.id,
    "user_id": user.id,
    "tool_type": run.tool_type,
    "charge_source": run.charge_source,
    "input_url": run.input_params.get("url"),  # OK — это публичная ссылка Avito
    "pages": run.input_params.get("pages"),
})
```

Формат — JSON. Парсятся легко в Loki/Datadog/Cloudwatch.

### 7.3 Метрики (Prometheus)

```
# Бизнес-метрики
parser_runs_total{tool_type, charge_source, status}    counter
parser_run_duration_seconds{tool_type}                 histogram
wallet_pack_purchases_total{package_id}                counter
subscription_active{plan}                              gauge

# Технические
http_requests_total{method, path, status}              counter
http_request_duration_seconds{path}                    histogram
ai_calls_total{model, status}                          counter
ai_tokens_used_total{model, type}                      counter (важно для контроля расходов!)
worker_idle_time_seconds                               gauge
```

### 7.4 Алерты (Grafana / Sentry)

Критичные:
- Worker не отвечает > 5 мин (никто не парсит)
- Failed runs > 10% за час (что-то сломалось в Avito или прокси)
- Webhook ошибки > 5 в минуту (ЮКасса проблемы)
- AI расход > 1000 ₽/час (контроль бюджета)
- DB connection pool > 80%
- Очередь parser-runs > 50 (юзеры ждут)

Не критичные (Slack уведомление):
- Новая покупка пакета (для радости основателя)
- Новый подписчик
- Failed run у конкретного юзера

### 7.5 Tracing (опционально)

OpenTelemetry для трассировки запроса юзера через все слои. Даёт ответ на «почему этот запрос тормозил» за 2 секунды вместо часа копания в логах.

Для R1 — отложить, для R3+ — обязательно.

---

## 8. Security

### 8.1 Rate limiting

Чтобы один юзер не убил систему:

| Эндпоинт | Лимит |
|---|---|
| `/api/tools/*/runs` (запуск) | **3 в час на юзера** (парсер сам ограничен max_concurrent=1, это защита от спама) |
| `/api/wallet/buy-pack` | **5 в час на юзера** |
| `/api/chats/messages` | **30 в минуту** (анти-DDoS, не лимит подписки) |
| Все остальные | **120 в минуту** |

Реализация: Redis + `slowapi` или nginx limit_req.

### 8.2 SSE авторизация

`EventSource` в браузере **не поддерживает custom headers** (это ограничение спецификации). Поэтому при подключении к `/api/chats/{id}/stream` авторизация — через **cookie** (если уже есть session-cookie) или через **query param с токеном**:

```
GET /api/chats/abc-123/stream?token=eyJxxxx
```

Лучше через cookie. При query-token — обязательно короткоживущий, одноразовый, ротирующийся.

### 8.3 X-Parser-Token (internal API)

Worker-сервис на VPS отдаёт запросы к `/api/internal/tools/*` с заголовком `X-Parser-Token: <secret>`. Этот токен:
- Хранится в `backend/.env` как `PARSER_INTERNAL_TOKEN=...`
- Хранится в `/opt/parser/.env` на VPS как `BACKEND_TOKEN=...`
- При компроментации — ротация: меняешь в обоих местах, перезапускаешь worker
- В коде сравнение через `secrets.compare_digest` (защита от timing-attack)

### 8.4 Подпись YuKassa webhook

ЮКасса подписывает webhook'и HMAC-SHA256. Backend **обязан** проверять подпись:

```python
def verify_webhook_signature(body: bytes, signature: str) -> bool:
    expected = hmac.new(
        settings.tochka_webhook_secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

Если подпись неверная — `401 Unauthorized`, лог + Sentry alert (кто-то пытается фейкить оплаты).

### 8.5 Защита от прямого доступа к чужим прогонам

`GET /api/tools/competitor-analysis/runs/{id}` — обязательно проверять `run.user_id == current_user.id`. Иначе зная UUID можно посмотреть чужой отчёт.

Стандартный паттерн:
```python
async def get_run_or_404(run_id: UUID, user: User):
    run = await db.scalar(
        select(ToolRun).where(ToolRun.id == run_id, ToolRun.user_id == user.id)
    )
    if not run:
        raise HTTPException(404)
    return run
```

### 8.6 SSRF защита при URL Avito

Юзер передаёт URL в `/api/tools/competitor-analysis/runs`. Validation:
- Должен быть на домене `*.avito.ru` или `avito.ru`
- HTTPS обязателен
- Никаких localhost / 127.0.0.1 / приватных IP

```python
def validate_avito_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return False
    if not parsed.hostname.endswith("avito.ru"):
        return False
    return True
```

---

## 9. Edge cases

### 9.1 Юзер отменяет парсинг mid-way

`POST /api/tools/.../runs/{id}/cancel` — что делать:
- Если `status=queued` — установить `cancelled`, **вернуть прогон в источник списания**
- Если `status=running` — отправить сигнал worker'у через Redis pub/sub, worker увидит и завершит. Возврат прогона — **по политике**:
  - Прошло < 5 минут → вернуть полностью
  - Прошло > 5 минут (worker уже наработал) → не возвращать (юзер передумал, но мы понесли расходы)

### 9.2 Парсер завис

Worker должен иметь **timeout на job** (например 30 минут). Если jobid не закончился за timeout — backend отмечает run как `failed` с error="timeout", возврат прогона юзеру, алерт в Sentry.

Реализация: cron-job раз в 5 минут, ищет `ToolRun.status=running AND started_at < now - 30min`, переводит в failed.

### 9.3 Юзер удалил аккаунт

`DELETE /api/me` (если будет реализован) — soft delete:
- `users.deleted_at = now()`
- Не удаляем `tool_runs`, `wallet_transactions`, `parser_packs` — они нужны для бухгалтерии
- Анонимизируем PII в `users.email`, `users.telegram_id`
- Деактивируем все активные пакеты

Hard delete — только по запросу ГПДН-аудитора (см. раздел 13).

### 9.4 Worker упал во время парсинга

При перезапуске worker'а — проверять `ToolRun WHERE worker_id=self AND status=running`. Если есть — пометить failed (мы не знаем что с ним), вернуть прогон.

Альтернатива: heartbeat. Worker раз в минуту шлёт `POST /internal/workers/heartbeat`. Backend следит — если 5 минут без heartbeat → отмечает все его running-jobs как failed.

### 9.5 AI Claude API недоступен

После завершения парсинга вызов Claude может упасть (rate limit, network). Стратегия:
- 3 ретрая с экспоненциальной задержкой (1s, 5s, 25s)
- Если все 3 фейлят — `tool_run.ai_analysis = "Не удалось сгенерировать разбор. Открой полный отчёт чтобы посмотреть данные."`
- Сам tool_run — `status=done` (парсер же прошёл), AI-разбор — null
- В UI: «AI-разбор будет позже» с кнопкой «Сгенерировать ещё раз»

---

## 10. Testing strategy

### 10.1 Unit tests (быстрые, без БД)

- `charge_parser_run()` — 8-10 кейсов:
  - promo есть → списать promo
  - promo нет, квота есть → списать квоту
  - promo нет, квота нет, пакет есть → списать пакет
  - всё пусто → InsufficientFundsError
  - пакет истёк → не использовать
  - параллельный запрос → блокировка
- `build_brief()` — снэпшот тесты на разных JSON
- Логика `advance_step()` / `jump_to_step()`

### 10.2 Integration tests (с БД, медленнее)

- Полный цикл: создать юзера → купить пакет (mock YuKassa) → запустить парсер (mock worker) → завершить → проверить AI-разбор появился в чате
- Idempotency: 2 запроса с одинаковым ключом → 1 run
- Webhook повторно: 2 webhook → 1 пакет

### 10.3 Mock Avito для парсера

Поднять локальный nginx/python-сервер который отдаёт фиксированный HTML страницы выдачи (10 объявлений) и фиксированный HTML карточки. Парсер тестируется на нём.

Не парсить реальный Avito в CI — это медленно, ненадёжно, и может привести к бану IP.

### 10.4 Load test

Перед запуском: `locust` или `k6` — 100 одновременных юзеров кликают «запустить парсер». Должно:
- Корректно ставиться в очередь
- Не падать DB connection pool
- Не дублировать списания
- Worker'ы (хотя бы 2) должны разбирать FIFO

### 10.5 Тестирование переключателя темы

Простой Playwright тест: открыть `/app/chat`, кликнуть переключатель темы, проверить что `<html data-theme>` сменился. И обратно. Это защищает от регрессии когда менятся CSS-переменные.

---

## 11. Deployment и rollout

### 11.1 Миграция БД — без даунтайма

Алгоритм безопасной миграции:
1. **Деплой 1:** только новые таблицы и колонки (`wallets`, `parser_packs`, `tool_runs`, etc.) — БД совместима со старым кодом
2. **Деплой 2:** код, читающий старые ParseJob (если бы был) **и** новые ToolRun. Один из источников активен через feature flag.
3. **Бэкфилл:** скрипт мигрирует исторические данные (если нужно)
4. **Деплой 3:** переключаем feature flag — только новый код
5. **Деплой 4 (через неделю):** удаляем старые таблицы

В R1 у нас всё с нуля (нет parse_jobs), поэтому шаги 2-4 не нужны. Просто один деплой с новыми таблицами.

### 11.2 Feature flag для парсера

В `settings.py`:
```python
FEATURE_PARSER_ENABLED: bool = Field(default=False)
```

В коде:
```python
if not settings.feature_parser_enabled:
    raise HTTPException(503, "Парсер пока в beta, скоро запустим!")
```

Это позволит выкатить код, протестить на проде с одним юзером (`if user.email == "saltykovatarget@gmail.com": enabled`), потом включить всем.

### 11.3 Rollback plan

Что делать если после деплоя парсер начал жрать деньги или падать:
1. **Немедленно:** выключить `FEATURE_PARSER_ENABLED=False` (даже не нужен передеплой если конфиг через env + reload)
2. **Юзерам:** в карточке парсера показывается «Парсер временно недоступен, скоро вернём»
3. **Активные jobs:** оставить идти до конца (отменять — потеряем деньги)
4. **Анализ:** что сломалось → фикс → деплой → включить

### 11.4 Database backups

Минимум:
- Daily full backup в S3 / VK Cloud
- Hourly WAL backup (point-in-time recovery)
- Retention: 30 дней daily, 7 дней hourly
- Тест restore — раз в месяц (без теста бэкап = нет бэкапа)

---

## 12. Operations / Admin

### 12.1 Что должен мочь делать саппорт

Бизнес-кейсы которые **обязательно** возникнут:

1. **«У меня не отработал парсер, верните прогон»** → саппорт нажимает кнопку «Вернуть прогон» → создаётся `WalletTransaction(kind="admin_adjust", runs_delta=+1)`, видно в истории юзера
2. **«Хочу промо +5 прогонов»** → саппорт даёт через ту же кнопку
3. **«У меня закончилась подписка но я заплатил»** → саппорт продлевает на 1 месяц без оплаты
4. **«Покажи мне полный отчёт моего прогона #abc»** → саппорт открывает в админке
5. **«Где мой webhook от ЮКассы?»** → саппорт видит лог webhook'ов по этому payment_id

### 12.2 Эндпоинты админки

```
GET    /api/admin/users/{id}              профиль юзера + кошелёк + история
POST   /api/admin/users/{id}/grant-runs   body: {runs: 5, reason: "compensation"}
POST   /api/admin/users/{id}/extend-plan  body: {days: 30, reason: "..."}
GET    /api/admin/tool-runs/{id}          полный run включая result_json
POST   /api/admin/tool-runs/{id}/rerun    перезапустить (без списания) — для дебага
GET    /api/admin/webhooks                лог последних N webhook'ов
GET    /api/admin/metrics                 быстрые операционные метрики
```

Все эти эндпоинты — за `is_admin=True` + IP whitelist (как уже сейчас в проекте через `admin-ip-allow-map.conf`).

Все действия пишутся в `audit_logs` (уже есть в проекте).

### 12.3 Runbook на типичные инциденты

Документ для саппорта/дежурного. Каждый алерт — своя страница с конкретными командами.

Пример: «Worker не отвечает 5 мин» → команды:
```bash
# 1. Проверить статус сервиса
ssh parser-vps "systemctl status avitolog-parser"

# 2. Если падает — посмотреть логи
ssh parser-vps "journalctl -u avitolog-parser -n 100"

# 3. Перезапустить
ssh parser-vps "systemctl restart avitolog-parser"

# 4. Если зависшие jobs — отметить failed
psql -c "UPDATE tool_runs SET status='failed', error='worker crash' WHERE status='running' AND started_at < NOW() - INTERVAL '15 minutes'"
```

---

## 13. Compliance — GDPR / 152-ФЗ

### 13.1 Какие PII мы храним

| Поле | Назначение | Можно ли удалить |
|---|---|---|
| `users.email` | логин + связь | да (анонимизировать) |
| `users.telegram_id` | TG-уведомления | да |
| `chats.*` (содержимое сообщений) | бизнес-логика | по запросу — да |
| `tool_runs.input_params.url` | URL Avito | публичная инфа, не PII |
| `wallet_transactions` | бухгалтерия | хранить 3 года по закону |
| `audit_logs` | безопасность | хранить 1 год |

### 13.2 Право на удаление

Эндпоинт `DELETE /api/me/data`:
1. Soft delete юзера
2. Анонимизация email → `deleted-{user_id}@example.com`
3. Анонимизация telegram_id → null
4. Содержимое сообщений → `[deleted]`
5. Подтверждение по email юзера (отдельный токен)

### 13.3 Экспорт данных

`GET /api/me/data-export` — выгружает JSON со всеми данными юзера. Удобно для compliance + просто как фича «скачай свои данные».

### 13.4 Retention policy

- Чаты: вечно (это ценность сервиса для юзера)
- `tool_runs.result_json`: вечно (JSONB занимает копейки)
- Logs: 30 дней
- Audit log: 1 год
- Резервные копии БД: 30 дней

---

## 14. Performance

### 14.1 Индексы (обязательные)

```sql
-- ToolRun
CREATE INDEX ix_tool_runs_user_created ON tool_runs (user_id, created_at DESC);
CREATE INDEX ix_tool_runs_status_type_created ON tool_runs (status, tool_type, created_at);

-- WalletTransaction
CREATE INDEX ix_wt_wallet_created ON wallet_transactions (wallet_id, created_at DESC);

-- ParserPack — для FIFO-списания и проверки активных
CREATE INDEX ix_packs_wallet_expires ON parser_packs (wallet_id, expires_at)
  WHERE runs_remaining > 0;

-- Chat
CREATE INDEX ix_chats_user_updated ON chats (user_id, updated_at DESC);
```

### 14.2 Кэширование

- **System prompts** для AI — в Redis с TTL 1 час (читаются часто, не меняются)
- **Список пакетов** для фронта — в памяти приложения (или Redis), TTL 1 час
- **Тарифы** — в памяти (раз в час релоад)
- **Метрики юзера** для дашборда (квота AI, баланс прогонов) — Redis, TTL 30 сек

### 14.3 Пагинация — cursor, не offset

`GET /api/tools/competitor-analysis/runs?limit=20&cursor=<base64-encoded created_at + id>` — стандартный keyset-пагинатор. Offset-пагинация умирает на 1000+ записях.

### 14.4 N+1 в API

Использовать `selectinload` / `joinedload` в SQLAlchemy чтобы не делать N запросов к БД на список чатов и т.д. Code review = всегда смотреть на N+1.

---

## 15. Расширяемость под Шаги 2-10

### 15.1 Принцип

Каждый новый инструмент (для Шага 2, 3, …, 10) добавляется **БЕЗ изменения схемы БД**:
- Новый `ToolType` в enum
- Новый worker (если нужен внешний — например для photo-analysis с GPT Vision) или просто backend-функция (для текстогенерации)
- Новый React-компонент рендера результата
- Запись в `TOOL_REGISTRY` с параметрами

### 15.2 Реестр инструментов

```python
@dataclass
class ToolDefinition:
    type: ToolType
    name: str                          # "Парсер ниши Авито"
    step: int                          # 1..10 — связь с методологией
    price_kopeks: int                  # цена за разовый прогон
    duration_estimate_seconds: int     # ожидаемое время
    requires_external_worker: bool     # парсер да, генератор УТП нет
    result_schema: type[BaseModel]     # Pydantic схема результата
    render_component: str              # React-компонент для отчёта

TOOL_REGISTRY = {
    "competitor_analysis": ToolDefinition(
        type=ToolType.competitor_analysis,
        name="Парсер ниши Авито",
        step=1,
        price_kopeks=19_000,
        duration_estimate_seconds=1200,
        requires_external_worker=True,
        result_schema=ParserResult,
        render_component="ParserReportView",
    ),
    # ... позже добавляются "segmentation", "usp_generator", и т.д.
}
```

Фронт получает реестр через `GET /api/tools/registry` и автоматически рендерит каталог.

### 15.3 Подготовка БД к будущему

В `tool_runs.input_params` и `tool_runs.result_json` — JSONB. Любая структура любого инструмента влезет, миграции не нужны при добавлении нового tool_type.

В `parser_packs` нужна обобщённость? **Пока нет.** Парсер достаточно объёмный инструмент чтобы иметь свои пакеты. Когда появятся другие платные инструменты (например генератор УТП за 50 ₽) — будет отдельная таблица `usp_packs` или общая `tool_packs WITH tool_type`. Решим тогда.

### 15.4 Multi-worker роутинг

Когда появится Шаг 6 (анализ фото через GPT Vision) — это **другой worker** (не парсер). Backend должен роутить:

```
GET /api/internal/tools/runs/next?worker_id=...&tool_types=competitor_analysis,photo_analysis
```

Worker заявляет свои capabilities, берёт только те jobs которые умеет.

---

## 16. Documentation

### 16.1 OpenAPI auto-generation

FastAPI генерит OpenAPI из аннотаций. Главное:
- Все Pydantic-схемы — с описаниями (Field(description="..."))
- Все эндпоинты — с `summary` и `description`
- Все статус-коды задокументированы (`responses={402: {"description": "..."}}`)

`/docs` (Swagger UI) — закрыть для прода через `openapi_url=None` или basic auth. Для разработки оставить.

### 16.2 README в backend-проекте

Минимум:
- Как поднять локально (psql + venv + .env)
- Как накатить миграции
- Как запустить тесты
- Как добавить новый инструмент (ссылка на TOOL_REGISTRY)
- Как сделать ручную правку юзеру через админку

### 16.3 ADR (Architecture Decision Records)

Записывать **«почему так»** для нетривиальных решений:
- `ADR-001-no-autorenewal.md` — почему отказались от автопродления
- `ADR-002-claude-for-parser-only.md` — почему чат на gpt-5-mini, а парсер-разбор на Claude
- `ADR-003-pack-based-billing.md` — почему пакеты прогонов, а не universal balance

Папка `docs/adr/`. 1 файл = 1 решение. Когда передумаем — пишем новую ADR со ссылкой «отменяет ADR-XXX».

---

## 17. Чек-лист готовности к запуску R1

### Backend

- [ ] Миграция `wallets` + `parser_packs` + `wallet_transactions` + `tool_runs` накачена в прод
- [ ] При регистрации создаётся Wallet с `promo_runs_remaining=1`
- [ ] Существующие юзеры с подпиской получили квоту парсера на текущий месяц
- [ ] Эндпоинты `/api/tools/*` отвечают, идемпотентны
- [ ] Эндпоинты `/api/wallet/*` отвечают, webhook проверяет подпись
- [ ] `/api/internal/*` защищены X-Parser-Token + IP whitelist
- [ ] Rate limiting на запуск парсера: 3/час на юзера
- [ ] Background job система (arq/dramatiq) поднята, обрабатывает AI-задачи
- [ ] AI-разбор на Claude Sonnet работает, ошибки имеют retry
- [ ] Feature flag `FEATURE_PARSER_ENABLED` есть, выключен по умолчанию
- [ ] Sentry подключен и ловит ошибки
- [ ] Метрики Prometheus экспортятся
- [ ] Алерты на критические метрики настроены

### Worker (parser-VPS)

- [ ] Playwright + Xvfb + Chrome работает на VPS
- [ ] Мобильный прокси настроен и работает
- [ ] worker.py опрашивает backend, берёт jobs, парсит, возвращает результат
- [ ] systemd-сервис автоматически перезапускается при падении
- [ ] Логи пишутся в journald
- [ ] Тест: 5 прогонов подряд без бана IP

### Frontend (с моей помощью через patch-файлы)

- [ ] Страницы `/app/tools/competitor-analysis`, `/app/tools/competitor-analysis/runs/:id` работают
- [ ] Страницы `/app/billing` и `/app/wallet` работают
- [ ] Полоска прогресса 10 шагов в шапке чата работает
- [ ] ParserCard в чате имеет 3 состояния, SSE подключение работает
- [ ] Тема dark/light переключается на всех новых страницах
- [ ] Mobile-версия адаптирована

### QA

- [ ] End-to-end: регистрация → промо-прогон → парсер → отчёт → AI-разбор в чате
- [ ] Покупка пакета → списание прогона → возврат при failed
- [ ] Lim quota подписки: 5 прогонов проходят, 6-й идёт на пакет
- [ ] Отмена подписки в середине месяца → квота остаётся до конца оплаченного периода
- [ ] Load test: 50 одновременных запусков парсера в очередь, без падений

### Документация

- [ ] OpenAPI `/docs` актуален
- [ ] README backend обновлён
- [ ] Runbook на 3-4 типовых инцидента написан
- [ ] ADR на главные решения написаны
- [ ] Этот документ + ТЗ-дополнение + оригинальное ТЗ — переданы и приняты

### Деплой

- [ ] Бэкап БД перед миграцией
- [ ] Feature flag выкл при первом деплое
- [ ] Тестируется на Лере (single user)
- [ ] Включается всем после 24 часов без багов
- [ ] План rollback в кармане

---

**После запуска R1:**

| Срок | Что делаем |
|---|---|
| Неделя 1 | Мониторинг, исправление детских болячек |
| Месяц 1 | Сбор фидбека юзеров, метрики конверсии |
| R2 (после 1 месяца) | Подключение профиля Авито через API |
| R3 (после 3 месяцев) | Шаги 2-3 методологии, проекты, рефералка |

---

**Контакт:** Лера, saltykovatarget@gmail.com

# ТЗ: Telegram-бот — передача управления Лере

**Дата:** 2026-06-02
**От:** Лера → Иван
**Связано с:** `internal_bot.py` (патч от Ивана, лежит у Леры)

---

## 🎯 Что хочу

> Получить **полный контроль** над TG-ботом сервиса. Регистрировать юзеров (это уже работает), **писать самой**, **делать воронки реактивации** — без обращения к Ивану каждый раз.

Сейчас доступен только базовый каркас (`internal_bot.py`) — есть механизм dispatch'ей, но **нет интерфейса управления** и **сегментация устарела** (рассчитана под подписки `free/paid`).

---

## ⚠️ Что в текущем `internal_bot.py` устарело

Код был написан под подписочную модель. **В wallet-модели** надо заменить:

| Старое (подписки) | Новое (wallet) |
|---|---|
| `is_free_campaign` (для `plan=free`) | сегменты по балансу/активности |
| `is_paid_campaign` (для `plan!=free`) | сегменты по объёму пополнений |
| `user.plan` | `user.advance_payment_kopecks`, `last_activity_at`, `total_topped_up_kopecks` |
| `mark_dispatch_skipped(reason="plan_changed")` | `reason="balance_changed"` / `"became_active"` / ... |

---

## 📐 Новая модель сегментов (под wallet)

Перенести логику в **сегменты на основе поведения и баланса**:

| Сегмент | Условие | Маркетинговый смысл |
|---|---|---|
| `new_user_no_chat_24h` | Зарегистрировался, нет ни одного сообщения в чате 24+ ч | Onboarding: «попробуй задать первый вопрос» |
| `tried_chat_no_topup_3d` | Использовал стартовый бонус 50 ₽, не пополнил 3+ дня | Реактивация: «положи 100 ₽, продолжай работать» |
| `topped_up_no_parser_7d` | Пополнил кошелёк, не использовал парсер 7+ дней | Cross-sell: «попробуй парсер конкурентов» |
| `low_balance_5rub` | Баланс < 5 ₽ (на 1 ответ не хватит) | Пополнение |
| `inactive_14d` | Не заходил 14+ дней | Win-back |
| `parser_used_once_no_repeat_30d` | Запустил парсер 1 раз, не повторил 30 дней | Объяснить ценность повторных прогонов |
| `big_spender` | Пополнил суммарно > 5 000 ₽ | VIP-коммуникация, подарки |
| `custom_segment_<lera_id>` | Произвольный сегмент по списку TG-id или фильтру | Ручные кампании |

Это **минимум** для запуска. Дальше Лера сможет создавать свои сегменты сама.

---

## 🛠 Что нужно реализовать

### 1. БД: таблицы для кампаний (3 шт)

```sql
-- Кампании (описание + сегмент + текст + расписание)
CREATE TABLE bot_campaign (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,    -- 'onboarding_24h', 'low_balance', ...
    title VARCHAR(200) NOT NULL,         -- "Онбординг 24 часа"
    segment_code VARCHAR(64) NOT NULL,   -- 'new_user_no_chat_24h'
    message_text TEXT NOT NULL,          -- Текст с поддержкой {placeholder}
    inline_keyboard JSON,                 -- Опционально: кнопки {text, url}
    is_active BOOLEAN NOT NULL DEFAULT false,
    sent_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    -- метаданные
    created_by_user_id INTEGER REFERENCES users(id),  -- кто создал
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Назначения отправки конкретным юзерам (как сейчас в TelegramBotDispatch)
-- Уже существует в коде, нужно расширить
ALTER TABLE telegram_bot_dispatch
    ADD COLUMN campaign_id BIGINT REFERENCES bot_campaign(id);

-- Логи доставок (для статистики)
CREATE TABLE bot_message_log (
    id BIGSERIAL PRIMARY KEY,
    dispatch_id UUID REFERENCES telegram_bot_dispatch(id),
    user_id INTEGER REFERENCES users(id),
    campaign_id BIGINT REFERENCES bot_campaign(id),
    status VARCHAR(20) NOT NULL,         -- 'sent' | 'failed' | 'opened' | 'clicked'
    error_text TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_message_log_campaign ON bot_message_log(campaign_id, status, created_at);
```

### 2. Фоновый воркер: пересчёт сегментов

Раз в N минут (например, каждые 10–15) пересчитывает кого добавить в `telegram_bot_dispatch` под каждую активную кампанию.

```python
# Псевдокод
for campaign in get_active_campaigns():
    segment_func = SEGMENT_REGISTRY[campaign.segment_code]
    user_ids = segment_func(db)  # возвращает список user_id
    for user_id in user_ids:
        if not dispatch_exists(user_id, campaign.id):
            create_dispatch(user_id, campaign.id, scheduled_for=now())
```

### 3. Эндпоинты управления (для Леры)

Под её авторизацию (admin role или TG-id `valeriia_avitolog`):

```
POST   /api/admin/bot/campaigns
       Body: { code, title, segment_code, message_text, inline_keyboard?, is_active }
       → создать кампанию

GET    /api/admin/bot/campaigns?status=active&page=
       → список кампаний с метриками (sent / skipped / opened / clicked)

PUT    /api/admin/bot/campaigns/{id}
       → обновить (можно поправить текст, отключить, переключить сегмент)

DELETE /api/admin/bot/campaigns/{id}
       → удалить (soft delete — is_active=false)

POST   /api/admin/bot/campaigns/{id}/preview
       Body: { sample_user_id }
       → показать как будет выглядеть текст для конкретного юзера (с подстановкой)

POST   /api/admin/bot/campaigns/{id}/test
       Body: { telegram_id }
       → отправить тестовое сообщение Лере на её TG для проверки

POST   /api/admin/bot/broadcast
       Body: { message_text, inline_keyboard?, telegram_ids: [...] | segment_code }
       → разовая рассылка по списку TG-id или сегменту (без создания постоянной кампании)

GET    /api/admin/bot/segments
       → список доступных сегментов + сколько юзеров в каждом сейчас

GET    /api/admin/bot/stats/campaign/{id}
       → подробная статистика (по дням, конверсии)
```

### 4. Admin UI (минимальный)

Опционально на старте, но желательно. Простая страница в кабинете под видимая только Лере:

```
┌──────────────────────────────────────────────────┐
│  Бот-кампании                  [+ Новая]          │
├──────────────────────────────────────────────────┤
│  🟢 Онбординг 24ч             отправлено 47       │
│     new_user_no_chat_24h      пропущено 12        │
│     [✏️ Изменить] [⏸ Пауза] [📊 Статистика]      │
│                                                    │
│  🟢 Низкий баланс             отправлено 89       │
│     low_balance_5rub          конверсия 23%       │
│     [✏️] [⏸] [📊]                                │
│                                                    │
│  ⚪ Win-back 14 дней           черновик            │
│     inactive_14d              [▶️ Запустить]      │
└──────────────────────────────────────────────────┘
```

Если делать UI сложно — на старте достаточно работать через **API + Postman/Insomnia**, или через **прямые INSERT в БД** + Лера будет пользоваться скриптами/Notion-таблицей.

### 5. Регистрация админ-прав за Лерой

В БД:
```sql
ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user';
-- role = 'user' | 'admin' | 'super_admin'

-- Лере выдать super_admin (по её telegram_id)
UPDATE users SET role = 'super_admin' WHERE telegram_id = <Лерин_TG_ID>;
```

В эндпоинтах админки проверять `role IN ('admin', 'super_admin')`.

### 6. Placeholders в текстах кампаний

Чтобы Лера могла писать персонализированные тексты:

```
Текст кампании:
"Привет, {first_name}! У тебя на балансе {balance_rub} ₽.
Не хватит на парсер (190 ₽) — пополни кошелёк со скидкой:
https://aiavitologpro.ru/topup?ref=bot"
```

Минимум доступных переменных: `{first_name}`, `{balance_rub}`, `{advance_payment_rub}`, `{days_since_registration}`, `{last_chat_date}`.

### 7. Защита от спама

- **Rate limit на юзера**: не больше N кампаний в день (например, 2)
- **Quiet hours**: не отправлять в 23:00–09:00 МСК (только если кампания не помечена `urgent`)
- **Опт-аут**: команда `/stop` в боте → выставляет `users.bot_messages_disabled = true`. Уважаем выбор.

---

## 📋 Чеклист передачи (что хочу получить от Ивана)

- [ ] Адаптировать `internal_bot.py` под wallet-модель (убрать `plan`, добавить новые сегменты)
- [ ] Развернуть отдельный сервис `tg_bot` рядом с основным backend
- [ ] Реализовать 3 таблицы БД (campaign, message_log + extend dispatch)
- [ ] Сделать 8 admin-эндпоинтов
- [ ] Запустить воркер пересчёта сегментов (каждые 10–15 мин)
- [ ] Прописать Лере `role='super_admin'` по её TG-id
- [ ] Документация: как создать кампанию через API (короткий гайд + Postman-коллекция)
- [ ] (Опционально) Простой UI в кабинете Леры — список кампаний + кнопка «Новая»
- [ ] (Опционально) Webhook на клики по inline-кнопкам — для метрики конверсий

---

## ⏱ Сроки

Это **НЕ блокер для R1** — релизим без бот-кампаний. Делаем в R1.5 (сразу после запуска R1, в течение 1 недели).

Оценка работ: **3–4 рабочих дня**:
- Миграции БД и адаптация сегментов: 1 день
- Воркер + эндпоинты: 1–2 дня
- Опт-аут / rate-limit / quiet hours: ½ дня
- Документация + Postman: ½ дня

UI можно отложить — Лера готова на старте работать через Postman.

---

## 🔐 Безопасность

- Эндпоинты `/api/admin/bot/*` — **только для `role IN ('admin', 'super_admin')`**
- Заголовок `X-Bot-Token` для коммуникации backend ↔ tg_bot service (уже реализовано в `_require_bot_token`)
- Логи всех админ-действий (create/update/delete campaign) — audit trail
- Опт-аут юзера должен быть **навсегда**, пока юзер сам не вернёт через `/start`

---

## 💡 Идеи воронок (Лера запустит)

Несколько готовых воронок чтобы было с чего начать:

### Воронка 1 — Онбординг (3 шага)

| Триггер | Когда | Сообщение |
|---|---|---|
| Регистрация | Сразу | «Привет! У тебя 50 ₽ бонусом. Задай первый вопрос: [кнопка]» |
| Нет чата 24ч | +24ч после регистрации | «Не успел попробовать? Пример вопроса: «как поднять CTR в нише N»» |
| Использовал бонус, не пополнил | +3 дня | «Понравилось? Пополни 100 ₽ — продолжай работать» |

### Воронка 2 — Реактивация

| Триггер | Когда | Сообщение |
|---|---|---|
| Не заходил 7 дней | — | «Вышло обновление методологии: {что нового}» |
| Не заходил 14 дней | — | «Скучаешь по нам? Вот разбор актуальной ниши: {ссылка на статью}» |
| Не заходил 30 дней | — | «Привет, пропадаешь? Если что-то не работает — напиши, починим. {Лера лично}» |

### Воронка 3 — Cross-sell

| Триггер | Когда | Сообщение |
|---|---|---|
| Пользуется чатом, не пробовал парсер | Через 7 дней активного чата | «Видишь конкурентов в нише? Парсер сделает разбор за 5 минут: [кнопка]» |
| 3+ парсера за месяц | После 3-го парсера | «Активно работаешь — спасибо! Сегодня скидка на пакет 990 ₽: [кнопка]» |

---

**Связь:** Лера · TG @valeriia_avitolog

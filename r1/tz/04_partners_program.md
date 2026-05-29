# ТЗ: Партнёрская программа AI Авитолог PRO

**Дата:** 2026-05-29
**Автор:** Валерия Салтыкова (через AI-ассистента)
**Получатель:** Иван (бэкенд + фронт интеграция)
**Версия:** 1.0
**Связанные документы:**
- `ТЗ_парсер_интеграция.md` — основной модуль парсера
- `ТЗ_дополнение_кабинет_и_кошелёк.md` — кабинет и кошелёк
- `ТЗ_бэкенд_глубокое_расширение.md` — общая бэкенд-архитектура

---

## 1. Цель

Запустить tiered-партнёрку с пожизненными выплатами и автоматическим повышением уровня. Партнёр приводит платящих клиентов → получает % с каждого их платежа.

**Бизнес-задача:** партнёрский канал должен закрывать 20–30% новых платных подписок к концу первого года работы.

---

## 2. Условия программы (зафиксированы)

### 2.1 Tier-структура

| Уровень | % с платежа | Условие повышения |
|---|---|---|
| **Старт** | 20% | от 1 платящего реферала |
| **Эксперт** | 30% | от 10 активных платящих рефералов |
| **Лидер** | 40% | от 30 активных платящих рефералов |

**Активный реферал** = клиент, у которого **в текущем месяце был успешный платёж** по подписке (не возврат, не chargeback).

**Понижение уровня:** если активных рефералов стало меньше → партнёр **остаётся на текущем уровне до конца месяца**, затем автоматически понижается при следующем cron-пересчёте (см. §6.4).

### 2.2 Срок выплат

**Lifetime** (пожизненно). Партнёр получает % с каждого платежа реферала, пока реферал активен. Без cap по сроку, без cap по сумме.

### 2.3 Атрибуция

- **Cookie-based** + **server-side fallback** (см. §4)
- **Срок жизни cookie:** 90 дней (last-click attribution)
- **Окно конверсии:** регистрация в течение 90 дней с клика → реферал засчитывается партнёру

### 2.4 Что НЕ начисляется

- Возвраты (refund) — % списывается с баланса партнёра
- Chargeback — аналогично списание
- Тестовые / промо платежи (с пометкой `is_test=true`)
- Если реферал = сам партнёр (self-referral)

### 2.5 Выплаты партнёру

- **Минимум для вывода:** 1 000 ₽
- **Способы:** перевод на карту / СБП по номеру телефона / на криптокошелёк USDT (TRC-20)
- **Срок выплаты:** до 7 рабочих дней после заявки
- **Налоги:** партнёр самозанятый или ИП → подаёт чек/УПД сам, мы перечисляем валовую сумму

---

## 3. Архитектура (общая)

```
┌─────────────────────────────────────────────────┐
│  Landing /partners-section (готов)              │
│  ↓ CTA «Стать партнёром»                        │
├─────────────────────────────────────────────────┤
│  Application form (TODO)                        │
│  ↓ создаём partner_profile (status=pending)     │
├─────────────────────────────────────────────────┤
│  Admin moderation (TODO)                        │
│  ↓ approve → status=active, генерим ref_code    │
├─────────────────────────────────────────────────┤
│  Partner cabinet /partners/dashboard (TODO)     │
│  • Реф. ссылка, QR, промо-материалы             │
│  • Статистика: клики, регистрации, активные     │
│  • Текущий tier, доход, баланс                  │
│  • Заявки на вывод                              │
└─────────────────────────────────────────────────┘
```

---

## 4. Tracking рефералов (как отслеживать)

### 4.1 Реферальная ссылка

Формат: `https://aiavitologpro.ru/?ref=<code>`

Где `<code>` — короткий уникальный код, 6–8 символов алфавит+цифры (base62), генерируется при approve партнёра.

Примеры:
- `aiavitologpro.ru/?ref=lera2026`
- `aiavitologpro.ru/?ref=k3mF9pZ`

**Альтернативная форма** (опционально позже): `aiavitologpro.ru/r/<code>` — для красивого вида в постах.

### 4.2 Cookie + server-side трекинг

Когда пользователь заходит по реф-ссылке:

**Frontend (Landing):**
```ts
// На любой странице с ?ref=<code>:
const params = new URLSearchParams(window.location.search);
const refCode = params.get('ref');

if (refCode) {
  // 1. Сохранить в cookie (90 дней, SameSite=Lax)
  document.cookie = `ref_code=${refCode}; max-age=${90*24*3600}; path=/; SameSite=Lax`;

  // 2. Отправить click-event в API (для статистики)
  fetch('/api/partners/track-click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref_code: refCode,
      referrer: document.referrer,
      user_agent: navigator.userAgent,
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
    }),
  });

  // 3. Убрать ref из URL (clean URL)
  params.delete('ref');
  const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.replaceState({}, '', newUrl);
}
```

**Backend (на регистрации):**

При создании User → если в cookie есть `ref_code`:
1. Найти `partner_profile` по `ref_code`
2. Проверить:
   - партнёр активен (`status=active`)
   - не self-referral (`partner.user_id !== new_user.id`)
   - реферал ещё не привязан к другому партнёру
   - регистрация в окне 90 дней с клика
3. Создать запись `referral` со связкой `partner_id ↔ referred_user_id`
4. Очистить cookie `ref_code`

### 4.3 Edge cases

- **Пользователь сменил девайс / куки сбросил** → реф-связка не пройдёт. Это приемлемая потеря (≈10–15% по индустрии).
- **Несколько ref-кликов подряд от разных партнёров** → last-click wins, перезаписываем cookie.
- **Уже зарегистрированный пользователь зашёл по ref** → не привязываем, ref игнорируется (только новые регистрации).
- **Реферал зарегистрировался, но не оплатил** → засчитывается как «лид», но не как «активный». Платёж — триггер начисления.

---

## 5. Схема БД

```sql
-- Партнёр (расширение profile или отдельная таблица)
CREATE TABLE partner_profile (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id),
  ref_code VARCHAR(16) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending / active / banned
  tier VARCHAR(20) NOT NULL DEFAULT 'starter',   -- starter / expert / leader
  payout_method VARCHAR(20),                     -- card / sbp / usdt_trc20
  payout_details JSONB,                          -- {phone, card_number_masked, wallet_address, ...}
  applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMP,
  approved_by BIGINT REFERENCES users(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_profile_status ON partner_profile(status);
CREATE INDEX idx_partner_profile_tier ON partner_profile(tier);

-- Клики по реферальной ссылке (для аналитики)
CREATE TABLE partner_click (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NOT NULL REFERENCES partner_profile(id),
  ref_code VARCHAR(16) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  referrer TEXT,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  fingerprint VARCHAR(64),  -- для дедупликации (опционально)
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_click_partner_id ON partner_click(partner_id);
CREATE INDEX idx_partner_click_created_at ON partner_click(created_at);

-- Реферальные связки
CREATE TABLE referral (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NOT NULL REFERENCES partner_profile(id),
  referred_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id),
  ref_code VARCHAR(16) NOT NULL,
  click_id BIGINT REFERENCES partner_click(id),
  status VARCHAR(20) NOT NULL DEFAULT 'registered', -- registered / paying / churned / banned
  first_payment_at TIMESTAMP,
  last_payment_at TIMESTAMP,
  total_earned BIGINT NOT NULL DEFAULT 0, -- всего начислено партнёру в копейках
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referral_partner_id ON referral(partner_id);
CREATE INDEX idx_referral_status ON referral(status);

-- Начисления партнёру (одна запись на каждый платёж реферала)
CREATE TABLE partner_commission (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NOT NULL REFERENCES partner_profile(id),
  referral_id BIGINT NOT NULL REFERENCES referral(id),
  payment_id BIGINT NOT NULL REFERENCES payments(id),   -- исходный платёж реферала
  tier_at_time VARCHAR(20) NOT NULL,                    -- какой tier был на момент начисления
  percent_at_time INTEGER NOT NULL,                     -- 20 / 30 / 40
  payment_amount_kopecks BIGINT NOT NULL,               -- сумма платежа реферала
  commission_amount_kopecks BIGINT NOT NULL,            -- начисление партнёру
  status VARCHAR(20) NOT NULL DEFAULT 'accrued',        -- accrued / paid / reversed
  reversed_reason TEXT,
  reversed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_commission_partner_id ON partner_commission(partner_id);
CREATE INDEX idx_partner_commission_status ON partner_commission(status);
CREATE INDEX idx_partner_commission_referral_id ON partner_commission(referral_id);

-- Заявки на вывод
CREATE TABLE partner_payout (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NOT NULL REFERENCES partner_profile(id),
  amount_kopecks BIGINT NOT NULL,
  method VARCHAR(20) NOT NULL,                          -- card / sbp / usdt_trc20
  destination JSONB NOT NULL,                           -- куда отправлять (карта/телефон/wallet)
  status VARCHAR(20) NOT NULL DEFAULT 'requested',      -- requested / approved / paid / rejected / cancelled
  reject_reason TEXT,
  processed_by BIGINT REFERENCES users(id),
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  external_tx_id VARCHAR(200)                           -- ID транзакции в платёжной системе
);

CREATE INDEX idx_partner_payout_partner_id ON partner_payout(partner_id);
CREATE INDEX idx_partner_payout_status ON partner_payout(status);
```

---

## 6. Бизнес-логика

### 6.1 Создание партнёра

1. Пользователь жмёт «Стать партнёром» на лендинге → попадает на форму `/partners/apply`
2. Форма (auth required — нужно сначала зарегистрироваться как обычный user):
   - Имя / контакт (Telegram, email уже из профиля)
   - Откуда узнал о нас
   - Тип партнёра: авитолог / агентство / блогер / другое
   - Аудитория (число подписчиков / клиентов)
   - Реквизиты выплат (можно добавить позже)
   - Согласие с офертой партнёра
3. Создаётся запись `partner_profile(status='pending')`
4. Уведомление админу (TG-бот / email)
5. Админ approve / reject в админке
6. При approve:
   - Генерируем `ref_code` (6–8 chars base62, unique check)
   - Меняем status=active
   - Отправляем письмо партнёру с инструкцией + ссылкой
7. При reject: уведомление партнёру с причиной

### 6.2 Привязка реферала (на регистрации)

```python
# psevdokod в auth router
def register_user(request, payload):
    user = create_user(payload)

    # Check referral
    ref_code = request.cookies.get('ref_code')
    if ref_code:
        partner = get_partner_by_ref_code(ref_code)
        if partner and partner.status == 'active' and partner.user_id != user.id:
            # Проверка окна 90 дней
            last_click = get_last_click(partner.id, fingerprint=get_fingerprint(request))
            if last_click and (now() - last_click.created_at).days <= 90:
                create_referral(
                    partner_id=partner.id,
                    referred_user_id=user.id,
                    ref_code=ref_code,
                    click_id=last_click.id,
                    status='registered',
                )

    return user
```

### 6.3 Начисление на платеже

В webhook обработчике успешного платежа:

```python
def on_payment_success(payment):
    referral = get_referral_by_user_id(payment.user_id)
    if not referral or referral.status == 'banned':
        return

    partner = get_partner(referral.partner_id)
    if partner.status != 'active':
        return

    # Текущий tier партнёра (на момент платежа)
    tier = partner.tier
    percent = TIER_PERCENT[tier]  # {'starter': 20, 'expert': 30, 'leader': 40}

    commission_amount = payment.amount * percent // 100

    create_partner_commission(
        partner_id=partner.id,
        referral_id=referral.id,
        payment_id=payment.id,
        tier_at_time=tier,
        percent_at_time=percent,
        payment_amount_kopecks=payment.amount,
        commission_amount_kopecks=commission_amount,
        status='accrued',
    )

    # Обновить статистику реферала
    if not referral.first_payment_at:
        referral.first_payment_at = now()
    referral.last_payment_at = now()
    referral.total_earned += commission_amount
    referral.status = 'paying'
    save(referral)
```

### 6.4 Cron: пересчёт tier'ов

Раз в день (например в 02:00 МСК) запускаем job:

```python
def recalculate_tiers():
    for partner in get_all_active_partners():
        active_count = count_active_referrals(
            partner_id=partner.id,
            window_days=30,  # активные = были платежи в последние 30 дней
        )

        new_tier = compute_tier(active_count)
        if new_tier != partner.tier:
            old_tier = partner.tier
            partner.tier = new_tier
            save(partner)
            notify_partner_tier_change(partner, old_tier, new_tier)

def compute_tier(active_count: int) -> str:
    if active_count >= 30:
        return 'leader'    # 40%
    if active_count >= 10:
        return 'expert'    # 30%
    return 'starter'       # 20%
```

### 6.5 Обработка возвратов / chargeback

```python
def on_payment_refund(payment, reason):
    commission = get_commission_by_payment_id(payment.id)
    if not commission or commission.status != 'accrued':
        return

    # Reverse начисление
    commission.status = 'reversed'
    commission.reversed_reason = reason
    commission.reversed_at = now()
    save(commission)

    # Списываем с баланса партнёра (если ещё не выплачено)
    if partner_balance(commission.partner_id) >= commission.commission_amount_kopecks:
        decrease_balance(commission.partner_id, commission.commission_amount_kopecks)
    else:
        # Записываем в долг — учтём при следующих начислениях
        create_debt_record(commission.partner_id, commission.commission_amount_kopecks)
```

### 6.6 Заявка на вывод

```python
def request_payout(partner, amount, method, destination):
    if amount < 100_000:  # 1000 ₽ в копейках
        raise BusinessError("Минимум для вывода — 1 000 ₽")

    balance = compute_available_balance(partner.id)
    if amount > balance:
        raise BusinessError(f"Доступно к выводу: {format_rub(balance)}")

    payout = create_partner_payout(
        partner_id=partner.id,
        amount_kopecks=amount,
        method=method,
        destination=destination,
        status='requested',
    )
    notify_admin_new_payout(payout)
    return payout

def compute_available_balance(partner_id):
    # Все accrued начисления
    accrued = sum_commissions(partner_id, status='accrued')
    # Минус reversed
    reversed = sum_commissions(partner_id, status='reversed')
    # Минус уже выплаченные / в обработке
    paid_or_pending = sum_payouts(partner_id, status__in=['requested', 'approved', 'paid'])
    return accrued - reversed - paid_or_pending
```

---

## 7. API endpoints

### Партнёрские (для cabinet)

```
POST   /api/partners/apply
       body: { type, audience_size, source, comment }
       → создание заявки, status=pending

GET    /api/partners/me
       → { id, ref_code, status, tier, balance, total_earned, ... }

GET    /api/partners/me/referrals
       query: ?status=&page=
       → { items: [{ user_id_masked, registered_at, first_payment_at, total_earned, status }], total }

GET    /api/partners/me/commissions
       query: ?from=&to=&page=
       → { items: [{ payment_date, referral_email_masked, amount, percent, tier, status }], total, summary }

POST   /api/partners/me/payout
       body: { amount_kopecks, method, destination }
       → создание заявки на вывод

GET    /api/partners/me/payouts
       → история выводов

GET    /api/partners/me/promo
       → { promo_text_templates, banners, qr_url, scripts_for_dm }
```

### Tracking

```
POST   /api/partners/track-click
       body: { ref_code, referrer, user_agent, utm_* }
       → 204
```

### Admin

```
GET    /api/admin/partners
       query: ?status=&tier=&page=
       → список партнёров с метриками

POST   /api/admin/partners/{id}/approve
POST   /api/admin/partners/{id}/reject  body: { reason }
POST   /api/admin/partners/{id}/ban     body: { reason }
POST   /api/admin/partners/{id}/set-tier body: { tier }  // ручное переопределение

GET    /api/admin/payouts?status=requested
POST   /api/admin/payouts/{id}/approve
POST   /api/admin/payouts/{id}/reject   body: { reason }
POST   /api/admin/payouts/{id}/mark-paid body: { external_tx_id }
```

---

## 8. UI: кабинет партнёра

Маршрут: `/partners/dashboard` (требует auth + partner_profile.status=active)

### Главная страница кабинета

```
┌──────────────────────────────────────────────────────┐
│  [Header с навигацией]                                │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Привет, [Имя] 👋                                     │
│  Твой уровень: [Эксперт ★]   30% с платежей          │
│                                                       │
│  ┌─────────────┬─────────────┬─────────────┐         │
│  │ ВСЕГО       │ АКТИВНЫЕ    │ К ВЫПЛАТЕ   │         │
│  │ 47          │ 12 / 30     │ 23 740 ₽    │         │
│  │ рефералов   │ до Лидера   │ [Вывести]   │         │
│  └─────────────┴─────────────┴─────────────┘         │
│                                                       │
│  ┌──────────────────────────────────────────┐        │
│  │  Твоя реферальная ссылка                  │        │
│  │  aiavitologpro.ru/?ref=lera2026  [📋]    │        │
│  │  [QR-код]                                 │        │
│  └──────────────────────────────────────────┘        │
│                                                       │
│  ─── ПОСЛЕДНИЕ НАЧИСЛЕНИЯ ──────────────────         │
│  • 29 май · client@*****.ru · 1 287 ₽ (30%)          │
│  • 28 май · ivan@*****.ru · 858 ₽ (30%)              │
│  • 27 май · maria@*****.ru · 477 ₽ (30%)             │
│  [Все начисления →]                                   │
│                                                       │
│  ─── ПРОМО-МАТЕРИАЛЫ ───────────────────────         │
│  [Тексты постов] [Скрипты для DM] [Баннеры]          │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### Прочие страницы кабинета

- `/partners/dashboard/referrals` — таблица рефералов с фильтрами
- `/partners/dashboard/commissions` — все начисления
- `/partners/dashboard/payouts` — история и новая заявка на вывод
- `/partners/dashboard/promo` — промо-материалы для скачивания
- `/partners/dashboard/settings` — реквизиты, контакты, оферта

---

## 9. Промо-материалы (для партнёров)

Должны быть готовы к запуску (тексты сделаю я, Иван хостит):

- 3 текста для постов (короткий / средний / длинный)
- 2 скрипта для DM клиентам
- Баннер 1080×1080 + 1920×1080 + 1080×1920
- QR-код с реф-ссылкой (генерится на лету по `/api/partners/me/promo/qr.png`)
- PDF презентация-однопейджер «Что такое AI Авитолог PRO»

---

## 10. Безопасность

### 10.1 Anti-fraud

- **Self-referral detection**: при привязке проверяем `partner.user_id !== referred.id`
- **IP / fingerprint logging**: если 5+ регистраций с одного IP/fingerprint за час → ручная проверка
- **Платёж с карты партнёра**: если карта последних 4 цифр совпадает с картой партнёра → fraud-флаг
- **Подозрительный паттерн платежей**: если реферал подключает Basic, оплачивает 1 раз, потом возврат → автоматический бан реферала + reverse commission

### 10.2 GDPR / 152-ФЗ

- В кабинете партнёра email/имя рефералов **маскируются**: `m***@gmail.com`
- Партнёр **не видит** телефон/полное имя реферала
- Можно показывать только: дата регистрации, статус (платит / не платит), сумма заработка с него

### 10.3 Лимиты на API

- `/api/partners/track-click` — rate-limit 60/min по IP
- `/api/partners/me/payout` — макс. 1 заявка в день
- `/api/admin/partners/{id}/set-tier` — audit-log

---

## 11. Метрики мониторинга

В админке/Grafana:

- Кол-во активных партнёров по tier'ам
- Конверсия Click → Registration (по партнёрам)
- Конверсия Registration → First Payment (по партнёрам)
- LTV реферала vs LTV прямого клиента
- Распределение выплат (mean, median, p95)
- Месячная стоимость программы (% от MRR)

**Бюджет программы (план):**
- К концу 1 года: программа = 10–15% от MRR
- К концу 2 года: 20–25% от MRR
- Если выше 30% → сигнал к пересмотру условий

---

## 12. Этапы внедрения

### Этап 1 — MVP (1–2 недели)

1. Миграции БД (5 таблиц)
2. Click-tracking (cookie + endpoint)
3. Привязка реферала на регистрации
4. Начисление commission на платежах
5. Простая форма заявки + ручной approve в админке
6. Минимальный кабинет (ссылка, балансы, реферал-список)
7. Заявка на вывод (без автомата — обрабатываю я)

### Этап 2 — автоматизация (+1 неделя)

8. Cron пересчёта tier'ов
9. Обработка refund/chargeback
10. Промо-материалы в кабинете
11. Уведомления (новый реферал заплатил, tier повышен, выплата проведена)

### Этап 3 — масштаб (когда будет 50+ партнёров)

12. Авто-выплаты через API (Юкасса payouts / СБП API)
13. Доп. отчёты для админа
14. Anti-fraud-эвристики (см. §10.1)

---

## 13. Связь с существующими модулями

- **Используется существующая таблица** `users` (партнёр = user с partner_profile)
- **Используется существующая таблица** `payments` (для начислений)
- **Использует** existing webhook платежей — добавить хук
- **Использует** existing email/TG-уведомления

**НЕ дублирует** `wallet` модуль из ТЗ-кошелька — партнёрский баланс отдельная сущность (`partner_commission` + `partner_payout`).

---

## 14. Что НЕ входит в MVP (опционально позже)

- ❌ Многоуровневая партнёрка (MLM) — только 1 уровень
- ❌ Партнёрские купоны на скидку клиенту — пока без бонуса клиенту
- ❌ Подпартнёры (партнёр приводит партнёра)
- ❌ A/B-тестирование посадочных по партнёрам
- ❌ Лидерборд («топ-10 партнёров месяца») — если зайдёт, добавим как геймификацию

---

## 15. Открытые вопросы (нужно решить с Лерой)

- [ ] **Минимум активных для повышения tier'а** — точно 10 / 30 или скорректируем?
- [ ] **Реверс начислений** — за какой срок принимаем chargeback (30 / 60 / 90 дней)?
- [ ] **Self-onboarding** — после approve партнёр сам заходит в кабинет, или нужен welcome-call?
- [ ] **Промо-материалы** — кто готовит дизайн (Лера сама / дизайнер)?
- [ ] **Налоги** — закрепляем оферту что партнёр сам платит НДФЛ/НПД, или удерживаем?
- [ ] **Срок ожидания approve** — какой SLA на ручную модерацию (24ч / 48ч / 7д)?

---

## 16. Чеклист для запуска

- [ ] Миграции БД применены
- [ ] Click tracking работает (e2e тест: клик → cookie → регистрация → referral создан)
- [ ] Начисление commission работает (e2e тест: реферал платит → commission создан)
- [ ] Cron tier-recalc запущен и протестирован
- [ ] Форма заявки на лендинге работает
- [ ] Админка для approve / reject готова
- [ ] Кабинет партнёра минимальный готов
- [ ] Заявка на вывод + ручная обработка работает
- [ ] Юридически: оферта партнёра подписывается при apply
- [ ] Тестовый партнёр-аккаунт создан, прошли весь flow
- [ ] Уведомления (email/TG) на ключевых событиях работают

---

**Лера, скажи если что-то непонятно или нужно перераспределить акценты.**

После согласования открытых вопросов (§15) Иван может начинать с Этапа 1.

# ТЗ: Партнёрская программа — 30% разовый бонус

**Дата:** 2026-06-01
**Версия:** 2.0 (адаптирована под wallet-модель)
**Стек:** FastAPI + PostgreSQL + Telegram auth

---

## 🎯 Главное в одном абзаце

Партнёр получает **30% от первого пополнения** каждого приведённого им клиента. **Один раз** на каждого реферала. Без tier'ов, без quota'ов, без cron'ов, без условий по объёму. Минимальный вывод 1 000 ₽.

Это **самая простая партнёрская модель** — реализация ~3–4 дня бэка вместо ~10 дней с tier-моделью.

---

## 📐 Условия

| Параметр | Значение |
|---|---|
| **Тип** | Single payout (разовая выплата) |
| **% комиссии** | **30%** |
| **Базис** | Первое пополнение реферала (любое — package или regular) |
| **Срок** | Без срока (атрибуция бессрочная) |
| **Окно атрибуции по клику** | 90 дней (cookie-based) |
| **Минимум для вывода** | 1 000 ₽ |
| **Способы вывода** | Карта / СБП / USDT TRC-20 |
| **Срок выплаты** | До 7 рабочих дней (после approve админом) |

**Примеры:**
- Реферал положил 100 ₽ → партнёру **30 ₽**
- Реферал положил 390 ₽ (пакет) → партнёру **117 ₽**
- Реферал положил 990 ₽ (пакет) → партнёру **297 ₽**
- Реферал положил 1 490 ₽ (пакет) → партнёру **447 ₽**

---

## 🚫 Чего НЕТ в модели

❌ Tier'ы (Старт / Эксперт / Лидер)
❌ Quota активных рефералов
❌ Cron пересчёта уровня партнёра
❌ Recurring выплаты (lifetime % с каждого платежа)
❌ Промокоды клиенту
❌ Подпартнёры (MLM)
❌ Лидерборды

Если что-то из этого захотим — добавим **позже** (легко расширить).

---

## 🗃 Схема БД

### Миграция 1 — Поля в `users`

```python
op.add_column('users',
    sa.Column('referred_by_partner_id', sa.BigInteger(),
              sa.ForeignKey('partner_profile.id'), nullable=True))
op.add_column('users',
    sa.Column('partner_commission_paid', sa.Boolean(),
              nullable=False, server_default='false'))
op.create_index('idx_users_referred_by_partner',
                'users', ['referred_by_partner_id'])
```

`partner_commission_paid` = `true` после того как комиссия начислена партнёру. **Защита от двойной выплаты**.

### Миграция 2 — Таблица `partner_profile`

```python
op.create_table('partner_profile',
    sa.Column('id', sa.BigInteger(), primary_key=True),
    sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'),
              nullable=False, unique=True),
    sa.Column('ref_code', sa.String(16), nullable=False, unique=True),
    sa.Column('status', sa.String(20), nullable=False,
              server_default='pending'),  # pending / active / banned
    sa.Column('payout_method', sa.String(20)),  # card / sbp / usdt_trc20
    sa.Column('payout_details', sa.JSON()),  # {phone, card_last4, wallet_address...}
    # Денормализованные счётчики (обновляем при коммиссии)
    sa.Column('total_referrals_count', sa.Integer(),
              nullable=False, server_default='0'),
    sa.Column('paid_referrals_count', sa.Integer(),
              nullable=False, server_default='0'),
    sa.Column('total_earned_kopecks', sa.BigInteger(),
              nullable=False, server_default='0'),
    sa.Column('total_paid_out_kopecks', sa.BigInteger(),
              nullable=False, server_default='0'),
    sa.Column('available_balance_kopecks', sa.BigInteger(),
              nullable=False, server_default='0'),
    sa.Column('applied_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    sa.Column('approved_at', sa.TIMESTAMP()),
    sa.Column('approved_by', sa.Integer(), sa.ForeignKey('users.id')),
)
op.create_index('idx_partner_profile_status', 'partner_profile', ['status'])
op.create_index('idx_partner_profile_ref_code', 'partner_profile', ['ref_code'])
```

### Миграция 3 — Таблица `partner_commission`

```python
op.create_table('partner_commission',
    sa.Column('id', sa.BigInteger(), primary_key=True),
    sa.Column('partner_id', sa.BigInteger(),
              sa.ForeignKey('partner_profile.id'), nullable=False),
    sa.Column('referred_user_id', sa.Integer(),
              sa.ForeignKey('users.id'), nullable=False),
    sa.Column('source_payment_id', sa.Integer(),
              sa.ForeignKey('payments.id'), nullable=False),
    sa.Column('source_wallet_tx_id', sa.BigInteger(),
              sa.ForeignKey('wallet_transactions.id'), nullable=False),
    sa.Column('referral_topup_kopecks', sa.BigInteger(), nullable=False),
    sa.Column('commission_kopecks', sa.BigInteger(), nullable=False),  # 30% от topup
    sa.Column('status', sa.String(20), nullable=False,
              server_default='accrued'),  # accrued / paid / reversed
    sa.Column('reversed_reason', sa.String(255)),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
)
op.create_index('idx_partner_commission_partner_id',
                'partner_commission', ['partner_id', 'created_at'])
op.create_index('idx_partner_commission_referred_user',
                'partner_commission', ['referred_user_id'])
```

### Миграция 4 — Таблица `partner_payout` (заявки на вывод)

```python
op.create_table('partner_payout',
    sa.Column('id', sa.BigInteger(), primary_key=True),
    sa.Column('partner_id', sa.BigInteger(),
              sa.ForeignKey('partner_profile.id'), nullable=False),
    sa.Column('amount_kopecks', sa.BigInteger(), nullable=False),
    sa.Column('method', sa.String(20), nullable=False),
    sa.Column('destination', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(20), nullable=False,
              server_default='requested'),  # requested / approved / paid / rejected
    sa.Column('reject_reason', sa.String(255)),
    sa.Column('external_tx_id', sa.String(200)),
    sa.Column('processed_by', sa.Integer(), sa.ForeignKey('users.id')),
    sa.Column('requested_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    sa.Column('processed_at', sa.TIMESTAMP()),
)
op.create_index('idx_partner_payout_partner_id',
                'partner_payout', ['partner_id', 'requested_at'])
op.create_index('idx_partner_payout_status', 'partner_payout', ['status'])
```

### Миграция 5 — Таблица `partner_click` (для аналитики, опционально)

```python
op.create_table('partner_click',
    sa.Column('id', sa.BigInteger(), primary_key=True),
    sa.Column('partner_id', sa.BigInteger(),
              sa.ForeignKey('partner_profile.id'), nullable=False),
    sa.Column('ref_code', sa.String(16), nullable=False),
    sa.Column('ip_address', sa.String(45)),
    sa.Column('user_agent', sa.Text()),
    sa.Column('referrer', sa.Text()),
    sa.Column('utm_source', sa.String(100)),
    sa.Column('utm_medium', sa.String(100)),
    sa.Column('utm_campaign', sa.String(100)),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
)
op.create_index('idx_partner_click_partner_id',
                'partner_click', ['partner_id', 'created_at'])
```

Опционально — но полезно для статистики Click → Registration → First Payment.

---

## 🔗 Tracking реферала

### 1. Клик по реф-ссылке

Формат: `https://aiavitologpro.ru/?ref=<code>`

`ref_code` — 6–8 символов base62, уникальный на партнёра.

**На фронте** (Landing):
```ts
// При заходе на любую страницу:
const refCode = new URLSearchParams(window.location.search).get('ref');
if (refCode) {
  document.cookie = `ref_code=${refCode}; max-age=${90*24*3600}; path=/; SameSite=Lax`;
  // Отправка click-event для статистики (опционально):
  fetch('/api/partners/track-click', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ ref_code: refCode, referrer: document.referrer }),
  });
  // Чистим URL:
  const url = new URL(window.location.href);
  url.searchParams.delete('ref');
  window.history.replaceState({}, '', url.toString());
}
```

### 2. Регистрация юзера

При создании User проверяем cookie `ref_code`:

```python
def register_user(request, payload):
    user = create_user(payload)  # обычная регистрация
    
    # Привязка реферала
    ref_code = request.cookies.get('ref_code')
    if ref_code:
        partner = db.query(PartnerProfile).filter_by(
            ref_code=ref_code, status='active'
        ).first()
        if partner and partner.user_id != user.id:  # not self-referral
            user.referred_by_partner_id = partner.id
            user.partner_commission_paid = False
            db.commit()
    
    return user
```

**Edge cases:**
- ref_code невалидный → игнорируем
- self-referral → игнорируем (партнёр сам себе реферал)
- partner.status != 'active' → игнорируем

### 3. Списание комиссии (САМОЕ ВАЖНОЕ)

При успешном пополнении в webhook'е Точки:

```python
def on_topup_success(user_id: int, payment_amount_kopecks: int,
                    wallet_tx_id: int, payment_id: int):
    """Вызывается из webhook handler'а после успешного пополнения."""
    
    user = db.query(User).filter_by(id=user_id).first()
    
    # 1. Партнёр привязан?
    if not user.referred_by_partner_id:
        return
    
    # 2. Комиссия за этого реферала уже выплачена?
    if user.partner_commission_paid:
        return  # это не первое пополнение, не выплачиваем
    
    # 3. Партнёр активный?
    partner = db.query(PartnerProfile).filter_by(
        id=user.referred_by_partner_id
    ).with_for_update().first()
    if not partner or partner.status != 'active':
        return
    
    # 4. Расчёт комиссии
    commission = payment_amount_kopecks * 30 // 100  # 30%
    
    # 5. Создание записи + обновление баланса (атомарно, в одной транзакции)
    db.add(PartnerCommission(
        partner_id=partner.id,
        referred_user_id=user.id,
        source_payment_id=payment_id,
        source_wallet_tx_id=wallet_tx_id,
        referral_topup_kopecks=payment_amount_kopecks,
        commission_kopecks=commission,
        status='accrued',
    ))
    
    partner.paid_referrals_count += 1
    partner.total_earned_kopecks += commission
    partner.available_balance_kopecks += commission
    
    user.partner_commission_paid = True
    
    db.commit()
    
    # 6. Уведомление партнёру (TG / email)
    notify_partner_new_commission(partner, commission, user_id_masked)
```

**Гарантии:**
- Idempotency через флаг `partner_commission_paid` на User
- Атомарность через `with_for_update`
- Если webhook прилетит дважды — второй вызов увидит флаг `true` и пропустит

### 4. Возврат комиссии при refund

Если реферал попросил возврат через поддержку:

```python
def on_refund(payment_id: int, reason: str):
    commission = db.query(PartnerCommission).filter_by(
        source_payment_id=payment_id, status='accrued'
    ).first()
    if not commission:
        return
    
    partner = db.query(PartnerProfile).filter_by(
        id=commission.partner_id
    ).with_for_update().first()
    
    commission.status = 'reversed'
    commission.reversed_reason = reason
    
    # Откатываем балансы
    partner.available_balance_kopecks -= commission.commission_kopecks
    partner.total_earned_kopecks -= commission.commission_kopecks
    # paid_referrals_count не трогаем — он показывает «всего было»
    
    # Если баланс ушёл в минус (партнёр уже вывел) — оставляем как долг
    # При следующих коммиссиях вычтется
    
    db.commit()
```

---

## 🛣 API эндпоинты

### Для партнёра

```
POST   /api/partners/apply
       Body: { type, audience_size, source, comment }
       → создание заявки, status=pending

GET    /api/partners/me
       → { ref_code, status, ref_link,
           stats: { referrals_count, paid_count, total_earned_rub,
                    available_balance_rub, total_paid_out_rub }}

GET    /api/partners/me/referrals?page=1&status=
       → { items: [{ user_email_masked, registered_at, first_payment_at,
                     commission_rub, status }], total }

GET    /api/partners/me/commissions?from=&to=&page=
       → { items: [...], total, summary: { accrued, paid, reversed }}

POST   /api/partners/me/payout
       Body: { amount_kopecks, method, destination: {...} }

GET    /api/partners/me/payouts
```

### Для админа

```
GET    /api/admin/partners?status=&page=
POST   /api/admin/partners/{id}/approve
POST   /api/admin/partners/{id}/reject
POST   /api/admin/partners/{id}/ban

GET    /api/admin/payouts?status=requested
POST   /api/admin/payouts/{id}/approve
POST   /api/admin/payouts/{id}/mark-paid     Body: { external_tx_id }
POST   /api/admin/payouts/{id}/reject
```

### Tracking

```
POST   /api/partners/track-click
       Body: { ref_code, referrer, utm_* }
       → 204
```

---

## 🖥 UI: кабинет партнёра

Маршрут: `/partners/dashboard` (требует auth + partner_profile.status=active)

```
┌──────────────────────────────────────────────────────────────┐
│  Партнёрский кабинет                                          │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  Привет, [Имя] 👋                                              │
│                                                                │
│  ┌──────────────┬──────────────┬──────────────────┐          │
│  │ ВСЕГО         │ ОПЛАТИЛИ      │ К ВЫПЛАТЕ         │          │
│  │ 47            │ 12             │ 3 540 ₽           │          │
│  │ переходов     │ из 23 регистр  │ [Вывести]         │          │
│  └──────────────┴──────────────┴──────────────────┘          │
│                                                                │
│  ┌──────────────────────────────────────────────┐            │
│  │  Твоя реферальная ссылка                       │            │
│  │  aiavitologpro.ru/?ref=lera2026     [📋]      │            │
│  │  [QR-код для постов]                          │            │
│  └──────────────────────────────────────────────┘            │
│                                                                │
│  ─── ПОСЛЕДНИЕ НАЧИСЛЕНИЯ ────────────────────────           │
│  • 01.06 · u***@gmail.com   +297 ₽   первое пополн.          │
│  • 30.05 · m***@gmail.com   +117 ₽                            │
│  • 28.05 · i***@avito.ru    +30  ₽                            │
│  [Все начисления →]                                            │
│                                                                │
│  ─── ПРОМО-МАТЕРИАЛЫ ─────────────────────────────           │
│  [Тексты для постов] [Скрипты DM] [Баннеры]                  │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

---

## 🛡 Безопасность и edge-cases

### Anti-fraud

1. **Self-referral**: проверка `partner.user_id !== referred.user_id` в момент привязки
2. **Платежи с карты партнёра** (если возможно вытащить hash из метаданных Точки):
   - Если карта last4 партнёра = last4 в платеже реферала → fraud-флаг
   - Не блокируем автоматически, помечаем для админ-проверки
3. **Подозрительная регистрация-пополнение-возврат**: если реферал пополнил 1 раз и сразу запросил возврат → автоматический ban реферала + reverse commission

### Idempotency платежей

Webhook Точки может прийти 2+ раза за один и тот же `payment_id`.

**Защита:**
- Платёж → `wallet_transaction` с `idempotency_key = 'topup:{payment_id}'` (уже есть в wallet-ТЗ)
- Партнёрская комиссия → флаг `user.partner_commission_paid = True` на User

При повторном webhook'е:
1. `topup` идемпотентен → создание `wallet_tx` пропускается
2. `on_topup_success` не вызовется снова, потому что повторный topup не создан

### Что НЕ делать

❌ **Хранить ref_code в localStorage** (только cookie с SameSite=Lax)
❌ **Передавать ref_code в URL после первого захода** (чистим URL)
❌ **Партнёрство без подписанной оферты** (юр. защита)

---

## 📋 Чеклист запуска

- [ ] 5 миграций БД применены
- [ ] Cookie-tracking работает (тест: клик → cookie → регистрация → User.referred_by_partner_id)
- [ ] Webhook-handler начисляет комиссию при первом пополнении
- [ ] Повторный webhook не приводит к двойному начислению
- [ ] Refund откатывает комиссию (status=reversed)
- [ ] Форма заявки + admin approve/reject
- [ ] Кабинет партнёра с балансом и историей
- [ ] Заявка на вывод (от 1 000 ₽) + ручная обработка админом
- [ ] Оферта партнёра подписывается при apply
- [ ] Тестовый партнёр-аккаунт прошёл полный flow

---

## 📊 Метрики мониторинга

- Количество активных партнёров
- Conv Click → Registration (по партнёрам)
- Conv Registration → First Payment (по партнёрам)

Пороги по нагрузке на программу обсуждаем с Лерой отдельно — здесь не фиксируем.

---

## 🚀 Дальнейшее развитие (НЕ в MVP)

После того как 30%-модель отработает 2–3 месяца, можно добавить:

- **Tier'ы**: топ-партнёры (от 50 платящих) получают повышенный % на новых рефералов
- **Recurring**: 10% lifetime со всех последующих пополнений (доп. мотивация лояльным)
- **Промокоды клиентам**: персональный код с бонусом +5% к зачислению
- **Лидерборд месяца**: топ-10 партнёров с доп. бонусом

Все эти расширения **не требуют переписывания базовой модели**.

---

**Дата:** 2026-06-01 · **Версия:** 2.0 (wallet-adapted)

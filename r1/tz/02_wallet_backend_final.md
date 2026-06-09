# ТЗ: Кошелёк-модель (бэкенд)

**Для:** Разработчик
**От:** Валерия
**Дата:** 27.05.2026 · **Обновлено:** 01.06.2026 (юр-статус подтверждён)
**Стек:** FastAPI + PostgreSQL + Redis + Точка Банк API + GPT-5.1

---

## ⚖️ ЮРИДИЧЕСКИЙ СТАТУС (главное)

**Баланс пользователя = авансовый платёж по лицензионному договору (ст. 487 ГК РФ).**

**НЕ электронные деньги.** 161-ФЗ не применяется, лицензия ЦБ не нужна. Юрист подтвердил.

### Что это значит для кода:

| Аспект | Правило |
|---|---|
| Имя поля в БД | `advance_payment_kopecks` (НЕ `wallet_balance` / `e_money_balance`) |
| Имя сервиса | `AdvancePaymentService` или `WalletService` (внутри — `advance_payment_kopecks`) |
| Комментарии в коде | «advance payment», «prepaid services». **Избегать**: `electronic money`, `e-wallet` |
| Чек при пополнении (54-ФЗ) | Признак расчёта: **«Аванс»** |
| Чек при списании за услугу | Признак расчёта: **«Зачёт аванса»** |
| Возврат через поддержку | `tx.type = 'refund'`, описание «Возврат авансового платежа» |

### Запрещено реализовывать (превратит в ЭДС):

❌ Перевод средств между юзерами (`/api/wallet/transfer` — НЕТ)
❌ Свободный вывод на карту без причины (только возврат по обращению)
❌ Оплата с баланса вне сервиса
❌ Передача баланса третьему лицу

---

## ЦЕЛЬ

Полностью убрать подписки. Перевести сервис на единую модель **кошелька в рублях с пакетами**.

Юзер:
- Регистрируется через Telegram → получает 50 ₽ бонусом
- Пополняет от 100 ₽ обычным способом ИЛИ покупает пакет со скидкой
- Тратит на ответы AI и инструменты по фиксированному прайсу

**Никаких тарифов. Никаких лимитов. Никаких подписок. Деньги не сгорают.**

---

## ПРАЙС

| Действие | Цена в копейках | В рублях |
|---------|----------------|---------|
| Ответ AI Авитолога | 500 | 5 ₽ |
| Парсер ниши | 19000 | 190 ₽ |
| Анализ статистики XLS | 5000 | 50 ₽ |
| Генерация фото | 1900 | 19 ₽ |
| Наложение плашки | 900 | 9 ₽ |
| Проверка позиций (разово) | 9900 | 99 ₽ |

### Пакеты пополнения

| Пакет | Цена платежа | Зачисляется на кошелёк |
|-------|--------------|------------------------|
| 100 запросов | 39000 коп (390 ₽) | 50000 коп (500 ₽) |
| 300 запросов | 99000 коп (990 ₽) | 150000 коп (1 500 ₽) |
| 500 запросов | 149000 коп (1 490 ₽) | 250000 коп (2 500 ₽) |
| Произвольное пополнение | от 10000 коп (от 100 ₽) | столько же |

Стартовый бонус: **5000 копеек (50 ₽)** при регистрации.

---

## БАЗА ДАННЫХ

### Миграция 1 — Поля в `users`

```python
def upgrade():
    op.add_column('users',
        sa.Column('wallet_balance_kopecks', sa.Integer(), 
                  nullable=False, server_default='0'))
    op.add_column('users',
        sa.Column('signup_bonus_granted', sa.Boolean(),
                  nullable=False, server_default='false'))

def downgrade():
    op.drop_column('users', 'signup_bonus_granted')
    op.drop_column('users', 'wallet_balance_kopecks')
```

### Миграция 2 — Таблица `wallet_transactions`

```python
def upgrade():
    op.create_table('wallet_transactions',
        sa.Column('id', sa.BigInteger(), 
                  primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), 
                  sa.ForeignKey('users.id'), nullable=False),
        sa.Column('type', sa.String(30), nullable=False),
        sa.Column('status', sa.String(20), 
                  nullable=False, server_default='confirmed'),
        sa.Column('amount_kopecks', sa.Integer(), nullable=False),
        sa.Column('balance_after_kopecks', sa.Integer(), nullable=False),
        sa.Column('description', sa.String(255)),
        sa.Column('related_entity', sa.String(50)),
        sa.Column('related_entity_id', sa.Integer()),
        sa.Column('idempotency_key', sa.String(100), unique=True),
        sa.Column('package_type', sa.String(30)),  # для пакетов: package_100, package_300, package_500
        sa.Column('created_at', sa.TIMESTAMP(), 
                  server_default=sa.func.now()),
        sa.Column('confirmed_at', sa.TIMESTAMP()),
    )
    op.create_index('idx_wallet_tx_user_id',
                    'wallet_transactions', 
                    ['user_id', 'created_at'])
    op.create_index('idx_wallet_tx_idempotency',
                    'wallet_transactions',
                    ['idempotency_key'])
```

**Типы транзакций (`type`):**
- `topup_regular` — обычное пополнение
- `topup_package_100` / `topup_package_300` / `topup_package_500` — пакеты
- `spend` — списание за действие
- `spend_pending` — списание в процессе (до подтверждения ответа AI)
- `bonus_signup` — стартовый бонус
- `refund` — возврат через поддержку

**Статусы (`status`):**
- `pending` — в процессе (AI генерирует ответ)
- `confirmed` — подтверждено
- `cancelled` — отменено (если AI не смог ответить)

---

## КОНФИГ ЦЕН

### `backend/app/core/pricing.py`

```python
"""Прайс действий в копейках. Источник истины."""

from enum import Enum

class ActionPrice(Enum):
    CHAT_MESSAGE = 500           # 5 ₽
    PARSER_NICHE = 19000         # 190 ₽
    ANALYZE_XLS = 5000           # 50 ₽
    GENERATE_PHOTO = 1900        # 19 ₽
    OVERLAY_PLATE = 900          # 9 ₽
    POSITION_CHECK = 9900        # 99 ₽

# Пакеты: (цена платежа, сумма зачисления на кошелёк)
TOPUP_PACKAGES = {
    'package_100': (39000, 50000),    # платит 390, получает 500
    'package_300': (99000, 150000),   # платит 990, получает 1500
    'package_500': (149000, 250000),  # платит 1490, получает 2500
}

SIGNUP_BONUS_KOPECKS = 5000
MIN_TOPUP_KOPECKS = 10000  # минимум для произвольного пополнения

ACTION_DESCRIPTIONS = {
    ActionPrice.CHAT_MESSAGE: "Ответ AI Авитолога",
    ActionPrice.PARSER_NICHE: "Парсер ниши",
    ActionPrice.ANALYZE_XLS: "Анализ статистики XLS",
    ActionPrice.GENERATE_PHOTO: "Генерация фото",
    ActionPrice.OVERLAY_PLATE: "Наложение плашки",
    ActionPrice.POSITION_CHECK: "Проверка позиций",
}
```

---

## СЕРВИС КОШЕЛЬКА

### `backend/app/services/wallet.py`

```python
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.wallet_transaction import WalletTransaction
from app.core.pricing import (
    ActionPrice, ACTION_DESCRIPTIONS,
    SIGNUP_BONUS_KOPECKS, MIN_TOPUP_KOPECKS, TOPUP_PACKAGES
)


class InsufficientFundsError(Exception):
    pass


class WalletService:
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_balance(self, user_id: int) -> int:
        user = self.db.get(User, user_id)
        return user.wallet_balance_kopecks if user else 0
    
    def can_afford(self, user_id: int, action: ActionPrice) -> bool:
        return self.get_balance(user_id) >= action.value
    
    def spend_pending(
        self,
        user_id: int,
        action: ActionPrice,
        related_entity: str = None,
        related_entity_id: int = None,
        idempotency_key: str = None,
    ) -> WalletTransaction:
        """
        Создать ОЖИДАЮЩЕЕ списание. Баланс резервируется но не списан.
        Используется ДО запроса к GPT.
        """
        user = (
            self.db.query(User)
            .filter(User.id == user_id)
            .with_for_update()
            .first()
        )
        
        if not user:
            raise HTTPException(404, "User not found")
        
        amount = action.value
        
        if user.wallet_balance_kopecks < amount:
            raise InsufficientFundsError(
                f"Need {amount}, have {user.wallet_balance_kopecks}"
            )
        
        # Уменьшаем баланс (резервируем)
        user.wallet_balance_kopecks -= amount
        
        tx = WalletTransaction(
            user_id=user_id,
            type='spend_pending',
            status='pending',
            amount_kopecks=-amount,
            balance_after_kopecks=user.wallet_balance_kopecks,
            description=ACTION_DESCRIPTIONS[action],
            related_entity=related_entity,
            related_entity_id=related_entity_id,
            idempotency_key=idempotency_key,
        )
        self.db.add(tx)
        self.db.commit()
        
        return tx
    
    def confirm_pending(self, tx_id: int):
        """Подтвердить ожидающее списание после успешного ответа AI."""
        tx = self.db.get(WalletTransaction, tx_id)
        if not tx or tx.status != 'pending':
            return
        
        tx.status = 'confirmed'
        tx.type = 'spend'
        tx.confirmed_at = func.now()
        self.db.commit()
    
    def cancel_pending(self, tx_id: int, reason: str = None):
        """
        Отменить ожидающее списание (AI не смог ответить).
        Возвращает деньги на баланс.
        """
        tx = self.db.get(WalletTransaction, tx_id)
        if not tx or tx.status != 'pending':
            return
        
        user = (
            self.db.query(User)
            .filter(User.id == tx.user_id)
            .with_for_update()
            .first()
        )
        
        # Возвращаем деньги
        user.wallet_balance_kopecks -= tx.amount_kopecks  # amount_kopecks отрицательное
        
        tx.status = 'cancelled'
        tx.description += f" (отменено: {reason or 'AI не смог ответить'})"
        
        self.db.commit()
    
    def topup_regular(
        self,
        user_id: int,
        amount_kopecks: int,
        payment_id: str,
    ) -> WalletTransaction:
        """Обычное пополнение (сколько положил - столько и зачисляется)."""
        if amount_kopecks < MIN_TOPUP_KOPECKS:
            raise HTTPException(400, "Below minimum topup")
        
        # Idempotency
        existing = (
            self.db.query(WalletTransaction)
            .filter(WalletTransaction.idempotency_key == f"topup:{payment_id}")
            .first()
        )
        if existing:
            return existing
        
        user = (
            self.db.query(User)
            .filter(User.id == user_id)
            .with_for_update()
            .first()
        )
        
        user.wallet_balance_kopecks += amount_kopecks
        
        tx = WalletTransaction(
            user_id=user_id,
            type='topup_regular',
            status='confirmed',
            amount_kopecks=amount_kopecks,
            balance_after_kopecks=user.wallet_balance_kopecks,
            description=f"Пополнение через Точка Банк",
            related_entity='tochka_payment',
            idempotency_key=f"topup:{payment_id}",
        )
        self.db.add(tx)
        self.db.commit()
        
        return tx
    
    def topup_package(
        self,
        user_id: int,
        package_type: str,
        payment_id: str,
    ) -> WalletTransaction:
        """
        Пополнение по пакету. Юзер платит меньше, на кошелёк зачисляется больше.
        Например package_100: платит 390, зачисляется 500.
        """
        if package_type not in TOPUP_PACKAGES:
            raise HTTPException(400, "Unknown package")
        
        paid_amount, credit_amount = TOPUP_PACKAGES[package_type]
        
        # Idempotency
        existing = (
            self.db.query(WalletTransaction)
            .filter(WalletTransaction.idempotency_key == f"topup:{payment_id}")
            .first()
        )
        if existing:
            return existing
        
        user = (
            self.db.query(User)
            .filter(User.id == user_id)
            .with_for_update()
            .first()
        )
        
        # На кошелёк зачисляется БОЛЬШЕ чем заплатил
        user.wallet_balance_kopecks += credit_amount
        
        tx = WalletTransaction(
            user_id=user_id,
            type=f'topup_{package_type}',
            status='confirmed',
            amount_kopecks=credit_amount,  # зачислено
            balance_after_kopecks=user.wallet_balance_kopecks,
            description=f"Пакет {package_type} (оплачено {paid_amount/100} ₽, зачислено {credit_amount/100} ₽)",
            related_entity='tochka_payment',
            idempotency_key=f"topup:{payment_id}",
            package_type=package_type,
        )
        self.db.add(tx)
        self.db.commit()
        
        return tx
    
    def grant_signup_bonus(self, user_id: int) -> WalletTransaction | None:
        """Стартовый бонус. Один раз на пользователя."""
        user = (
            self.db.query(User)
            .filter(User.id == user_id)
            .with_for_update()
            .first()
        )
        
        if user.signup_bonus_granted:
            return None
        
        user.wallet_balance_kopecks += SIGNUP_BONUS_KOPECKS
        user.signup_bonus_granted = True
        
        tx = WalletTransaction(
            user_id=user_id,
            type='bonus_signup',
            status='confirmed',
            amount_kopecks=SIGNUP_BONUS_KOPECKS,
            balance_after_kopecks=user.wallet_balance_kopecks,
            description="Стартовый бонус при регистрации",
            idempotency_key=f"signup_bonus:{user_id}",
        )
        self.db.add(tx)
        self.db.commit()
        
        return tx
    
    def get_transactions(self, user_id: int, limit=50, offset=0):
        return (
            self.db.query(WalletTransaction)
            .filter(WalletTransaction.user_id == user_id)
            .filter(WalletTransaction.status != 'pending')  # не показываем pending в истории
            .order_by(WalletTransaction.created_at.desc())
            .limit(limit)
            .offset(offset)
            .all()
        )
```

---

## API ЭНДПОИНТЫ

### `backend/app/api/wallet.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from app.services.wallet import WalletService
from app.services.tochka import TochkaService
from app.core.pricing import MIN_TOPUP_KOPECKS, TOPUP_PACKAGES

router = APIRouter(prefix="/api/wallet", tags=["wallet"])


@router.get("/balance")
def get_balance(current_user=Depends(get_current_user), db=Depends(get_db)):
    service = WalletService(db)
    balance = service.get_balance(current_user.id)
    return {"balance_kopecks": balance, "balance_rub": balance / 100}


@router.get("/transactions")
def get_transactions(
    limit: int = 50, offset: int = 0,
    current_user=Depends(get_current_user), db=Depends(get_db),
):
    service = WalletService(db)
    txs = service.get_transactions(current_user.id, limit, offset)
    return {"transactions": [tx.to_dict() for tx in txs]}


@router.post("/topup")
def create_topup(
    request: TopupRequest,  # {type: 'regular' | 'package_100' | ..., amount_kopecks?}
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Создание платежа в Точка Банк.
    
    Для regular: указывается amount_kopecks (от 10000)
    Для пакетов: amount_kopecks вычисляется из TOPUP_PACKAGES
    """
    tochka = TochkaService()
    
    if request.type == 'regular':
        if request.amount_kopecks < MIN_TOPUP_KOPECKS:
            raise HTTPException(400, f"Минимум {MIN_TOPUP_KOPECKS//100} ₽")
        amount = request.amount_kopecks
        description = "Пополнение кошелька"
        metadata = {"user_id": current_user.id, "topup_type": "regular"}
    
    elif request.type in TOPUP_PACKAGES:
        amount = TOPUP_PACKAGES[request.type][0]  # цена платежа
        description = f"Пакет {request.type} для AI Авитолог PRO"
        metadata = {"user_id": current_user.id, "topup_type": request.type}
    
    else:
        raise HTTPException(400, "Unknown topup type")
    
    payment = tochka.create_one_time_payment(
        user_id=current_user.id,
        amount_kopecks=amount,
        description=description,
        metadata=metadata,
    )
    
    return {"payment_url": payment.url, "payment_id": payment.id}


@router.post("/webhook/tochka")
async def tochka_webhook(payload: dict, db=Depends(get_db)):
    tochka = TochkaService()
    
    if not tochka.verify_webhook_signature(payload):
        raise HTTPException(401, "Invalid signature")
    
    if payload.get("status") != "success":
        return {"ok": True}
    
    user_id = int(payload["metadata"]["user_id"])
    topup_type = payload["metadata"]["topup_type"]
    payment_id = payload["payment_id"]
    
    service = WalletService(db)
    
    if topup_type == 'regular':
        amount = int(payload["amount_kopecks"])
        service.topup_regular(user_id, amount, payment_id)
    elif topup_type in TOPUP_PACKAGES:
        service.topup_package(user_id, topup_type, payment_id)
    
    # Выдача чека через онлайн-кассу (см. ниже)
    fiscalize_payment(payload)
    
    return {"ok": True}
```

---

## ИНТЕГРАЦИЯ В ЧАТ (списание pending → confirmed)

### `backend/app/services/messages.py`

```python
async def send_message(message_data, user_id, db):
    wallet = WalletService(db)
    
    # 1. Проверка баланса
    if not wallet.can_afford(user_id, ActionPrice.CHAT_MESSAGE):
        raise HTTPException(
            status_code=402,
            detail={
                "error": "insufficient_funds",
                "message": "Недостаточно средств. Пополни кошелёк.",
                "required_kopecks": ActionPrice.CHAT_MESSAGE.value,
                "current_balance_kopecks": wallet.get_balance(user_id),
            }
        )
    
    # 2. Pending списание ДО запроса к GPT
    pending_tx = wallet.spend_pending(
        user_id=user_id,
        action=ActionPrice.CHAT_MESSAGE,
        related_entity='chat_message',
        idempotency_key=f"msg:{message_data.client_message_id}",
    )
    
    try:
        # 3. Контекст для AI (НЕ озвучивать!)
        balance_for_context = wallet.get_balance(user_id) / 100
        system_prompt = build_system_prompt(
            user=user,
            balance_rub=balance_for_context,
            is_new_user=check_if_new(user),
        )
        
        # 4. Запрос к GPT-5.1
        response = await openai_chat(system_prompt, messages)
        
        # 5. Сохранить ответ в БД
        ai_message = save_ai_message(response, chat_id)
        
        # 6. Подтвердить списание
        wallet.confirm_pending(pending_tx.id)
        
        return ai_message
    
    except Exception as e:
        # AI не смог ответить — отменяем pending
        wallet.cancel_pending(
            pending_tx.id, 
            reason=f"AI generation failed: {str(e)[:100]}"
        )
        raise
```

---

## XLS — ЗАГРУЗКА БЕСПЛАТНА, АНАЛИЗ ПЛАТНЫЙ

```python
@router.post("/api/files/upload")
async def upload_file(file: UploadFile, user=Depends(get_current_user)):
    """
    Загрузка файла БЕЗ списания. Просто сохраняем.
    Юзер потом нажмёт 'Проанализировать' → отдельный эндпоинт со списанием.
    """
    saved = save_file_to_storage(file, user.id)
    return {"file_id": saved.id, "filename": file.filename}


@router.post("/api/analyze-xls")
async def analyze_xls(
    file_id: int,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Анализ XLS — 50 ₽. Списание + полный разбор."""
    wallet = WalletService(db)
    
    if not wallet.can_afford(current_user.id, ActionPrice.ANALYZE_XLS):
        raise HTTPException(402, "Insufficient funds")
    
    pending_tx = wallet.spend_pending(
        user_id=current_user.id,
        action=ActionPrice.ANALYZE_XLS,
        related_entity='xls_analysis',
        related_entity_id=file_id,
    )
    
    try:
        # Парсинг + анализ через AI
        result = await analyze_xls_file(file_id)
        
        # Сохраняем результат как системное сообщение в чат
        save_system_message(chat_id, result)
        
        wallet.confirm_pending(pending_tx.id)
        return {"result": result}
    
    except Exception as e:
        wallet.cancel_pending(pending_tx.id, reason=str(e))
        raise
```

---

## ПАРСЕР — ВВОД URL ВЫДАЧИ

```python
@router.post("/api/parser/start")
async def start_parser(
    request: ParserRequest,  # {avito_search_url: str}
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Парсер ниши — 190 ₽. Принимает URL выдачи Авито."""
    # Валидация URL
    if not is_valid_avito_search_url(request.avito_search_url):
        raise HTTPException(400, "Невалидная ссылка выдачи Авито")
    
    wallet = WalletService(db)
    if not wallet.can_afford(current_user.id, ActionPrice.PARSER_NICHE):
        raise HTTPException(402, "Insufficient funds")
    
    pending_tx = wallet.spend_pending(
        user_id=current_user.id,
        action=ActionPrice.PARSER_NICHE,
        related_entity='parser_job',
    )
    
    try:
        # Запуск парсера на VPS
        job = await launch_parser_job(
            user_id=current_user.id,
            avito_search_url=request.avito_search_url,
        )
        
        wallet.confirm_pending(pending_tx.id)
        return {"job_id": job.id, "status": "running"}
    
    except Exception as e:
        wallet.cancel_pending(pending_tx.id, reason=str(e))
        raise
```

---

## ПРОВЕРКА ПОЗИЦИЙ — РАЗОВО

```python
@router.post("/api/positions/check")
async def check_positions(
    request: PositionCheckRequest,  # {ad_ids: list[str], city: str}
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Проверка позиций объявлений — 99 ₽ за разовый прогон."""
    wallet = WalletService(db)
    
    if not wallet.can_afford(current_user.id, ActionPrice.POSITION_CHECK):
        raise HTTPException(402, "Insufficient funds")
    
    pending_tx = wallet.spend_pending(
        user_id=current_user.id,
        action=ActionPrice.POSITION_CHECK,
        related_entity='position_check',
    )
    
    try:
        result = await check_avito_positions(
            ad_ids=request.ad_ids,
            city=request.city,
        )
        
        # Результат как системное сообщение в чат
        save_system_message(chat_id, format_positions_report(result))
        
        wallet.confirm_pending(pending_tx.id)
        return {"positions": result}
    
    except Exception as e:
        wallet.cancel_pending(pending_tx.id, reason=str(e))
        raise
```

---

## КНОПКА 👎 — ТИХИЙ СИГНАЛ

```python
@router.post("/api/messages/{message_id}/thumb-down")
async def thumb_down(
    message_id: int,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Юзер пожаловался на ответ AI.
    НЕ возвращаем деньги. Только сохраняем сигнал для админки.
    """
    message = db.get(Message, message_id)
    if not message or message.user_id != current_user.id:
        raise HTTPException(404)
    
    thumb = ThumbDown(
        user_id=current_user.id,
        message_id=message_id,
        created_at=datetime.utcnow(),
    )
    db.add(thumb)
    db.commit()
    
    return {"ok": True}
```

Отдельная таблица `thumb_downs` — простая, ID + user_id + message_id + дата.

В админке: фильтр по 👎 для разбора паттернов.

---

## ЧЕКИ 54-ФЗ (КРИТИЧНО)

После каждого пополнения через Точка Банк нужно выдавать чек.

**Варианты подключения онлайн-кассы:**
- **АТОЛ Онлайн** — облачная касса, API
- **ОФД.ру** — отдельный ОФД с API
- **Тинькофф Касса** — если у вас Тинькофф

Логика:

```python
def fiscalize_payment(payment_payload):
    """Отправка чека в онлайн-кассу после успешной оплаты."""
    atol_client = AtolClient()
    
    receipt = {
        "external_id": payment_payload["payment_id"],
        "receipt": {
            "client": {
                "email": user.email or f"user{user.id}@aiavitologpro.ru",
            },
            "items": [{
                "name": "Пополнение баланса AI Авитолог PRO",
                "price": payment_payload["amount_kopecks"] / 100,
                "quantity": 1,
                "sum": payment_payload["amount_kopecks"] / 100,
                "vat": {"type": "none"},  # или vat20
                "payment_method": "full_payment",
                "payment_object": "service",
            }],
            "payments": [{
                "type": "electronic",
                "sum": payment_payload["amount_kopecks"] / 100,
            }],
        },
    }
    
    atol_client.sell(receipt)
```

Чек приходит на email юзера. Если email не указан — на технический ящик (но это плохо, лучше требовать email при пополнении).

---

## АДМИНКА — РАСШИРЕНИЕ

В существующую админку добавить:

### Раздел «Метрики»
- Юзеров за день/неделю/месяц
- Регистраций за период
- Пополнений за период (сумма + количество, отдельно по обычным/пакетам)
- Расходы на API GPT за период

### Раздел «Трафик»
- Источники (UTM из Яндекс Метрики)
- Воронка: посещение → регистрация → первое сообщение → первое пополнение → активный
- LTV по источникам

### Раздел «Качество»
- Все 👎 за период с контекстом (вопрос + ответ AI)
- Топ проблемных тем
- Среднее количество сообщений до пополнения

### Раздел «Пользователи»
- Список с фильтрами (активные, давно не заходили, потратили больше 1000 ₽)
- История конкретного юзера: транзакции + чаты
- Возможность вручную сделать рефанд из админки

### Передача данных в Яндекс Метрику

На фронте подключается Метрика, бэк передаёт события:
- `user_register` — userId
- `first_message_sent` — userId, время
- `first_topup` — userId, сумма, тип (regular/package)
- `topup` — userId, сумма, тип
- `chat_message` — userId
- `tool_used` — userId, инструмент

---

## БЕЗОПАСНОСТЬ (после взлома)

1. **Атомарность** — все операции с балансом через `with_for_update()`
2. **Idempotency** — все платежи имеют `idempotency_key`
3. **Webhook подпись** — обязательная проверка от Точка Банк
4. **Rate limiting** на `/api/wallet/topup`: 10/мин с user_id
5. **Audit log** — каждая операция в `wallet_transactions`
6. **API ключи** — `.env`, не в клиенте
7. **Возвраты** — только через ручное обращение в поддержку

---

## ЮРИДИЧЕСКАЯ ЧАСТЬ

**Прежде чем запускать оплаты:**

- Оферта (договор пользователя)
- Политика конфиденциальности
- Согласие на обработку персональных данных (152-ФЗ)
- Чеки 54-ФЗ (онлайн-касса)
- Условия возврата средств в оферте

**Это не работа разработчика** — заказать у юриста (~10-30 тыс ₽ за пакет документов).

Размещение на сайте: страницы `/legal/offer`, `/legal/privacy`, `/legal/refund`.

---

## МИГРАЦИЯ СТАРЫХ ПОДПИСЧИКОВ

### Скрипт `scripts/migrate_subscriptions_to_wallet.py`

```python
"""Конвертация остатка подписок в баланс кошелька."""

for sub in active_subscriptions:
    days_left = (sub.end_date - now).days
    if days_left <= 0:
        continue
    
    # Конвертация по справедливой цене
    daily_rate_kopecks = sub.plan_price_kopecks / 30
    bonus_kopecks = int(daily_rate_kopecks * days_left)
    
    # Зачисляем на кошелёк
    user = sub.user
    user.wallet_balance_kopecks += bonus_kopecks
    
    # Лог
    tx = WalletTransaction(
        user_id=user.id,
        type='migration_bonus',
        status='confirmed',
        amount_kopecks=bonus_kopecks,
        balance_after_kopecks=user.wallet_balance_kopecks,
        description=f"Миграция: остаток подписки {sub.plan_name} ({days_left} дней)",
    )
    db.add(tx)
    
    # Останавливаем рекуррентный платёж
    tochka.cancel_recurring(sub.tochka_subscription_id)
    sub.status = 'migrated_to_wallet'

db.commit()
```

После миграции — рассылка пользователям с объяснением.

---

## ПОШАГОВЫЙ ПЛАН ВНЕДРЕНИЯ

| Этап | Что | Время |
|------|-----|-------|
| 1 | Миграции БД | 1 день |
| 2 | Сервис `wallet.py` (полный) | 2 дня |
| 3 | API `/api/wallet/*` | 2 дня |
| 4 | Pending/confirm в `messages.py` | 1 день |
| 5 | Интеграция Точка Банк (разовые платежи) | 2 дня |
| 6 | Стартовый бонус при регистрации | 0.5 дня |
| 7 | Эндпоинты для XLS, парсера, позиций | 2 дня |
| 8 | Эндпоинт 👎 + таблица | 0.5 дня |
| 9 | Подключение онлайн-кассы (АТОЛ или ОФД) | 2 дня |
| 10 | Скрипт миграции подписчиков | 1 день |
| 11 | Удаление кода подписок | 1 день |
| 12 | Админка (расширение) | 2 дня |
| 13 | Передача событий в Метрику | 1 день |
| 14 | Тесты + безопасность | 2 дня |
| 15 | Деплой + мониторинг | 1 день |

**Итого: ~21 рабочий день (~4 недели)**

---

## MVP-ВЕРСИЯ (5-7 дней)

Если 4 недели много — минимум для запуска:

✅ Миграция БД (поля + таблица)
✅ Сервис `wallet.py` (только spend_pending/confirm/cancel, topup_regular, topup_package, grant_signup_bonus)
✅ `/api/wallet/balance`, `/topup`, `/webhook/tochka`
✅ Pending списание за чат-сообщения
✅ Стартовый бонус 50 ₽
✅ Чеки 54-ФЗ (без этого нельзя!)
✅ Минимальный UI: шапка + модалка пополнения с пакетами

**Откладываем:**
- История транзакций (отдельная страница)
- Эндпоинты для парсера/XLS/позиций (если этих фич ещё нет в продакшене)
- Расширение админки
- Миграция подписчиков (если их мало — вручную)

---

## КОНТЕКСТ ДЛЯ AI

Бэк должен подкладывать в системный промпт:

```python
def build_system_prompt(user, balance_rub, is_new_user):
    base_prompt = open("prompts/assistant_ru.txt").read()
    
    context = f"""
    
КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ (НЕ ОЗВУЧИВАТЬ ПРЯМО!):
— Баланс: {balance_rub} ₽
— Новичок: {"да" if is_new_user else "нет"}

ЗАПРЕЩЕНО:
— Озвучивать конкретный баланс
— Делать математику пополнений в ответе
— Объяснять как работает кошелёк
"""
    
    return base_prompt + context
```

Данные парсера и XLS передаются **не в системном промпте**, а как **системные сообщения в истории чата**. AI читает их через обычную историю.

---

## ВОПРОСЫ К РАЗРАБОТЧИКУ

1. Есть ли в Точка Банк API метод для разовых платежей? (Сейчас рекуррентные)
2. Сколько активных подписчиков сейчас?
3. Готов к 4 неделям или начнём с MVP за неделю?
4. Какую онлайн-кассу подключим (АТОЛ Онлайн / ОФД.ру / другую)?
5. Когда планируется парсер на VPS?

---

## КРИТЕРИИ УСПЕХА

✅ Пользователь видит баланс в шапке
✅ При регистрации появляется 50 ₽
✅ За каждый ответ AI списывается 5 ₽ (только после успешной генерации)
✅ Пополнение через Точка Банк работает (regular и пакеты)
✅ Пакеты дают правильную скидку (390→500, 990→1500, 1490→2500)
✅ Все операции в `wallet_transactions` с идемпотентностью
✅ Чеки 54-ФЗ выдаются после каждого пополнения
✅ Кнопка 👎 пишет сигнал в админку (без возврата)
✅ XLS загрузка бесплатна, анализ платный (50 ₽)
✅ Парсер принимает URL выдачи Авито
✅ Проверка позиций — разовая (99 ₽)
✅ Старые подписчики мигрированы с остатком на кошелёк
✅ Код подписок удалён
✅ AI знает баланс в контексте, но не озвучивает
✅ События уходят в Яндекс Метрику

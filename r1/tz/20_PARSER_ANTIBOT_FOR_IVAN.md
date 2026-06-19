# Парсер Авито — Anti-bot стратегия и архитектура обхода защиты

**От:** Лера  
**Дата:** Июнь 2026  
**Кому:** Иван  
**Статус:** Результат исследования — передать разработчику

---

## КОНТЕКСТ

Мы провели глубокий анализ того, как обходить защиту Авито при парсинге для коммерческого сервиса (много клиентов, много запросов). Ниже — всё что накопали: почему не работает сейчас, как работают успешные сервисы, и что конкретно делать.

По данным [Scraperly, 2026](https://scraperly.com/scrape/avito): Авито оценивается **2/5 по сложности парсинга** — это сравнительно несложно при правильном подходе.

---

## БЛОК 1 — ПОЧЕМУ НЕ РАБОТАЕТ СЕЙЧАС

### 1.1 Как Авито определяет бота

Авито проверяет **4 слоя одновременно:**

```
Слой 1: IP-адрес
  → Дата-центровый IP? → Бан сразу
  → Известный прокси-провайдер? → Бан
  → Жилой/мобильный IP? → Пропускает дальше

Слой 2: TLS fingerprint
  → Python requests? → Выдаёт "это не браузер" → Бан
  → Headless Chrome? → Детектируется → Капча
  → Настоящий Chrome с правильным TLS → Пропускает дальше

Слой 3: Поведение сессии
  → Запросы слишком быстрые? → Капча
  → Нет cookies/localStorage? → Подозрение
  → Игнорирует JS-вызовы? → Бан

Слой 4: Аккаунт Авито
  → Анонимный запрос? → Ограниченный доступ
  → Аккаунт без истории? → Мало доверия
  → Прогретый аккаунт с историей? → Максимальное доверие
```

### 1.2 Почему у тебя не работает с прокси

Скорее всего одна или несколько причин:

**Причина А: Используешь дата-центровые прокси**  
Авито их банит мгновенно. Нужны **мобильные или residential** прокси — реальные IP домашних/мобильных пользователей.

**Причина Б: Headless режим**  
Авито детектирует headless Chrome. Нужно запускать с **Xvfb** (виртуальный дисплей) в режиме `headless=False`.

**Причина В: Прокси передаётся не через Playwright**  
Если передаёшь прокси через системные настройки или `requests` — TLS fingerprint не меняется, Авито видит Python. Прокси нужно передавать **через параметр `proxy=` при запуске браузера**.

**Причина Г: TLS fingerprint Python requests**  
Если где-то используешь `requests` вместо браузера для части запросов — это детектируется. Используй `curl_cffi` с `impersonate="chrome120"`.

---

## БЛОК 2 — ТЕХНИЧЕСКИЙ СТЕК (что ставить)

### 2.1 Основной стек парсинга

```python
# Вариант 1: Браузерный (надёжнее, медленнее)
playwright + playwright-stealth + Xvfb + мобильный прокси

# Вариант 2: HTTP (быстрее, чуть менее надёжен)  
curl_cffi + мобильный прокси + прогретые куки/аккаунт

# Рекомендация: гибрид
# curl_cffi для основной выдачи (быстро)
# playwright только если Авито вернул JS-challenge (редко)
```

### 2.2 Playwright — правильный запуск

```python
from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

def launch_browser(proxy_url: str):
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/opt/google/chrome/chrome",  # системный Chrome, НЕ встроенный
            headless=False,   # ОБЯЗАТЕЛЬНО False — Авито детектирует headless
            proxy={"server": proxy_url},  # прокси ЗДЕСЬ, не через env
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--display=:99",  # Xvfb дисплей
            ]
        )
        context = browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        page = context.new_page()
        Stealth().apply_stealth_sync(page)  # убирает все признаки автоматизации
        return browser, context, page
```

### 2.3 curl_cffi — быстрый HTTP без браузера

```python
from curl_cffi import requests

def fetch_avito_page(url: str, proxy_url: str, cookies: dict = None):
    r = requests.get(
        url,
        impersonate="chrome120",  # имитирует TLS fingerprint Chrome 120
        proxies={"https": proxy_url},
        cookies=cookies,
        headers={
            "Accept-Language": "ru-RU,ru;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": "https://www.avito.ru/",
        },
        timeout=30
    )
    
    # Если получили JS-challenge — переключаемся на Playwright
    if "challenge" in r.text.lower() or r.status_code == 403:
        return None  # сигнал для fallback на браузер
    
    return r.text
```

### 2.4 Xvfb — запуск виртуального дисплея

```bash
# Установка
apt-get install -y xvfb

# Запуск перед браузером
Xvfb :99 -screen 0 1280x800x24 -ac &
export DISPLAY=:99

# Или в systemd (см. конфиг в 01_parser_integration.md)
```

---

## БЛОК 3 — СТРАТЕГИЯ АККАУНТОВ (главное открытие)

### 3.1 Идея: пул сервисных аккаунтов

Вместо покупных куки-сессий (нестабильно, дорого) — использовать **пул прогретых аккаунтов Авито**.

**Почему это лучше:**
- Авито доверяет аккаунтам с историей
- Сессия не протухает каждые 12 часов
- Нет зависимости от сторонних продавцов кук
- Дешевле в долгосрочной перспективе

### 3.2 Архитектура пула

```
Аккаунт #1 (прогрет 2+ мес) ←→ Мобильный прокси Beeline
Аккаунт #2 (прогрет 2+ мес) ←→ Мобильный прокси МТС
Аккаунт #3 (прогрет 2+ мес) ←→ Мобильный прокси Мегафон
         ↓
   AccountPool (менеджер ротации)
         ↓
   Выдаёт следующий свободный аккаунт под задачу
         ↓
   После задачи — аккаунт "отдыхает" 10-30 мин
```

**Правило:** один аккаунт = один прокси. Не меняй IP аккаунта резко — Авито считает это подозрительным (как взлом).

### 3.3 Класс AccountPool

```python
import asyncio
import json
import time
from dataclasses import dataclass
from typing import Optional

@dataclass
class AvitoAccount:
    account_id: str
    login: str
    password: str
    proxy_url: str        # мобильный прокси, закреплённый за этим аккаунтом
    cookies_path: str     # путь к файлу с куками сессии
    last_used_at: float = 0.0
    is_busy: bool = False
    cool_down_sec: int = 600  # 10 минут отдыха после задачи

class AccountPool:
    def __init__(self, accounts: list[AvitoAccount]):
        self.accounts = accounts
        self._lock = asyncio.Lock()
    
    async def acquire(self) -> Optional[AvitoAccount]:
        """Получить свободный аккаунт."""
        async with self._lock:
            now = time.time()
            for acc in self.accounts:
                if not acc.is_busy and (now - acc.last_used_at) > acc.cool_down_sec:
                    acc.is_busy = True
                    return acc
            return None  # все заняты
    
    async def release(self, account: AvitoAccount):
        """Освободить аккаунт после задачи."""
        async with self._lock:
            account.is_busy = False
            account.last_used_at = time.time()
    
    def save_cookies(self, account: AvitoAccount, cookies: list):
        """Сохранить куки сессии после входа."""
        with open(account.cookies_path, "w") as f:
            json.dump(cookies, f)
    
    def load_cookies(self, account: AvitoAccount) -> list:
        """Загрузить куки сессии."""
        try:
            with open(account.cookies_path) as f:
                return json.load(f)
        except FileNotFoundError:
            return []
```

### 3.4 Как использовать в worker.py

```python
# Инициализация пула
ACCOUNT_POOL = AccountPool([
    AvitoAccount(
        account_id="acc1",
        login="parser_acc1@mail.ru",
        password="...",
        proxy_url="http://login:pass@mobileproxy.space:port1",
        cookies_path="/opt/parser/cookies/acc1.json",
    ),
    AvitoAccount(
        account_id="acc2",
        login="parser_acc2@mail.ru", 
        password="...",
        proxy_url="http://login:pass@mobileproxy.space:port2",
        cookies_path="/opt/parser/cookies/acc2.json",
    ),
    AvitoAccount(
        account_id="acc3",
        login="parser_acc3@mail.ru",
        password="...",
        proxy_url="http://login:pass@mobileproxy.space:port3",
        cookies_path="/opt/parser/cookies/acc3.json",
    ),
])

async def process_job(job: dict):
    # Ждём свободный аккаунт
    account = None
    while account is None:
        account = await ACCOUNT_POOL.acquire()
        if account is None:
            await asyncio.sleep(30)  # все заняты — ждём
    
    try:
        cookies = ACCOUNT_POOL.load_cookies(account)
        result = await run_full_pipeline(
            url=job["url"],
            pages=job["pages"],
            proxy_url=account.proxy_url,
            cookies=cookies,
        )
        return result
    finally:
        await ACCOUNT_POOL.release(account)
```

---

## БЛОК 4 — ПРОКСИ: ЧТО ПОКУПАТЬ

### 4.1 Типы прокси (от худшего к лучшему для Авито)

| Тип | Авито пропускает? | Цена | Рекомендация |
|---|---|---|---|
| Дата-центровые | ❌ Почти никогда | ~$1/мес | Не использовать |
| Shared residential | ⚠️ Иногда | ~$3-5/GB | Риск (IP засвечены) |
| Dedicated residential | ✅ Часто | ~$10-15/мес | Норм для старта |
| **Мобильные (4G/LTE)** | **✅ Почти всегда** | **~1500 ₽/мес** | **Рекомендуем** |

### 4.2 Где покупать мобильные прокси

- **mobileproxy.space** — проверено в avito-monitor, работает. Beeline + не Москва.
- **4gproxy.ru** — альтернатива
- **proxys.io** — есть русские мобильные

### 4.3 Сколько прокси нужно

```
3 аккаунта = 3 прокси = ~30-50 парсингов/день безопасно
5 аккаунтов = 5 прокси = ~80-100 парсингов/день

Стоимость: 3 × 1500 ₽ = 4500 ₽/мес
Доход при 30 парсингов/день: 30 × 190 ₽ × 30 дней = 171 000 ₽/мес
```

---

## БЛОК 5 — ЗАДЕРЖКИ И ЧЕЛОВЕКОПОДОБНОЕ ПОВЕДЕНИЕ

Авито отслеживает скорость запросов. Нужны рандомные задержки:

```python
import random
import asyncio

async def human_delay(min_sec=2.0, max_sec=5.0):
    """Случайная задержка как у человека."""
    await asyncio.sleep(random.uniform(min_sec, max_sec))

async def scroll_like_human(page):
    """Скролл страницы как человек."""
    for _ in range(random.randint(3, 7)):
        scroll_amount = random.randint(300, 800)
        await page.evaluate(f"window.scrollBy(0, {scroll_amount})")
        await asyncio.sleep(random.uniform(0.5, 1.5))

async def scrape_listing_page(page, url: str):
    await page.goto(url)
    await human_delay(2, 4)       # подождать загрузку
    await scroll_like_human(page)  # поскроллить
    await human_delay(1, 3)       # перед следующей страницей
    # ... парсинг
```

---

## БЛОК 6 — "ПРОГРЕВ" АККАУНТОВ

**Аккаунты нужно создать СЕЙЧАС** — они должны созреть 2-3 месяца.

### Что делать с каждым аккаунтом:

**Неделя 1:**
- Создать аккаунт с реальными данными
- Заполнить профиль (город, имя)
- Просмотреть 10-20 объявлений вручную

**Месяц 1-2:**
- 2-3 раза в неделю: зайти, поискать что-нибудь, посмотреть объявления
- Желательно разместить 1-2 реальных объявления (старые вещи, что угодно)
- Написать 1-2 сообщения продавцам (спросить про товар)

**Месяц 3+:**
- Аккаунт считается "прогретым"
- Можно подключать к парсеру
- Продолжать иногда делать "человеческие" действия между задачами

### Скрипт автоматического прогрева (запускать раз в неделю):

```python
async def warmup_account(account: AvitoAccount):
    """Имитирует активность обычного пользователя."""
    browser, context, page = launch_browser(account.proxy_url)
    
    # Загружаем куки чтобы войти в аккаунт
    cookies = ACCOUNT_POOL.load_cookies(account)
    if cookies:
        context.add_cookies(cookies)
    
    # Случайный поиск
    queries = ["диван", "холодильник", "велосипед", "телефон", "стол"]
    query = random.choice(queries)
    
    await page.goto(f"https://www.avito.ru/rossiya?q={query}")
    await human_delay(2, 5)
    await scroll_like_human(page)
    
    # Открыть 2-3 случайных объявления
    links = await page.query_selector_all(".iva-item-title-_qCwt a")
    for link in random.sample(links[:10], min(3, len(links))):
        await link.click()
        await human_delay(15, 45)  # "читаем" объявление
        await scroll_like_human(page)
        await page.go_back()
        await human_delay(2, 4)
    
    # Сохраняем обновлённые куки
    new_cookies = context.cookies()
    ACCOUNT_POOL.save_cookies(account, new_cookies)
    browser.close()
```

---

## БЛОК 7 — МОБИЛЬНЫЙ API АВИТО (альтернатива браузеру)

Мобильное приложение Авито использует **отдельный JSON API** — он менее защищён чем веб.

```python
from curl_cffi import requests

def fetch_avito_mobile_api(query: str, city_id: int, proxy_url: str):
    """Запрос к мобильному API Авито."""
    url = "https://m.avito.ru/api/9/items"
    
    r = requests.get(
        url,
        params={
            "query": query,
            "locationId": city_id,
            "page": 1,
            "limit": 50,
        },
        headers={
            "User-Agent": "ru.avito.mobile.android/272 (Android 13; Google Pixel 6)",
            "x-authorization": "bearer guest",  # или токен авторизованного пользователя
            "accept": "application/json",
            "accept-language": "ru",
        },
        impersonate="chrome120",
        proxies={"https": proxy_url},
        timeout=15,
    )
    
    if r.status_code == 200:
        return r.json()  # чистый JSON без JS-рендеринга
    return None
```

**Плюс:** Не нужен браузер, в 5-10 раз быстрее.  
**Минус:** Структура может меняться, Авито может ужесточить.

---

## БЛОК 8 — ПЛАН ДЕЙСТВИЙ ДЛЯ ИВАНА

### Прямо сейчас (сегодня):
- [ ] Создать 3 аккаунта Авито (с разных телефонов/почт)
- [ ] Начать прогрев: зайти, посмотреть объявления
- [ ] Купить 3 мобильных прокси на mobileproxy.space (Beeline, не Москва)

### Эта неделя:
- [ ] Переключить парсер с undetected_chromedriver на **Playwright + stealth**
- [ ] Убедиться что Xvfb запущен и `headless=False`
- [ ] Передавать прокси через `playwright.chromium.launch(proxy={...})`
- [ ] Проверить: 5 парсингов подряд без капчи

### Следующие 2-4 недели:
- [ ] Реализовать `AccountPool` с ротацией
- [ ] Добавить сохранение/загрузку куки сессий
- [ ] Добавить задержки `human_delay()` между запросами
- [ ] Добавить `curl_cffi` как быстрый путь (с fallback на браузер)

### Через 2-3 месяца:
- [ ] Аккаунты прогреты → подключать к продакшну
- [ ] Отказаться от покупных куки-сессий
- [ ] Масштабировать до 5 аккаунтов при росте нагрузки

---

## БЛОК 9 — ЭКОНОМИКА

| Статья | Стоимость/мес |
|---|---|
| 3 мобильных прокси (mobileproxy.space) | ~4 500 ₽ |
| Аккаунты Авито | бесплатно |
| GPT-4o Vision (100 фото на парсинг × 30 парсингов) | ~1 500 ₽ |
| VPS для worker | ~600 ₽ |
| **Итого расходы** | **~6 600 ₽/мес** |
| **Доход при 30 парсингов/день** | **~171 000 ₽/мес** |
| **Маржа** | **96%** |

---

## ИТОГ В ОДНОЙ ФРАЗЕ

> **Playwright + stealth + Xvfb (не headless) + пул из 3 мобильных прокси + 3 прогретых аккаунта Авито = стабильный парсинг без капчи и банов.**

---

**Контакт:** Лера, saltykovatarget@gmail.com  
**Связанные ТЗ:** `01_parser_integration.md`, `15_PARSER_VISION_ARCHITECTURE.md`

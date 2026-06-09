# 19_VITE_INTEGRATION.md — интеграция фронта (Vite) с бэком

> 👋 **Иван:** этот документ закрывает 90% вопросов «как фронт собирается и подружить с бэком». Если что-то не сходится — скинь скрин/URL/console-ошибку, разберёмся.

---

## TL;DR

- Фронт уже на **Vite + React 18 + TS + Tailwind**, не CRA.
- В `vite.config.ts` **уже настроен dev-proxy** `/api/* → http://127.0.0.1:8000` — подними FastAPI на :8000, фронт сам в него пойдёт.
- Прод-сборка — `npm run build` → папка `dist/` (статика + один `index.html`).
- На фронте есть **Demo Mode**: если `/api/session/me` не отвечает, фронт автоматически переключается в режим моков (чтобы Лера могла прокликивать локально). Когда твой бэк отвечает реальным JSON — Demo Mode сам выключается. Тебе ничего не нужно делать.

---

## 1. Где лежит фронт

```
~/Desktop/avitolog-2026-05-15-lite-for-audit/app/
├── src/                  ← React-код
├── index.html            ← entry
├── vite.config.ts        ← конфиг (proxy, alias, build)
├── package.json
└── dist/                 ← создаётся при build
```

Stack: Vite 6, React 18, TypeScript, Tailwind v4, shadcn/ui, motion, sonner (toasts), Radix UI.

---

## 2. Команды

```bash
cd ~/Desktop/avitolog-2026-05-15-lite-for-audit/app
npm install
npm run dev     # dev-сервер на :5173 с HMR + proxy /api → :8000
npm run build   # прод-сборка → dist/
npm run preview # локально проверить сборку как в проде
```

---

## 3. Dev-proxy (УЖЕ настроен)

В `vite.config.ts`:

```ts
server: {
  port: 5173,
  open: true,
  proxy: {
    '/api':     { target: 'http://127.0.0.1:8000', changeOrigin: false, ws: true },
    '/healthz': { target: 'http://127.0.0.1:8000', changeOrigin: false },
  },
},
```

**Что это значит для тебя:**
- Поднимаешь FastAPI на `127.0.0.1:8000` — фронт `localhost:5173` сам проксирует все `/api/*` к тебе.
- SSE и WebSocket работают (`ws: true`).
- CORS не нужен в dev (всё идёт через тот же origin).

Если у тебя бэк на другом порту — скажи, поменяю `target`.

---

## 4. Прод-сборка и раздача

`npm run build` → `dist/` со структурой:

```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js
│   ├── index-[hash].css
│   └── …
└── cases/favicon/…
```

**Главное про SPA-роутинг:** у нас hash-based роутинг (`#chat`, `#tools`, `#wallet`, `#tool/parser`, и т.д.), плюс несколько **path-based** для редиректов:

| Path | Что |
|---|---|
| `/` | основной entry |
| `/auth/callback` | OAuth-callback Telegram |
| `/avito/callback` | OAuth-callback Авито |
| `/billing/success`, `/billing/fail` | редиректы Точка-банка после оплаты |
| `/policies/privacy-policy`, `/cookies`, `/offer` | юр-страницы |

Любой другой URL — фронт показывает лендинг.

### Готовый nginx-конфиг

```nginx
server {
  listen 443 ssl http2;
  server_name aiavitologpro.ru;

  ssl_certificate     /etc/letsencrypt/live/aiavitologpro.ru/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/aiavitologpro.ru/privkey.pem;

  root /var/www/avitolog/dist;
  index index.html;

  # Backend API
  location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # для SSE
    proxy_read_timeout 600s;
  }

  location /healthz {
    proxy_pass http://127.0.0.1:8000;
  }

  # Статика с долгим кэшем
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # SPA fallback — все остальные пути возвращают index.html
  location / {
    try_files $uri $uri/ /index.html;
  }
}

map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}
```

Главное — `try_files ... /index.html` для всех неизвестных путей (иначе `/billing/success` даст 404).

---

## 5. Полный список endpoints, которые ждёт фронт

Все маршруты под `/api/*`. Body всегда JSON. Cookie-сессия `httpOnly`.

### 5.1 Авторизация

| Метод | Путь | Что возвращает |
|---|---|---|
| `GET` | `/api/session/me` | `UserProfile` (см. §6) — текущий юзер. **401** если не залогинен. |
| `POST` | `/api/session/login` | `{ ok: true }` — после успешного логина |
| `DELETE` | `/api/session/logout` | `{ ok: true }` |
| `GET` | `/api/session/telegram/start` | `{ widget_url }` или редирект на TG-виджет |

### 5.2 Кошелёк

| Метод | Путь | Что возвращает |
|---|---|---|
| `GET` | `/api/wallet/balance` | `{ balance_kopecks: number }` |
| `GET` | `/api/wallet/transactions` | `{ items: Transaction[] }` (см. §6) |

### 5.3 Оплата (Точка)

| Метод | Путь | Что возвращает |
|---|---|---|
| `POST` | `/api/access/orders` | `{ order_id, payment_url, success_url }` — создание заказа на пакет |
| `POST` | `/api/access/tochka/confirm` | `{ status: 'paid'\|'failed', balance_kopecks }` — подтверждение после редиректа Точки |

Body `POST /api/access/orders`:
```json
{ "package": "100" | "300" | "500", "topup_kopecks": 0 }
```
Или для произвольного пополнения:
```json
{ "package": null, "topup_kopecks": 50000 }
```

### 5.4 Чаты и сообщения

| Метод | Путь | Что |
|---|---|---|
| `GET` | `/api/workspaces` | `{ items: Chat[] }` — список чатов юзера |
| `POST` | `/api/workspaces` | `Chat` — создать новый чат (body: `{ title?: string }`) |
| `PATCH` | `/api/workspaces/:id` | `{ ok: true }` — переименовать (body: `{ title }`) |
| `DELETE` | `/api/workspaces/:id` | `{ ok: true }` — удалить |
| `POST` | `/api/workspaces/bulk-archive` | `{ ok: true }` — массовая архивация (body: `{ ids: string[] }`) |
| `GET` | `/api/workspaces/:id/turns` | `{ items: Message[] }` — сообщения чата |
| `POST` | `/api/workspaces/:id/turns` | **SSE-стрим** ответа AI (см. §7) |
| `POST` | `/api/workspaces/:id/images` | `{ url, key }` — multipart upload картинки |
| `POST` | `/api/workspaces/:id/documents` | `{ url, key }` — multipart upload документа |

### 5.5 Профиль и документы

| Метод | Путь | Что |
|---|---|---|
| `GET` | `/api/account` | `UserProfile` (тот же что `/session/me`) |
| `GET` | `/api/account/documents` | `Document[]` — список юр-документов юзера (согласия и т.д.) |

### 5.6 Поддержка

| Метод | Путь | Что |
|---|---|---|
| `POST` | `/api/support/tickets` | `{ id, status: 'open' }` — отправка обращения |

### 5.7 Будущие (R2/R3 — пока не используются)

- `POST /api/parser/start` — запуск парсера ниши
- `GET /api/parser/runs`, `GET /api/parser/runs/:id` — история и результаты прогонов
- `POST /api/positions/check` — проверка позиций
- `POST /api/xls/analyze` — анализ XLS

См. отдельные ТЗ: 01, 15, 16, 17.

---

## 6. TypeScript типы (можно копировать как контракт)

```ts
// UserProfile — что фронт ждёт от GET /api/session/me
interface UserProfile {
  id: string;
  plan: 'free' | 'basic' | 'plus' | 'premium';
  plan_until: string | null;          // ISO
  is_premium: boolean;
  daily_questions_used: number;
  daily_questions_limit: number;
  daily_questions_resets_at: string | null;  // ISO
  telegram_id: number | null;
  telegram_username: string | null;
  full_name: string | null;
  username: string | null;
  photo_url: string | null;
}

// Transaction — GET /api/wallet/transactions items[]
interface Transaction {
  id: number;
  type: 'spend' | 'topup_regular' | 'topup_package_100' | 'topup_package_300' | 'topup_package_500' | 'bonus_signup' | 'refund';
  amount_kopecks: number;             // отрицательное для spend, положительное для пополнений
  balance_after_kopecks: number;
  description: string;
  related_entity?: string;            // например 'parser_run:42'
  package_type?: string;
  created_at: string;                 // ISO
}

// Chat — GET /api/workspaces items[]
interface Chat {
  id: string;
  title: string;
  created_at: string;                 // ISO
  updated_at: string;                 // ISO
  archived?: boolean;
  starting_tool?: 'parser_niche' | 'xls_analysis' | 'position_check' | 'audit' | null;
}

// Message — GET /api/workspaces/:id/turns items[]
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;                 // ISO
  images?: string[];                  // URLs uploaded картинок
  exports?: Array<{
    id: string;
    kind: 'docx' | 'xlsx';
    file_name: string;
    mime: string;
    size_bytes: number;
    download_url: string;
  }>;
}
```

---

## 7. SSE-стрим ответа AI

`POST /api/workspaces/:id/turns` — это не обычный JSON, а **Server-Sent Events**:

**Запрос:**
```http
POST /api/workspaces/abc-123/turns HTTP/1.1
Content-Type: application/json
Accept: text/event-stream

{ "content": "Помоги с анализом ниши", "docs_only": false, "image_keys": [] }
```

**Ответ (стрим):**
```
data: {"type":"delta","content":"Запускаю "}

data: {"type":"delta","content":"парсер "}

data: {"type":"delta","content":"по нише."}

data: {"type":"export","export":{"id":"e1","kind":"docx","file_name":"report.docx","mime":"...","size_bytes":12345,"download_url":"/api/files/e1"}}

data: {"type":"done","message_id":"msg-42"}
```

Каждое событие = одна строка `data: <json>` + пустая строка. Финал — `type: 'done'`.

Заголовки ответа:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no` (важно если за nginx — иначе он буферизит)

---

## 8. Demo Mode (можешь игнорировать, фронт сам обработает)

На фронте есть авто-режим: если `/api/session/me` упал с **network error / 404 / 5xx** (НЕ 401) — фронт **сам переключается в моки**: показывает «Демо-режим» бейдж, возвращает фейкового юзера, баланс 45 ₽, AI отвечает шаблонами. Это нужно Лере для прокликивания дизайна локально.

**Когда твой бэк ответит реальным JSON на `/api/session/me`** (или 401 для не залогиненного) — Demo Mode сам выключится. Тебе ничего настраивать не нужно.

Файлы Demo Mode (для справки, не трогай):
- `src/lib/demoMode.ts`
- `src/lib/mockData.ts`
- `src/lib/mockRouter.ts`
- `src/components/DemoBadge.tsx`

Если что-то идёт через Demo вместо твоего бэка — открой DevTools → Console, ищи `[Demo Mode]` warnings.

---

## 9. HTML-мокапы в `mockup/r1/*.html` — это НЕ код

В `~/Desktop/avitolog-audit/mockup/r1/` лежат статичные HTML-страницы (parser-report, cabinet, и т.д.). Это **дизайн-референс**, не код для интеграции. Все актуальные экраны уже в React в `app/src/components/`:

| HTML мокап | React компонент |
|---|---|
| `parser-report.html` | `src/components/ParserReportPage.tsx` |
| `chat.html` | `src/components/ChatPage.tsx` |
| `wallet.html` (в archive_old_ui) | `src/components/WalletPage.tsx` |
| (нет) | `src/components/tools/ToolsPage.tsx` |

В папке `archive_old_ui/` и `tz/archive/` — **старая подписочная модель**, не реализовывать. См. warning-блок в `index.html` репо.

---

## 10. Env-переменные

Сейчас фронт ничего не требует от env (всё захардкожено). Если **захочешь переопределить** API-base в проде — добавь в `.env.production`:

```
VITE_API_BASE_URL=https://aiavitologpro.ru
```

И я добавлю в `src/lib/api.ts` использование `import.meta.env.VITE_API_BASE_URL` вместо относительных путей.

Сейчас просто оставь как есть — все запросы идут на тот же origin (`fetch('/api/...')`).

---

## 11. Если что-то ломается — что прислать Лере

1. **URL страницы** где видишь проблему (`localhost:5173/#chat` или `aiavitologpro.ru/wallet` и т.д.)
2. **Console** — DevTools → Console → скриншот всех **красных** ошибок
3. **Network** — DevTools → Network → найди запрос который красный (4xx/5xx) → скриншот колонок Status / URL / Response
4. **Что нажимал** — 1 предложение типа «открыл /tools, кликнул карточку Парсер ниши, увидел белый экран»

Этого достаточно чтобы я воспроизвела и за 10 мин ответила что менять.

---

## 12. Контакты

- **Лера:** saltykovatarget@gmail.com · TG @valeriia_avitolog
- Все ТЗ: https://saltykovatarget-crypto.github.io/avito-tools-mockup/r1/
- Git: `git@github.com:saltykovatarget-crypto/avito-tools-mockup.git`

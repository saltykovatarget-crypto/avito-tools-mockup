# Страница «Инструменты» + связка с чатом — интеграция

**Дата:** 2026-06-03
**Статус:** делаем в R1 (фронт-компоненты готовы у Леры)
**Связано:** `02_wallet_backend_final.md`, `14_AI_BACKEND_INTEGRATION.md`, `06_WORKPLAN_FOR_IVAN.md`

> ⚠️ **Концепция:** Два входа в инструменты (чат + витрина `/tools`), один результат — **новый чат** с панелью инструмента. AI продаёт inline-карточками. Юзер видит каталог + историю.

---

## 🎯 Что готово у Леры (фронт)

Компоненты лежат в `app/src/components/tools/`:

| Файл | Что |
|---|---|
| `ToolsPage.tsx` | Полная страница `/tools` (sticky-шапка, hero, каталог, история) |
| `ToolCard.tsx` | Карточка инструмента (4 состояния: available / insufficient / coming_soon / launching) |
| `RecentRunCard.tsx` | Карточка прошлого запуска (с кнопкой «Запустить снова») |
| `InlineToolSuggestion.tsx` | Компактная inline-карточка для вставки в сообщения AI |
| `index.ts` | Барель-экспорт |

Все компоненты используют mock-данные. **Твоя задача — подключить к API.**

---

## 📋 Что нужно от Ивана

### 1. Маршрут `/tools` в AppRouter

```tsx
// app/src/components/AppRouter.tsx (или где у тебя роутинг)
import { ToolsPage } from './tools';

// в конфиге роутов:
<Route path="/tools" element={
  <ToolsPage
    onBack={() => navigate(-1)}
    onLaunchTool={(toolId) => handleToolLaunch(toolId)}
    onOpenRun={(run) => navigate(`/chat/${run.contextChatId}`)}
  />
} />
```

### 2. Логика `handleToolLaunch(toolId)`

При клике «Запустить» (с любой точки — Hero, ToolCard, RecentRunCard, InlineToolSuggestion):

```ts
async function handleToolLaunch(toolId: string) {
  // 1. Создать новый чат с метаданными инструмента
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: getToolName(toolId),                    // «Парсер ниши»
      metadata: {
        starting_tool: toolId,                       // 'parser_niche' | 'xls_analysis' | ...
        source: 'tools_page',                        // или 'inline_suggestion' | 'quick_start'
      },
    }),
  });
  const { chat_id } = await res.json();

  // 2. Переход в новый чат
  navigate(`/chat/${chat_id}`);

  // 3. (необязательно) Я.Метрика: ym(counterId, 'reachGoal', 'tool_launch', { tool: toolId, source })
}
```

### 3. API `POST /api/chats` — расширить

Добавить поле `metadata.starting_tool` чтобы:
- Записать в `chats.metadata` JSONB
- AI при первой генерации видел этот контекст и сразу открыл нужную панель (Парсер → форма URL; XLS → загрузка файла; и т.д.)

```python
# Псевдокод
@router.post("/api/chats")
def create_chat(request: CreateChatRequest, user=Depends(get_current_user)):
    chat = Chat(
        user_id=user.id,
        title=request.title,
        metadata=request.metadata or {},   # сохраняем starting_tool
    )
    db.add(chat)
    db.commit()

    # При первом запросе к AI этот metadata используется
    # для приветствия с правильной панелью (см. 14_AI_BACKEND_INTEGRATION §5)
    return {"chat_id": chat.id}
```

### 4. API `GET /api/tools/recent_runs` (новый)

```
GET /api/tools/recent_runs?limit=10
→ [
    {
      "id": "uuid",
      "tool_id": "parser_niche",
      "tool_name": "Парсер ниши",
      "tool_icon": "🔍",
      "context_label": "ворота гаражные · Москва",
      "date": "28.05 14:02",
      "status": "success",
      "price_kopecks": 19000,
      "chat_id": 12345                        // чтобы открыть результат
    },
    ...
  ]
```

Источник: таблица `tool_runs` (создаётся при списании за каждое платное действие).

### 5. Таблица `tool_runs` (новая или расширить wallet_transactions)

```sql
CREATE TABLE tool_runs (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    chat_id INTEGER REFERENCES chats(id),
    tool_id VARCHAR(50) NOT NULL,                    -- 'parser_niche' | 'xls_analysis' | 'audit' | ...
    tool_name VARCHAR(100) NOT NULL,                 -- «Парсер ниши» (snapshot для истории)
    context_label TEXT,                              -- «ворота гаражные · Москва» (для UI)
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',  -- 'in_progress' | 'success' | 'failed'
    price_kopecks BIGINT NOT NULL,
    metadata JSONB DEFAULT '{}',
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_tool_runs_user_date ON tool_runs(user_id, started_at DESC);
CREATE INDEX idx_tool_runs_chat ON tool_runs(chat_id);
```

При запуске любого инструмента (парсер, XLS-анализ, аудит и т.д.) — создаём запись в `tool_runs`, потом обновляем `status` и `completed_at` когда работа закончилась.

### 6. InlineToolSuggestion — связь с AI

Когда AI хочет предложить инструмент в чате, он возвращает специальный блок в своём ответе. Возможны два подхода:

**Подход A — markdown-теги (проще):**
```
AI пишет: "...рекомендую сделать аудит:

{{tool_suggestion: audit | Аудит объявлений | XLS + парсер + AI-диагноз | 590 ₽}}

..."

Фронт парсит {{tool_suggestion}} и рендерит InlineToolSuggestion.
```

**Подход B — structured outputs (точнее):**
GPT-5.1 возвращает поле `tool_suggestions: [{ id, title, description, price_label }]` отдельно от текста. Фронт показывает inline-карточки между сообщениями.

Рекомендация: **подход A** для скорости MVP. Парсер `{{tool_suggestion: ...}}` в render.

### 7. Связь с балансом (`insufficient_funds` статус)

`ToolsPage` уже корректирует статус карточки если `balanceKopecks` есть в пропсах. Для этого нужно:

```ts
// На странице /tools запросить баланс при монтировании
const { balanceKopecks } = useWalletBalance();

<ToolsPage balanceKopecks={balanceKopecks} ... />
```

Если денег не хватает — карточка показывает «Пополнить кошелёк» вместо «Запустить».

### 8. Аналитика — что считать

В Яндекс Метрику отправлять цели:

| Цель | Когда | Параметры |
|---|---|---|
| `tools_page_view` | Открытие `/tools` | source (header / sidebar / link) |
| `tool_card_click` | Клик «Подробнее» | tool_id |
| `tool_launch` | Клик «Запустить» | tool_id, source (quick_start / tools_page / inline_chat / recent_runs) |
| `tool_launch_inline` | Клик «Запустить» в inline-карточке AI | tool_id, chat_id |
| `tool_launch_dismissed` | Клик «Не сейчас» | tool_id, chat_id |
| `recent_run_open` | Открытие прошлого запуска | tool_id, run_id |
| `tool_topup_redirect` | Клик «Пополнить» из инструмента | tool_id |

---

## 🎨 Что НЕ требует Ивана

Лера сделает сама через Claude Code:
- Любую полировку UI компонентов
- Добавление новых инструментов в список (когда появятся)
- Перевод иконок с emoji на duotone SVG (если решим)

---

## ⏱ Сроки и приоритеты

| Этап | Срок | Когда |
|---|---|---|
| Маршрут `/tools` + handleToolLaunch | 0.5 дня | После того как готов чат с metadata |
| Расширение `POST /api/chats` | 0.5 дня | В рамках Phase 3 (AI Чат) |
| Таблица `tool_runs` + миграция | 0.5 дня | До интеграции первого инструмента (Phase 4 — парсер) |
| `GET /api/tools/recent_runs` | 0.5 дня | После того как `tool_runs` пишется |
| InlineToolSuggestion markdown-парсер | 0.5 дня | Phase 3 (вместе с AI Чат) |
| Я.Метрика цели | 0.5 дня | Phase 8 (polishing) |
| **Итого** | **~3 дня работы Ивана** | **в рамках R1, без удлинения срока** |

Это **встраивается в существующий план R1**, не добавляет новых фаз.

---

## 🔗 Откуда юзер попадает на /tools

1. **Sidebar в чате** — пункт «Инструменты» (есть в мокапе `chat.html`)
2. **Меню старта** — пункт «Просто хочу инструмент» (опционально)
3. **Из URL вручную** — `aiavitologpro.ru/tools`
4. **Из футера/шапки** — если решим добавить

---

## 🚨 Edge cases

- **Юзер не залогинен** → редирект на `/login`
- **API вернул 500** на `/api/tools/recent_runs` → показать пустое состояние «Ещё не запускал инструменты»
- **Юзер кликнул «Запустить» 2 раза подряд** → debounce на фронте, на бэке idempotency_key
- **Юзер запускает инструмент пока баланс уже изменился** → перепроверить баланс в момент `POST /api/chats` и вернуть 402 если уже мало

---

## ✅ Чеклист

- [ ] Маршрут `/tools` подключён в AppRouter
- [ ] `POST /api/chats` принимает `metadata.starting_tool`
- [ ] AI при `starting_tool` сразу открывает нужную панель (см. `14_AI_BACKEND_INTEGRATION`)
- [ ] Таблица `tool_runs` создана
- [ ] При запуске каждого инструмента (парсер, XLS-анализ, аудит, проверка позиций) создаётся запись в `tool_runs`
- [ ] `GET /api/tools/recent_runs` работает
- [ ] InlineToolSuggestion markdown-парсер `{{tool_suggestion: ...}}` в чате
- [ ] Я.Метрика цели подключены

---

**Связь:** Лера · TG @valeriia_avitolog

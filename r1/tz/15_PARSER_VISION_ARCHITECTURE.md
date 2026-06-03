# АРХИТЕКТУРА РАБОТЫ С ПАРСИНГОМ — AI АВИТОЛОГ PRO

**Версия: 1.0 | Май 2026**

**Для:** Разработчик бэкенда + Валерия

**Цель:** описать полный путь данных парсинга — от сбора до выдачи пользователю — чтобы GPT-5.1 работал на доказательных данных, без угадайки.

---

## КЛЮЧЕВОЙ ТЕЗИС

**Парсер с vision-анализом — не «опциональная функция», а критическая часть продукта.**

Без vision GPT-5.1 выдаёт правдоподобные но неверные рекомендации. Кейс из имитации:

— Парсер собрал текстовые данные (заголовки, цены, продавцы)

— AI на основе общей методологии выдвинул гипотезу «у топов нет баннеров на фото → убрать баннер»

— Реальная картина (когда увидели фото лидера #1, DoorHanRu): **у лидера баннеры есть на каждом фото**

— Гипотеза AI была противоположна реальности

**Vision-анализ закрывает этот разрыв.** Без него парсер за 190 ₽ — это аналог LikeStats, продаёт «данные». С vision — продаёт «доказанные выводы».

---

## ВЕРХНЕУРОВНЕВАЯ СХЕМА

```
1. ПОЛЬЗОВАТЕЛЬ кликает "Запустить парсер" → списано 190 ₽
                            ↓
2. ПАРСЕР собирает 100 объявлений (текст + URL фото)
                            ↓
3. VISION-АНАЛИЗ прогоняет фото через vision-модель
                            ↓
4. БЭКЕНД формирует parser_for_ai.json (агрегации, паттерны, инсайты)
                            ↓
5. БЭКЕНД пушит структурированное системное сообщение в чат
                            ↓
6. GPT-5.1 читает по протоколу из системного промпта v3.1
                            ↓
7. AI выдаёт пользователю шапку + инсайты
                            ↓
8. Последующие шаги (3, 4, 5, 6, 8, 10) — опираются на эти данные
```

---

## БЛОК 1 — ЧТО СОБИРАЕТ ПАРСЕР (текущая база)

### 1.1 Поля одного объявления (items[])

Текущий парсер уже собирает:

| Поле | Тип | Назначение |
|---|---|---|
| `position` | int | позиция в выдаче (1-100) |
| `page` | int | страница выдачи |
| `title` | str | заголовок |
| `url` | str | прямая ссылка на объявление |
| `avito_id` | str | ID объявления |
| `price` | int | цена в рублях |
| `seller_name` | str | имя продавца |
| `location` | str | локация |
| `has_vas` | bool | используется ли продвижение |
| `vas_types` | list | какие виды VAS |
| `photo_url` | str | URL первого фото (превью) |
| `views_today` | int | просмотров сегодня |
| `views_total` | int | просмотров всего |
| `description` | str | полное описание |
| `seller_url` | str | URL продавца |
| `has_delivery` | bool | есть доставка |
| `is_promoted` | bool | продвинуто |
| `photo_count` | int | сколько фото в карточке |
| `all_photo_urls` | list | URL всех фото |

### 1.2 Что нужно добавить

**Поле `visual_analysis`** для каждого item — результат vision-анализа фото.

См. блок 2 ниже.

### 1.3 Аккаунты (accounts{})

Текущая агрегация:

— `market_share_today`, `market_share_total`

— `ads_in_search`, `ads_promoted`

— `views_today_sum`, `views_total_sum`

— `rating`, `reviews_count`

— `ad_urls`

Этого достаточно. Дополнений не нужно.

### 1.4 Stats (общая сводка)

Текущие поля достаточны:

— `total_ads`, `total_accounts`, `ads_with_vas`

— `views_today_total`, `views_all_total`

— `avg_price`, `median_price`

---

## БЛОК 2 — VISION-АНАЛИЗ ФОТО

### 2.1 Что делает vision-pipeline

После сбора всех items парсер для каждого `photo_url`:

1. Скачивает изображение через тот же undetected-chromedriver (фото лежит на CDN Avito с защитой 403 на прямой запрос)

2. Передаёт в vision-модель с детерминированным промптом

3. Получает структурированный JSON

4. Записывает в `items[i].visual_analysis`

### 2.2 Какую vision-модель использовать

**Варианты:**

| Модель | Цена за фото | Качество | Скорость |
|---|---|---|---|
| GPT-4o Vision | ~$0.005 | Высокое | 1-2 сек |
| Claude Sonnet 3.7 Vision | ~$0.005 | Высокое | 1-2 сек |
| Gemini 2.0 Flash Vision | ~$0.001 | Среднее | 0.5-1 сек |

**Рекомендую GPT-4o Vision** — единая инфраструктура с основным AI Авитологом (тот же OpenAI), цена приемлемая, качество распознавания русских надписей хорошее.

### 2.3 Детерминированный промпт для vision

Промпт **строго одинаковый для всех фото** — это критично для воспроизводимости и сравнения.

```
Ты анализируешь фото товарного объявления на Авито.

Верни ровно эту JSON-структуру. Никаких пояснений, 
никакого markdown, только JSON.

{
  "main_subject": "что главное на фото — одна фраза",
  "subject_position": "центр | лево | право | верх | низ",
  "background_type": "белый | фотореалистичный | абстрактный | коллаж",
  "lighting": "дневной | ночной | искусственный | смешанный",
  "dominant_colors": ["цвет1", "цвет2", "цвет3"],
  
  "has_text_overlay": true | false,
  "text_on_photo": "точный текст на фото или пустая строка",
  "text_position": "верх | низ | лево | право | центр | по всей площади",
  "text_coverage_pct": число от 0 до 100,
  
  "has_price_on_photo": true | false,
  "has_brand_logo": true | false,
  "brand_name_visible": "название бренда или пустая строка",
  
  "has_human": true | false,
  "human_count": число,
  "human_role": "клиент | монтажник | продавец | модель | не определено",
  
  "photo_type": "продуктовое | контекстное | коллаж | баннер | схема | инсталляция | смешанное",
  "professionalism_score": число от 1 до 10,
  "uniqueness_indicators": ["признак1", "признак2"],
  
  "context_visible": "что за контекст вокруг товара — одна фраза",
  "product_visible_clearly": true | false,
  "product_coverage_pct": число от 0 до 100,
  "shows_size_or_scale": true | false,
  "shows_installation_process": true | false,
  
  "seasonal_marker": "зима | лето | весна | осень | не определено",
  "time_of_day": "день | ночь | вечер | утро | не определено",
  
  "visual_strengths": ["сила1", "сила2"],
  "visual_weaknesses": ["слабость1", "слабость2"]
}

ПРАВИЛА:
— Не интерпретируй "хорошо/плохо" — описывай факты
— Текст распознавай точно, без сокращений
— Если не уверен в значении — пиши "не определено"
— Bool поля строго true или false, без других значений
— Числа без процентов, единиц, скобок
```

### 2.4 Кеширование

**Кеш фото по photo_url** — если та же ссылка встречалась раньше (другой парсинг той же ниши, или то же объявление сохранилось), берём из кеша без повторного vision-вызова.

Это снижает себестоимость при повторных парсингах ниши на 30-50%.

Хранить кеш минимум 30 дней (Avito обычно обновляет CDN-URL не чаще).

### 2.5 Стоимость vision-анализа

100 объявлений × $0.005 = $0.5 за один парсинг ≈ 50 ₽

С учётом кеша при повторных запусках ниши: ~25-35 ₽

В себестоимости парсера (190 ₽) это даёт маржу 66-72% — приемлемо.

---

## БЛОК 3 — АГРЕГАЦИЯ ВИЗУАЛЬНЫХ ПАТТЕРНОВ

После vision-анализа всех 100 items бэкенд считает агрегации по нише.

### 3.1 Что считает бэкенд

```python
def aggregate_visual_patterns(items):
    """Агрегация визуальных паттернов по 100 items."""
    
    valid = [it for it in items if it.get('visual_analysis')]
    n = len(valid)
    
    # Распределение типов фото
    photo_types = {}
    for it in valid:
        pt = it['visual_analysis']['photo_type']
        photo_types[pt] = photo_types.get(pt, 0) + 1
    
    # Доли использования признаков
    use_text_overlay_pct = sum(1 for it in valid if it['visual_analysis']['has_text_overlay']) / n * 100
    use_price_on_photo_pct = sum(1 for it in valid if it['visual_analysis']['has_price_on_photo']) / n * 100
    use_brand_logo_pct = sum(1 for it in valid if it['visual_analysis']['has_brand_logo']) / n * 100
    use_human_pct = sum(1 for it in valid if it['visual_analysis']['has_human']) / n * 100
    
    # Средний professionalism
    avg_prof = sum(it['visual_analysis']['professionalism_score'] for it in valid) / n
    
    # КРИТИЧНО: что у топ-5 по просмотрам
    top5_by_views = sorted(valid, key=lambda x: x.get('views_today', 0), reverse=True)[:5]
    top5_patterns = {
        'use_text_overlay_pct': sum(1 for it in top5_by_views if it['visual_analysis']['has_text_overlay']) / 5 * 100,
        'use_human_pct': sum(1 for it in top5_by_views if it['visual_analysis']['has_human']) / 5 * 100,
        'photo_types': [it['visual_analysis']['photo_type'] for it in top5_by_views],
        'avg_professionalism': sum(it['visual_analysis']['professionalism_score'] for it in top5_by_views) / 5,
    }
    
    # Сравнение: что у топ-5 vs у всей выдачи
    delta_text_overlay = top5_patterns['use_text_overlay_pct'] - use_text_overlay_pct
    delta_human = top5_patterns['use_human_pct'] - use_human_pct
    
    return {
        "photo_type_distribution_pct": photo_types,
        "use_text_overlay_pct": round(use_text_overlay_pct, 1),
        "use_price_on_photo_pct": round(use_price_on_photo_pct, 1),
        "use_brand_logo_pct": round(use_brand_logo_pct, 1),
        "use_human_pct": round(use_human_pct, 1),
        "avg_professionalism_score": round(avg_prof, 1),
        
        "top5_by_views_patterns": top5_patterns,
        
        "delta_top5_vs_market": {
            "text_overlay": round(delta_text_overlay, 1),
            "human_in_frame": round(delta_human, 1),
        }
    }
```

### 3.2 Зачем нужны delta (топ-5 vs весь рынок)

Это **самые ценные данные** для AI.

Пример: если по всей выдаче 42% объявлений с баннером, но в топ-5 по просмотрам — 80%, то delta = +38%. Это значит: **баннер у лидеров работает чаще чем у проигрывающих**. Антипаттерн не подтверждается.

Если наоборот (по выдаче 42%, в топе 10%) — delta = -32%. Это значит: **баннер у топов используется реже → он мешает CTR**.

AI читает delta и формулирует чёткие выводы вместо общих гипотез.

---

## БЛОК 4 — ИНСАЙТЫ КОТОРЫЕ ФОРМИРУЕТ БЭКЕНД

GPT-5.1 плохо генерирует инсайты из голого JSON. Бэкенд формирует **готовые инсайты** на основе условий — AI берёт их в ответ.

### 4.1 Правила формирования insights_precomputed

```python
def generate_insights(market_summary, leaders, top_listings, 
                      price_segments, title_patterns, visual_patterns):
    insights = []
    
    # Концентрация рынка
    if leaders[0]['market_share_today'] > 30:
        insights.append(
            f"Лидер {leaders[0]['name']} занимает {leaders[0]['market_share_today']}% "
            f"доли рынка с {leaders[0]['ads_count']} объявлениями"
        )
    
    # Уровень продвижения
    if market_summary['vas_usage_pct'] > 70:
        insights.append(
            f"{market_summary['vas_usage_pct']}% объявлений используют VAS — "
            "без продвижения топовых позиций не получить"
        )
    
    # Доставка как точка дифференциации
    if market_summary['delivery_usage_pct'] < 10:
        insights.append(
            "Доставка используется крайне редко — точка дифференциации"
        )
    
    # Цены в заголовках (если нарушают правила Авито)
    if title_patterns['use_price_in_title'] > 0:
        insights.append(
            f"{title_patterns['use_price_in_title']} объявлений нарушают правила "
            "Авито (цены в заголовках) — модерация может снять"
        )
    
    # ВИЗУАЛЬНЫЕ ИНСАЙТЫ — критичные
    if visual_patterns['delta_top5_vs_market']['text_overlay'] > 20:
        insights.append(
            f"У лидеров текстовые баннеры на фото встречаются на "
            f"{visual_patterns['delta_top5_vs_market']['text_overlay']}% чаще "
            f"чем в среднем по нише — баннеры работают"
        )
    elif visual_patterns['delta_top5_vs_market']['text_overlay'] < -20:
        insights.append(
            f"У лидеров текстовые баннеры на фото встречаются на "
            f"{abs(visual_patterns['delta_top5_vs_market']['text_overlay'])}% реже — "
            f"баннеры мешают CTR в этой нише"
        )
    
    if visual_patterns['delta_top5_vs_market']['human_in_frame'] > 20:
        insights.append(
            "Лидеры значительно чаще используют человека в кадре — "
            "это UGC-доверие повышает CTR"
        )
    
    # Тип фото с лучшими просмотрами
    top_photo_types = visual_patterns['top5_by_views_patterns']['photo_types']
    most_common_top_type = max(set(top_photo_types), key=top_photo_types.count)
    insights.append(
        f"У топ-5 по просмотрам преобладает тип фото: {most_common_top_type}"
    )
    
    return insights
```

### 4.2 Принцип

**Бэкенд не выдвигает гипотез — формулирует факты из данных.**

«У лидеров баннеры на 38% чаще» — факт.

«Баннеры повышают CTR» — гипотеза, её не формирует бэкенд.

AI получает факты и формулирует уже от них.

---

## БЛОК 5 — ФОРМАТ parser_for_ai.json

Это финальная структура которая идёт в чат как системное сообщение.

### 5.1 Полная структура

```json
{
  "context": {
    "query": "гаражные ворота",
    "city": "Москва",
    "category_path": "Дом и дача / Ворота / Секционные ворота для гаража",
    "parsed_at": "28.05.2026"
  },

  "market_summary": {
    "total_ads": 100,
    "total_sellers": 44,
    "avg_price_rub": 58707,
    "median_price_rub": 55415,
    "price_min_rub": 25000,
    "price_max_rub": 250000,
    "vas_usage_pct": 85,
    "delivery_usage_pct": 0,
    "total_daily_views": 485
  },

  "leaders": [
    {
      "rank": 1,
      "name": "DoorHanRu",
      "market_share_today_pct": 37.1,
      "market_share_total_pct": 14.0,
      "ads_count": 11,
      "ads_promoted": 11,
      "daily_views_sum": 180,
      "avg_position": 48.5,
      "rating": 4.9,
      "reviews_count": 59
    }
  ],

  "top_listings": [
    {
      "position": 1,
      "title": "Ворота Гаражные Секционные Автоматические",
      "title_length": 43,
      "price_rub": 54773,
      "seller_name": "DoorHanRu",
      "daily_views": 117,
      "photo_url": "https://...",
      "has_vas": true,
      "vas_types": ["продвижение"],
      "url": "https://...",
      "first_3_lines_description": "...",
      
      "visual_analysis": {
        "photo_type": "баннер + контекстное",
        "has_text_overlay": true,
        "text_on_photo": "Официальный дилер DoorHan. Гарантия. Монтаж. Доставка",
        "text_coverage_pct": 25,
        "has_human": true,
        "human_role": "монтажник",
        "professionalism_score": 8,
        "shows_size_or_scale": true,
        "seasonal_marker": "не определено",
        "visual_strengths": ["узнаваемый брендинг", "виден контекст применения"],
        "visual_weaknesses": []
      }
    }
  ],

  "price_segments": {
    "economy": {
      "range_rub": "до 38 000",
      "count": 18,
      "avg_daily_views": 12,
      "share_pct": 18
    },
    "middle": {
      "range_rub": "38 000 — 72 000",
      "count": 56,
      "avg_daily_views": 8,
      "share_pct": 56
    },
    "premium": {
      "range_rub": "от 72 000",
      "count": 26,
      "avg_daily_views": 5,
      "share_pct": 26
    }
  },

  "title_patterns": {
    "most_common_words": ["ворота", "гаражные", "секционные", "автоматические"],
    "use_capslock_first_letters_count": 4,
    "use_brand_in_title_count": 6,
    "use_specs_in_title_count": 5,
    "use_price_in_title_count": 0,
    "avg_title_length": 35,
    "max_title_length": 49,
    "min_title_length": 12
  },

  "visual_patterns": {
    "photo_type_distribution_pct": {
      "продуктовое": 28,
      "контекстное": 24,
      "баннер": 18,
      "коллаж": 12,
      "схема": 8,
      "смешанное": 10
    },
    "use_text_overlay_pct": 42,
    "use_price_on_photo_pct": 28,
    "use_brand_logo_pct": 35,
    "use_human_pct": 22,
    "avg_professionalism_score": 6.2,
    
    "top5_by_views_patterns": {
      "use_text_overlay_pct": 80,
      "use_human_pct": 60,
      "photo_types": ["баннер + контекстное", "продуктовое", "контекстное", "контекстное", "баннер + продуктовое"],
      "avg_professionalism": 7.4
    },
    
    "delta_top5_vs_market": {
      "text_overlay_pct": 38,
      "human_in_frame_pct": 38,
      "professionalism": 1.2
    }
  },

  "insights_precomputed": [
    "Лидер DoorHanRu занимает 37.1% доли рынка с 11 объявлениями",
    "85% объявлений используют VAS — без продвижения топовых позиций не получить",
    "Доставка используется крайне редко — точка дифференциации",
    "У лидеров текстовые баннеры на фото встречаются на 38% чаще чем в среднем по нише — баннеры работают",
    "Лидеры значительно чаще используют человека в кадре — UGC-доверие повышает CTR",
    "У топ-5 по просмотрам преобладает тип фото: баннер + контекстное"
  ]
}
```

### 5.2 Сохранение в БД

Этот JSON сохраняется в БД с привязкой к чату и пользователю:

```sql
CREATE TABLE parser_results (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    chat_id INTEGER REFERENCES chats(id),
    query TEXT NOT NULL,
    city TEXT NOT NULL,
    parser_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_parser_results_chat ON parser_results(chat_id);
CREATE INDEX idx_parser_results_user_query ON parser_results(user_id, query, city);
```

`user_query` индекс — для кеша при повторных запросах той же ниши той же ниши тем же пользователем.

---

## БЛОК 6 — СИСТЕМНОЕ СООБЩЕНИЕ В ЧАТЕ

Когда парсер отработал, бэкенд формирует **markdown-сообщение** и пушит его в чат как сообщение от ассистента (role: assistant, тип: parser_result).

### 6.1 Шаблон системного сообщения

```markdown
🔍 **РЕЗУЛЬТАТ ПАРСИНГА КОНКУРЕНТОВ**

**Контекст:**
- Запрос: {context.query}
- Город: {context.city}
- Категория: {context.category_path}
- Дата: {context.parsed_at}

**Сводка рынка:**
- Объявлений всего: {market_summary.total_ads}
- Уникальных продавцов: {market_summary.total_sellers}
- Средняя цена: {market_summary.avg_price_rub} ₽
- Медианная цена: {market_summary.median_price_rub} ₽
- Используют продвижение: {market_summary.vas_usage_pct}%
- Доставка: {market_summary.delivery_usage_pct}%
- Просмотров в день: {market_summary.total_daily_views}

**Топ-5 лидеров:**

| # | Аккаунт | Объявлений | Просм/день | Доля |
|---|---------|------------|------------|------|
| 1 | {leaders[0].name} | {leaders[0].ads_count} | {leaders[0].daily_views_sum} | {leaders[0].market_share_today_pct}% |
| ... |

**Топ-10 объявлений по позиции:**

1. "{top_listings[0].title}" — {top_listings[0].price_rub} ₽ — {top_listings[0].seller_name} — {top_listings[0].daily_views} просм/день — VAS: {top_listings[0].has_vas}
   URL: {top_listings[0].url}
   Фото: тип "{top_listings[0].visual_analysis.photo_type}", текст на фото: {top_listings[0].visual_analysis.has_text_overlay}, человек в кадре: {top_listings[0].visual_analysis.has_human}
2. ...

**Ценовые сегменты:**
- Эконом ({price_segments.economy.range_rub} ₽): {price_segments.economy.count} объявлений, ~{price_segments.economy.avg_daily_views} просм/день
- ...

**Паттерны заголовков:**
- Частые слова: {title_patterns.most_common_words}
- Заглавных первых букв: {title_patterns.use_capslock_first_letters_count}/10
- Бренд в заголовке: {title_patterns.use_brand_in_title_count}/10
- Цены в заголовке: {title_patterns.use_price_in_title_count}/10
- Средняя длина: {title_patterns.avg_title_length} символов

**Визуальные паттерны по всей нише:**
- Текстовый оверлей: {visual_patterns.use_text_overlay_pct}%
- Цена на фото: {visual_patterns.use_price_on_photo_pct}%
- Логотип бренда: {visual_patterns.use_brand_logo_pct}%
- Человек в кадре: {visual_patterns.use_human_pct}%
- Средний профессионализм: {visual_patterns.avg_professionalism_score}/10

**Визуальные паттерны у топ-5 по просмотрам:**
- Текстовый оверлей: {visual_patterns.top5_by_views_patterns.use_text_overlay_pct}%
- Человек в кадре: {visual_patterns.top5_by_views_patterns.use_human_pct}%
- Средний профессионализм: {visual_patterns.top5_by_views_patterns.avg_professionalism}/10

**Разница лидеры vs весь рынок:**
- По баннерам: {visual_patterns.delta_top5_vs_market.text_overlay_pct} п.п.
- По людям в кадре: {visual_patterns.delta_top5_vs_market.human_in_frame_pct} п.п.

**Ключевые инсайты:**

1. {insights_precomputed[0]}
2. {insights_precomputed[1]}
3. {insights_precomputed[2]}
4. {insights_precomputed[3]}
5. {insights_precomputed[4]}
6. {insights_precomputed[5]}
```

### 6.2 Почему markdown а не голый JSON

GPT-5.1 читает markdown **гораздо лучше** чем JSON-объекты в контексте.

Голый JSON → AI часто игнорирует поля, путает значения.

Markdown с метками → AI воспринимает как структурированный документ, корректно вытаскивает данные.

### 6.3 Прикреплённый JSON для глубокого доступа

Помимо markdown-сообщения в чате, **сам JSON сохраняется в БД** и доступен AI через function call если нужны детали которых нет в сводке.

Function для AI:

```json
{
  "name": "get_parser_detail",
  "description": "Получить детальные данные парсинга по конкретному полю",
  "parameters": {
    "type": "object",
    "properties": {
      "field_path": {
        "type": "string",
        "description": "Путь к полю в JSON парсинга, например 'top_listings[3].visual_analysis'"
      }
    }
  }
}
```

AI вызывает эту функцию когда ему нужно копнуть глубже основной сводки.

**Это решает проблему GPT-5.1** — он не должен держать в контексте 100 объявлений, но при необходимости может получить любое.

---

## БЛОК 7 — ПРОТОКОЛ ЧТЕНИЯ ПАРСИНГА GPT-5.1

В системном промпте v3.1 уже есть базовый протокол. Дополняю под vision.

### 7.1 Когда срабатывает

В истории чата есть сообщение с тегом `🔍 РЕЗУЛЬТАТ ПАРСИНГА КОНКУРЕНТОВ`.

### 7.2 Что делает AI

**Шаг 1.** Подтверждает прочитанное короткой шапкой (3-5 строк).

Не дублирует весь markdown — пользователь его уже видит выше.

```
📌 Принял парсинг: "{query}", {city}, {date}.
{total_ads} объявлений, {total_sellers} продавцов.
Лидер: {leaders[0].name} ({market_share}% доли).
Дальше — что делаем?
```

**Шаг 2.** На последующих шагах (3, 4, 5, 6) **обязательно** начинает с привязки к парсингу:

```
🔹 Из парсинга:
{конкретный факт из данных}

🎯 Применяю к твоему случаю:
{решение}
```

**Шаг 3.** При выводах про визуал — **только из visual_patterns**, не из общей методологии:

— Если delta показывает «у топов баннеры чаще» → говорить «баннеры в нише работают»

— Если delta показывает «у топов баннеры реже» → говорить «баннеры в нише снижают CTR»

— Если delta близка к нулю → говорить «баннер нейтрально влияет, дело не в нём»

### 7.3 Запреты для AI

— **Не выдвигать гипотезы про визуал** если в данных нет `visual_patterns` или `visual_analysis`

— **Не противоречить delta**: если данные говорят одно, AI не может выдавать обратное на основе «общей методологии»

— **Не цитировать инсайты дословно** — пересказ своими словами, со ссылкой на источник

---

## БЛОК 8 — ИНТЕГРАЦИЯ С ДРУГИМИ ШАГАМИ

После загрузки парсинга AI использует данные на конкретных шагах:

### Шаг 3 (Семантика, УТП)

— `title_patterns.most_common_words` → ключевые слова для оффера

— `visual_patterns.use_human_pct` → нужен ли UGC-стиль

— `insights_precomputed` → готовые формулировки

### Шаг 4 (Заголовки)

— `top_listings[].title` → реальные заголовки топ-10

— `title_patterns` → паттерны (длина, использование бренда)

— `title_patterns.use_price_in_title_count` → можно ли цены (правила Авито)

### Шаг 5 (Тексты)

— `top_listings[].first_3_lines_description` → первые строки у топов

— Реальные тексты можно подгружать через `get_parser_detail`

### Шаг 6 (Фото) — самый важный шаг для vision

— `visual_patterns` → формула что работает в нише

— `top_listings[].visual_analysis` → разбор конкретных фото лидеров

— `delta_top5_vs_market` → чем отличаются лидеры

— Сравнение с фото пользователя (после загрузки одного фото в чат)

### Шаг 8 (Продвижение)

— `market_summary.vas_usage_pct` → норма продвижения в нише

— `leaders[].ads_promoted / ads_count` → как продвигают лидеры

### Шаг 10 (Масштабирование)

— `price_segments` → в каком сегменте больше отдача

— `market_summary.delivery_usage_pct` → точка дифференциации

---

## БЛОК 9 — СЦЕНАРИЙ ВЫПОЛНЕНИЯ ПАРСЕРА (для разработчика)

### 9.1 Полная цепочка

```python
async def run_parser(user_id: int, chat_id: int, query: str, city: str):
    """Полный цикл выполнения парсера."""
    
    # 1. Списание 190 ₽
    wallet_service.spend(
        user_id=user_id,
        action=ActionPrice.PARSER_NICHE,
        related_entity='parser_run',
        idempotency_key=f"parser:{chat_id}:{query}:{city}"
    )
    
    # 2. Системное сообщение "идёт парсинг..."
    await push_system_message(chat_id, "🔍 Запускаю парсер ниши, это займёт 30-90 секунд...")
    
    # 3. Парсинг (текущая логика scraper.py)
    raw_items = await scrape_avito(query=query, city=city, limit=100)
    
    # 4. Vision-анализ фото (параллельно через asyncio.gather)
    items_with_vision = await analyze_photos_in_parallel(raw_items)
    
    # 5. Агрегация
    accounts = aggregate_accounts(items_with_vision)
    market_summary = compute_market_summary(items_with_vision)
    leaders = compute_leaders(accounts)
    top_listings = compute_top_listings(items_with_vision)
    price_segments = compute_price_segments(items_with_vision)
    title_patterns = compute_title_patterns(items_with_vision)
    visual_patterns = aggregate_visual_patterns(items_with_vision)
    insights = generate_insights(
        market_summary, leaders, top_listings, 
        price_segments, title_patterns, visual_patterns
    )
    
    # 6. Сборка parser_for_ai.json
    parser_data = {
        "context": {"query": query, "city": city, "category_path": ..., "parsed_at": ...},
        "market_summary": market_summary,
        "leaders": leaders[:5],
        "top_listings": top_listings[:10],
        "price_segments": price_segments,
        "title_patterns": title_patterns,
        "visual_patterns": visual_patterns,
        "insights_precomputed": insights
    }
    
    # 7. Сохранение в БД
    save_parser_result(user_id, chat_id, query, city, parser_data)
    
    # 8. Формирование markdown для чата
    md_message = render_parser_markdown(parser_data)
    
    # 9. Пуш в чат
    await push_assistant_message(
        chat_id=chat_id,
        text=md_message,
        message_type='parser_result',
        related_data=parser_data,
        is_part_of_paid_action=True  # не списывать ещё 5 ₽
    )
    
    # 10. Установка флага в контексте чата
    await update_chat_context(chat_id, parser_used_in_chat=True)
```

### 9.2 Vision-анализ параллельно

```python
async def analyze_photos_in_parallel(items: list) -> list:
    """Vision-анализ всех фото параллельно с лимитом concurrent requests."""
    
    semaphore = asyncio.Semaphore(10)  # 10 одновременных vision-запросов
    
    async def analyze_one(item):
        async with semaphore:
            photo_url = item.get('photo_url')
            if not photo_url:
                return item
            
            # Проверка кеша
            cached = await get_vision_cache(photo_url)
            if cached:
                item['visual_analysis'] = cached
                return item
            
            # Скачивание фото (через тот же chromedriver)
            image_bytes = await download_photo_through_browser(photo_url)
            if not image_bytes:
                return item
            
            # Vision-запрос
            try:
                analysis = await call_vision_model(image_bytes, VISION_PROMPT)
                await save_vision_cache(photo_url, analysis, ttl_days=30)
                item['visual_analysis'] = analysis
            except Exception as e:
                logger.error(f"Vision failed for {photo_url}: {e}")
                item['visual_analysis'] = None
            
            return item
    
    return await asyncio.gather(*[analyze_one(it) for it in items])
```

### 9.3 Тайминги

| Шаг | Время |
|---|---|
| Парсинг 100 объявлений | 20-60 сек |
| Vision-анализ 100 фото (параллельно, по 10) | 15-25 сек |
| Агрегация и инсайты | 1-2 сек |
| **Итого** | **40-90 сек** |

Это **приемлемо** для пользователя если показывать прогресс-индикатор.

---

## БЛОК 10 — РАСШИРЕНИЕ В БУДУЩЕМ

После запуска базовой версии можно добавить:

### 10.1 Парсинг конкретного продавца

Отдельный инструмент (90-120 ₽) — спарсить все объявления одного аккаунта.

Это полезно когда:

— Пользователь выбрал лидера и хочет глубоко его изучить

— Нужно понять как лидер варьирует визуал по сетке

— Нужен список всех его заголовков и цен

### 10.2 Сравнение нескольких ниш

Если пользователь работает в 2-3 связанных нишах — сравнить их парсинги.

### 10.3 История парсингов

Парсить одну нишу раз в неделю → видеть динамику рынка.

### 10.4 Vision для фото пользователя

Когда пользователь загружает фото в чат для разбора — прогнать через тот же vision-промпт, получить `visual_analysis`, сравнить с топом.

---

## БЛОК 11 — ЧЕКЛИСТ ВНЕДРЕНИЯ

### Этап 1 — базовый парсер без vision (1-2 недели)

— [ ] Доработка `avito_parser/scraper.py` под production

— [ ] Интеграция с моделью кошелька (списание 190 ₽)

— [ ] Сохранение `parser_for_ai.json` в БД

— [ ] Формирование markdown-сообщения

— [ ] Пуш в чат как assistant message

— [ ] Action button «Запустить парсер» в UI

— [ ] Передача `parser_used_in_chat=true` в системный промпт после запуска

### Этап 2 — vision-анализ (1 неделя)

— [ ] Скачивание фото через тот же chromedriver (с правильными заголовками)

— [ ] Интеграция с GPT-4o Vision API

— [ ] Детерминированный промпт (см. 2.3)

— [ ] Параллельные запросы с семафором

— [ ] Кеширование результатов по photo_url

— [ ] Запись `visual_analysis` в items

### Этап 3 — агрегации и инсайты (3-5 дней)

— [ ] Функция `aggregate_visual_patterns`

— [ ] Расчёт `delta_top5_vs_market`

— [ ] Функция `generate_insights` по правилам

— [ ] Тесты на реальных парсингах

### Этап 4 — function calling (опционально, 2-3 дня)

— [ ] Function `get_parser_detail` для AI

— [ ] Доступ AI к JSON в БД по ключу

### Этап 5 — vision для фото пользователя (3-5 дней)

— [ ] Обработка загрузки фото в чате

— [ ] Прогон через тот же vision-промпт

— [ ] Сравнение с топом по полям

---

## БЛОК 12 — КРИТЕРИИ КАЧЕСТВА

После внедрения проверить:

— [ ] AI выводит шапку парсинга без выдумывания цифр

— [ ] AI на Шаге 6 опирается на `visual_patterns`, не на общие гипотезы

— [ ] При наличии `delta_top5_vs_market` AI формулирует выводы по нему, не противоречит

— [ ] AI запрашивает фото пользователя для углублённого сравнения

— [ ] AI не предлагает парсер повторно если он уже отработал

— [ ] Время выполнения парсера < 90 секунд в 95% случаев

— [ ] Стоимость vision для одного парсинга < 60 ₽ (с учётом кеша)

— [ ] Маржа парсера ≥ 60%

---

## КРИТИЧНЫЕ ПРИНЦИПЫ ДЛЯ РАЗРАБОТЧИКА

1. **Vision не опционален.** Без него парсер выдаёт текстовые данные = аналог LikeStats. С vision = доказательная аналитика = ценность за 190 ₽.

2. **Детерминированный промпт.** Любое изменение в промпте vision = пересчёт кеша. Версионировать промпт.

3. **Markdown лучше JSON в чате.** GPT-5.1 читает структурированный markdown с метками гораздо лучше чем голый JSON.

4. **Бэкенд считает, AI формулирует.** Не перекладывать математику на AI — он ошибается. Все агрегации, проценты, дельты — на бэкенде.

5. **Готовые инсайты — обязательны.** GPT-5.1 без них не вытащит главное из данных. Бэкенд формирует факты, AI делает выводы из фактов.

6. **Кеш фото — критичен.** Без него парсер дорогой при повторных запусках. 30-дневный кеш по photo_url.

7. **Function calling для глубокого доступа.** Не пихать 100 объявлений в контекст — давать function для запроса деталей.

8. **Тестировать на реальных нишах.** Гипотезы про «универсальные правила» (типа «баннер всегда плохо») проверять на данных. Каждая ниша своя.

const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Инициализация
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Тот самый промпт, который мы утвердили
const SYSTEM_PROMPT = `
Ты — строгий ассистент-аналитик. 
Твоя задача — конвертировать входящий JSON в короткий текст.

!!! КРИТИЧЕСКИЕ ПРАВИЛА (ЕСЛИ НАРУШИШЬ — ТЫ УВОЛЕН) !!!
1. ЗАПРЕЩЕНО придумывать советы, упражнения или варианты тренировок.
2. ИСПОЛЬЗУЙ ТОЛЬКО те данные, которые пришли в блоке SPORT_TODAY_PLAN.
3. Если в SPORT_TODAY_PLAN пусто — пиши "**План:** Отдых / Не задан".
4. НИКАКИХ списков "Вариант 1", "Вариант 2".
5. НИКАКИХ советов про "пейте воду" или "берегите себя", если этого нет в данных.

--- СТРУКТУРА ОТВЕТА (Telegram Markdown) ---

1. **Приветствие** (1 короткая фраза).

2. 🌦 *Погода:* (Температура Утро -> Вечер. Осадки).

3. 🎓 *Расписание:* (Если есть события — перечисли. Если нет — "Свободно").

4. 📝 *Задачи:* (Только если есть).

5. 🏋️‍♂️ *Спорт:*
- *Вчера:* (Посмотри на SPORT_YESTERDAY_STATS.percent).
  - Если 0%: "Вчера полный пропуск. Плохо."
  - Если <100%: "Сделано частично."
  - Если 100%: "План закрыт. Отлично."
- *Сегодня:*
  (Возьми данные из SPORT_TODAY_PLAN.blocks).
  - Сгруппируй названия блоков и упражнения в одну строку через запятую.
  - ПРИМЕР: "Утро: Разминка, Лодочка. День: Турник (цель 15), Отжимания (цель 50)."
  - НЕ ДЕЛАЙ ВЕРТИКАЛЬНЫЙ СПИСОК.

6. 💡 *Напутствие:* (1 фраза).
`;

const SYSTEM_PROMPT_RECEIPT = `
    Ты — профессиональный бухгалтерский AI. Твоя задача — оцифровать чек с изображения.
    
    ВХОДНЫЕ ДАННЫЕ:
    1. Список доступных категорий пользователя: [{{CATEGORIES}}].
    
    ИНСТРУКЦИИ:
    1. Магазин: Найди название и Адрес (улица, дом). Если адреса нет, оставь пустым.
    2. Товары: Извлеки каждую позицию.
       - Для каждого товара выбери ЛУЧШУЮ категорию из списка.
       - Если товар (например, "Бананы") однозначно относится к категории (например, "Продукты" или "Фрукты"), используй её.
       - Если подходящей категории нет, используй "Другое".
    3. Математика (ВАЖНО):
       - total_sum: Итоговая сумма, написанная внизу чека.
       - calculated_sum: Просуммируй стоимость всех найденных тобой позиций.
       - Если скидка указана отдельной строкой, НЕ включай её в позиции, но укажи в поле discount.
    
    ВЕРНИ ТОЛЬКО JSON В ТАКОМ ФОРМАТЕ:
    {
      "shop": { "name": "Название", "address": "Адрес или null" },
      "date": "YYYY-MM-DD",
      "items": [
        { "name": "Название товара", "price": 1000, "qty": 1, "sum": 1000, "category": "Категория" }
      ],
      "meta": {
        "total_receipt": 0,    // Сумма из чека
        "total_calculated": 0, // Твоя сумма (price * qty для всех)
        "discount": 0          // Скидка если есть
      }
    }
    `

const SYSTEM_PROMPT_SPORT = `
Ты — AI-тренер. Твоя задача — преобразовать текстовый план тренировок в строгий JSON.

ФОРМАТ JSON:
{
  "title": "Название недели/плана",
  "blocks": [
    {
      "name": "Название блока (например: Утро, День)",
      "items": [
        { 
          "name": "Название упражнения", 
          "type": "check" (если просто сделать) ИЛИ "count" (если нужно считать разы),
          "target": Число (цель повторений или 1 для check),
          "step": Число (шаг добавления для кнопок, например 1, 5, 10. По умолчанию 1)
        }
      ]
    }
  ]
}

ВАЖНО:
1. Если упражнение подразумевает накопление (отжимания, подтягивания) — ставь type="count".
2. Если это разминка, растяжка или "продержаться 30 сек" — ставь type="check".
3. Верни ТОЛЬКО валидный JSON без Markdown.
`;

async function parseSportPlan(text) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        generationConfig: { responseMimeType: "application/json" } 
    });

    try {
        const result = await model.generateContent([SYSTEM_PROMPT_SPORT, text]);
        const response = await result.response;
        return JSON.parse(response.text());
    } catch (error) {
        console.error("AI Sport Error:", error);
        return null;
    }
}

async function generateMorningBriefing(weatherData, calendarEvents, sportYesterday, sportTodayPlan) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    // Добавляем явную проверку на наличие данных перед отправкой в промпт
    const hasPlan = sportTodayPlan && sportTodayPlan.blocks && sportTodayPlan.blocks.length > 0;

    const prompt = `
    ВХОДЯЩИЕ ДАННЫЕ (JSON):
    
    [WEATHER]: ${JSON.stringify(weatherData)}
    [CALENDAR]: ${JSON.stringify(calendarEvents)}
    
    [SPORT_YESTERDAY_STATS]: 
    ${JSON.stringify(sportYesterday || { percent: 0 })} 
    
    [SPORT_TODAY_PLAN] (Если здесь пусто, значит плана НЕТ. Не выдумывай его!): 
    ${hasPlan ? JSON.stringify(sportTodayPlan) : "EMPTY_NO_PLAN"}
    `;

    try {
        const result = await model.generateContent([SYSTEM_PROMPT_MORNING, prompt]);
        return result.response.text();
    } catch (error) {
        console.error("AI Error:", error);
        return "⚠️ Сбой AI. Данные недоступны.";
    }
}



// Функция для подготовки картинки
function fileToGenerativePart(buffer, mimeType) {
    return {
        inlineData: {
            data: buffer.toString("base64"),
            mimeType
        },
    };
}

async function parseReceipt(imageBuffer, categories) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        // Включаем JSON-режим, чтобы ИИ не писал лишнего
        generationConfig: { responseMimeType: "application/json" } 
    });

    const categoriesStr = categories.join(', ');

    const prompt = SYSTEM_PROMPT_RECEIPT.replace('{{CATEGORIES}}', categoriesStr);

    try {
        const imagePart = fileToGenerativePart(imageBuffer, "image/jpeg");
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();
        
        return JSON.parse(text);
    } catch (error) {
        console.error("AI Error:", error);
        return null;
    }
}

module.exports = { 
   parseReceipt,
   generateMorningBriefing,
   parseSportPlan,
};

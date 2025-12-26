const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Инициализация
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Тот самый промпт, который мы утвердили
const SYSTEM_PROMPT_MORNING = `
Ты — личный ассистент. Тон: бодрый, краткий.

Твоя задача — составить сводку утра.

ВХОДНЫЕ ДАННЫЕ:
1. [WEATHER] - Погода.
2. [CALENDAR] - События.
3. [SPORT_YESTERDAY] - Процент выполнения плана вчера (0-100%).
4. [SPORT_TODAY_BLOCKS] - Названия блоков тренировки на сегодня (например: "Утро", "Вечер").
5. [ENGLISH_WORD] - Слово дня (JSON).
СТРУКТУРА ОТВЕТА:
1. **Приветствие** (1 короткая фраза).
2. 🌦 **Погода:** (Утро -> Вечер, осадки).
3. 🇬🇧 **Word of the Day:**
   - *{Слово}* — {Перевод}.
   - {Определение}.
   - Пример: _{Пример}_.
4. 🗓 **Планы:** (Календарь. Если пусто — не пиши раздел).
5. 🏋️‍♂️ **Спорт:**
   - *Вчера:* (Дай оценку одной фразой в зависимости от процента. Если 0% — мягко пожури. Если 100% — похвали).
   - *Сегодня:* По плану: {Перечисли названия блоков через запятую}. Жми кнопку "Спорт"!
6. 💡 **Мысль дня:** (1 мотивационная фраза).

НЕ ИСПОЛЬЗУЙ markdown заголовки (#), только жирный текст (**).
`;

// --- ПРОМПТ ДЛЯ АНГЛИЙСКОГО ---
const SYSTEM_PROMPT_ENGLISH = `
Ты — преподаватель английского. Твоя задача — дать ОДНО интересное английское слово или идиому уровня B1-B2 (Intermediate).
Не бери банальные слова (типа cat, table). Бери полезные для разговора (e.g., Resilience, Hectic, To procrastinate).

ВЕРНИ ТОЛЬКО JSON:
{
  "word": "Само слово",
  "translation": "Перевод на русский",
  "definition": "Короткое определение на русском",
  "example": "Пример использования в предложении (EN)"
}
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

async function generateMorningBriefing(weather, calendar, todo, sportYesterday, sportTodayBlocks, englishWord) {

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `
    DATA:
    [WEATHER]: ${JSON.stringify(weather)}
    [CALENDAR]: ${JSON.stringify(calendar)}
    [SPORT_YESTERDAY]: ${JSON.stringify(sportYesterday || { percent: 0 })}
    [SPORT_TODAY_BLOCKS]: ${JSON.stringify(sportTodayBlocks || [])}
    [ENGLISH_WORD]: ${JSON.stringify(englishWord || {})}
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

async function generateEnglishWord() {
    const modelJson = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        generationConfig: { responseMimeType: "application/json" } 
    });

    try {
        const result = await modelJson.generateContent(SYSTEM_PROMPT_ENGLISH);
        return JSON.parse(result.response.text());
    } catch (error) {
        console.error("AI English Error:", error);
        return null;
    }
}

module.exports = { 
   parseReceipt,
   generateMorningBriefing,
   parseSportPlan,
   generateEnglishWord,
};

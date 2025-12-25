const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Инициализация
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Тот самый промпт, который мы утвердили
const SYSTEM_PROMPT = `
Ты — личный ассистент с характером тренера. Твой стиль: краткий, резкий, по делу. 
Ты ненавидишь бюрократию и длинные списки.

Твоя задача — дать выжимку, а не отчет.

--- ПРАВИЛА ОФОРМЛЕНИЯ (TELEGRAM) ---
1. Жирный шрифт: только одиночные звездочки (*Жирный*).
2. Списки: только буллиты (•).
3. НИКАКИХ отступов.

--- СТРУКТУРА ---

1. **Приветствие** (1 фраза в стиле Cyberpunk/Coach).

2. 🌦 *Погода:* (Одной строкой: Утро T -> Вечер T. Осадки).

3. 🎓 *Расписание:*
- Сначала вывод (*День тяжелый* / *Лайт*).
- Список (Время — Событие). Если пусто — не пиши раздел.

4. 📝 *Задачи:* (Только *Срочно* и *Средне*). Старые задачи пометь (висит N дн) 🗿.

5. 🏋️‍♂️ *Спорт:*
- *Вчера:*
  - Если 0% выполнения: Напиши ОДНУ унизительную фразу. (Пример: "Вчера ты забил на спорт. Стыдно."). НЕ ПЕРЕЧИСЛЯЙ УПРАЖНЕНИЯ.
  - Если <100%: "Сделано частично. Мог бы и дожать."
  - Если 100%: "Вчера — машина. Уважение."
- *Сегодня:*
  - Напиши СУТЬ тренировки в 1-2 строки.
  - ЗАПРЕЩЕНО делать вертикальный список упражнений.
  - Группируй: "Утро: Кор и Разминка. День: Турник (цель 15) и Отжимания (цель 50)."

6. 💡 *Напутствие:* (Коротко, без соплей).
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
    try {
        const prompt = `
          Данные на сегодня:
          Погода: ${JSON.stringify(weatherData)}
          Календарь: ${JSON.stringify(calendarEvents)}
    
          СПОРТ ВЧЕРА:
          ${sportYesterday ? sportYesterday.text : "Нет данных (возможно, план не активен)."}
    
          ПЛАН ТРЕНИРОВОК НА СЕГОДНЯ:
          ${sportTodayPlan ? sportTodayPlan.text : "Отдых или нет плана."}
          `;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("❌ Ошибка Gemini:", error);
        return null; // Вернем null, чтобы бот мог отправить обычное сообщение, если ИИ упал
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

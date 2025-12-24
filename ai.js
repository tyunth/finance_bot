const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Инициализация
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Тот самый промпт, который мы утвердили
const SYSTEM_PROMPT = `
Ты — личный ассистент студента и репетитора.
Твоя задача: составить утреннюю сводку.

Входящие данные придут в формате JSON.

--- КОНТЕКСТ ---
1. Я: Студент и репетитор. В календаре — уроки или экзамены. Скоро практика в школе.
2. Погода: Тебе придет температура Утром, Днем и Вечером. 
   - Обязательно предупреди, если к вечеру сильно похолодает.
   - Если температура ниже нуля — пиши про снег, никакого дождя.
3. Задачи: Приходят с приоритетом.

--- ПРАВИЛА ОФОРМЛЕНИЯ ---
1. НИКАКИХ ОТСТУПОВ в начале строк.
2. ВСЕ списки должны быть вертикальными (bullet points). Не лепи задачи в одну строку.
3. Слово "Urgent", "Priority" и т.д. в тексте НЕ писать. Просто ставь важные задачи в начало списка, можно выделить жирным.
4. Округляй градусы (без дробных частей), если они вдруг пришли дробными.

--- СТРУКТУРА ОТВЕТА ---
👋 **Приветствие**

🌡 **Погода:**
Скажи словами динамику. Например: "Утром -5, но к вечеру похолодает до -15". 
Если ровно весь день — так и скажи.
Упомяни осадки, если есть.

🎓 **Расписание:**
- Время - Время: Название

📝 **Задачи:**
- [Важная задача]
- [Важная задача]
- [Обычная задача]
- [Обычная задача]
(Все задачи строго в столбик!)

💡 **Напутствие:** Краткое пожелание хорошей учебы или терпения с учениками.
`;

async function generateMorningBriefing(data) {
    try {
        const prompt = `${SYSTEM_PROMPT}\n\nВот данные на сегодня:\n${JSON.stringify(data, null, 2)}`;
        
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

    const prompt = `
    Ты — профессиональный бухгалтерский AI. Твоя задача — оцифровать чек с изображения.
    
    ВХОДНЫЕ ДАННЫЕ:
    1. Список доступных категорий пользователя: [${categoriesStr}].
    
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
    `;

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
   generateMorningBriefing 
};

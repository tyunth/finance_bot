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

--- АНАЛИЗ ДАННЫХ (Твои мысли) ---
1. Проанализируй расписание САМ. Не смотри только на количество.
   - Если видишь слова "Экзамен", "Зачет", "КР" — день ВАЖНЫЙ и ответственный, даже если событие всего одно. Никакого "чила".
   - Если уроков много (4+) — день загруженный/плотный.
   - Если уроков мало (1-2) и нет экзаменов — день легкий/лайтовый.
   - Если подряд идет один и тот же ученик — отметь это.
2. Оцени задачи:
   - Есть ли "висяки" (>3 дней)?
   - Много ли срочных?

--- СТРУКТУРА ОТВЕТА ---

👋 **Приветствие** (1 короткая фраза)

🌡 **Погода:**
Коротко: динамика температуры (утро -> вечер) и осадки. Без лишних слов.

🎓 **Расписание:**
*Сначала напиши жирным саммари нагрузки.* (Например: "**Сегодня плотно: 4 урока и экзамен, держись.**" или "**Всего 1 урок, можно выдохнуть.**").
Далее список:
- Время: Название

📝 **Задачи:**
Разбей список на группы (если в группе есть задачи). Используй именно эти заголовки:
*🔥 Срочно:*
- [Задача]
*⚡ Средне:*
- [Задача]
*⏳ Позже:*
- [Задача]

*Важно:*
- Если задача висит > 3 дней — добавь в конце строки: (висит N дн.)
- Если > 7 дней — добавь эмодзи 🗿 или 💀.

💡 **Напутствие:** ОДНО предложение. Никаких советов про "регулярное выполнение". 
Просто пожелай удачи на конкретном экзамене (если есть) или хороших уроков(если они есть). 

--- ПРАВИЛА ОФОРМЛЕНИЯ ---
1. НЕ используй жирный шрифт внутри пунктов (только заголовки).
2. Списки строго вертикальные.
3. Не пиши вступлений типа "Вот ваша сводка". Сразу к делу.
4. Минимально используй эмодзи
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

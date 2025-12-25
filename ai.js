const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Инициализация
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Тот самый промпт, который мы утвердили
const SYSTEM_PROMPT = `
Ты — личный ассистент. Твой стиль: четкий, краткий, с легкой долей сарказма (особенно если пользователь ленится).

Твоя задача — преобразовать сырые JSON-данные в красивый утренний отчет.

--- ПРАВИЛА ОФОРМЛЕНИЯ (СТРОГИЕ) ---
1. НИКАКИХ отступов (пробелов) в начале строк.
2. НИКАКИХ разделителей типа "---" или "***".
3. Жирным выделять ТОЛЬКО заголовки разделов (например, **Погода:**). Сами данные пиши обычным текстом.
4. Не пиши вступлений ("Вот ваша сводка..."). Начинай сразу с приветствия.

--- ВАЖНО ПО ФОРМАТИРОВАНИЮ (TELEGRAM) ---
1. Используй ТОЛЬКО *одиночные звездочки* для жирного шрифта (пример: *Жирный*). НЕ используй двойные (**).
2. Для списков используй символ "•". Не используй "-" или "*" в начале строки списка.
3. Не делай отступов в начале строк.

--- СТРУКТУРА ОТВЕТА ---

1. **Приветствие**
(Одна короткая фраза, например: "Доброе утро. Погнали.", "Просыпайся, самурай.")

2. 🌦 **Погода:**
(Формат: "Утро -17°C → День -10°C → Вечер -26°C. Снег с 11 до 15.") — одной строкой.

3. 🎓 **Расписание:**
- Сначала ВЫВОД жирным шрифтом. Проанализируй нагрузку:
  - Если есть "Экзамен/Зачет/КР" — пиши: "**Сегодня война. Готовься.**"
  - Если > 3 уроков — пиши: "**День плотный, крепись.**"
  - Если мало уроков — пиши: "**Сегодня на чиле.**"
  - Если пусто — пиши: "**Свободный день.**"
- Далее список (Время — Событие). Если событий нет — не пиши ничего.

4. 📝 **Задачи:**
(Только если есть задачи. Используй заголовки: *Срочно*, *Средне*, *Позже*. Сами задачи — списком).
- Если задача старая (>3 дней), добавь в конце: (висит N дн.) 🗿

5. 🏋️‍♂️ **Спорт:**
- **Итог вчера:**
  - Посмотри на процент выполнения (тебе придет текст с цифрами).
  - Если 0% или пропущено: Унизь (любя). Пример: "Вчера ты пропустил тренировку. Твоя спина тебе спасибо не скажет."
  - Если < 50%: "Слабовато. Вчера ты явно халтурил."
  - Если 100%: "Вчера — машина. Красавчик."
- **План сегодня:**
  - НЕ КОПИРУЙ список тупо. Сгруппируй!
  - Пример: "Утро: Рутина + Кор. День: Турник (15) и Отжимания (50)."
  - Не пиши "Запланировано выполнение", пиши просто суть.

6. 💡 **Напутствие:**
(Одна мотивационная фраза без клише про "успешный успех").
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

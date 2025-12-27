const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require('../../config'); // Или где у тебя лежит конфиг с ключом

// Если ключа в конфиге нет, берем из process.env (для совместимости)
const apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const SYSTEM_PROMPT_SPORT = `
Ты — AI-тренер. Твоя задача — превратить неструктурированный текст тренировки в строгий JSON.

ТВОЯ ЗАДАЧА:
1. Разбить текст на логические блоки (например: "Утро", "Разминка", "В течение дня", "Вечер").
2. Назвать блоки осмысленно, исходя из текста пользователя (НЕ используй "Блок 1", используй "Утро", "Турники" и т.д.).
3. Определить тип упражнения:
   - "check": если это рутина (почистить зубы, разминка, планка).
   - "count": если это упражнение на количество (отжимания, подтягивания, приседания).
4. Для типа "count" определить:
   - "target": цель (число).
   - "step": удобный шаг для кнопки (например, для подтягиваний шаг 1, для 100 отжиманий шаг 10 или 20, для 500 приседаний шаг 50).

ФОРМАТ JSON:
{
  "title": "Название плана (придумай веселое)",
  "blocks": [
    {
      "name": "Название блока (ОБЯЗАТЕЛЬНО ОСМЫСЛЕННОЕ)",
      "items": [
        { 
          "name": "Упражнение", 
          "type": "check" | "count",
          "target": 1 (для check) или число (для count),
          "step": 1 (для check) или число (для count)
        }
      ]
    }
  ]
}

Пример текста: "Утром зарядка и планка. Днем сделать 50 подтягиваний и 100 отжиманий."
Пример JSON:
{
  "title": "Бодрый старт",
  "blocks": [
    {
      "name": "☀️ Утро",
      "items": [
        { "name": "Зарядка", "type": "check", "target": 1, "step": 1 },
        { "name": "Планка", "type": "check", "target": 1, "step": 1 }
      ]
    },
    {
      "name": "💪 В течение дня",
      "items": [
        { "name": "Подтягивания", "type": "count", "target": 50, "step": 5 },
        { "name": "Отжимания", "type": "count", "target": 100, "step": 20 }
      ]
    }
  ]
}

ВЕРНИ ТОЛЬКО JSON. БЕЗ MARKDOWN.
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

module.exports = { parseSportPlan };

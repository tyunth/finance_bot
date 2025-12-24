const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Инициализация
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Тот самый промпт, который мы утвердили
const SYSTEM_PROMPT = `
Ты — умный личный ассистент по управлению временем.
Твоя задача: проанализировать текущую ситуацию (погоду, расписание, список дел) и составить краткую сводку для пользователя на сегодня.

Входящие данные придут в формате JSON.

Правила:
1. Тон: Спокойный, уверенный, слегка неформальный (как опытный коллега). Без лишней официальности, но и без панибратства.
2. Структура: Сначала самое важное (экстремальная погода или важные встречи), потом остальное.
3. Анализ:
   - Если погода плохая — посоветуй одежду.
   - Если расписание плотное — посоветуй сфокусироваться.
   - Если задач нет — порадуйся за пользователя.
4. Форматирование: Используй Markdown (жирный шрифт, списки), чтобы текст легко читался.
5. Эмодзи: Используй умеренно, только для контекста.
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

module.exports = { generateMorningBriefing };

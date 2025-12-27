const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
   - *Сегодня:* По плану: {Перечисли названия блоков, если есть}. Подробнее по команде /sport"!
6. 💡 **Мысль дня:** (1 мотивационная фраза).

НЕ ИСПОЛЬЗУЙ markdown заголовки (#), только жирный текст (**).
`;

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
        console.error("AI Briefing Error:", error);
        return "⚠️ Сбой AI. Данные недоступны.";
    }
}

async function generateEnglishWord() {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        generationConfig: { responseMimeType: "application/json" } 
    });

    try {
        const result = await model.generateContent(SYSTEM_PROMPT_ENGLISH);
        return JSON.parse(result.response.text());
    } catch (error) {
        console.error("AI English Error:", error);
        return null;
    }
}

module.exports = { 
   generateMorningBriefing,
   generateEnglishWord,
};

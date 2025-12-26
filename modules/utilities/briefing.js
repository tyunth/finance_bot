const axios = require('axios');
const db = require('../../db');
const ai = require('../../ai');
const sport = require('../../sport');

async function sendMorningBriefing(bot, chatId) {
    try {
        // --- 1. SOFT DELETE (АВТО-ЧИСТКА) ---
        // Помечаем все выполненные задачи (is_done=1) как удаленные, чтобы очистить список
        const now = new Date().toISOString();
        await db.dbRun('UPDATE todos SET deleted_at = ? WHERE is_done = 1 AND deleted_at IS NULL', [now]);
        console.log('✅ Выполненные задачи архивированы');

        // --- 2. СБОР ДАННЫХ ---
        const dataContext = {
            weather: null,
            calendar: [],
            todos: [],
            sport: { yesterday: null, today: null }
        };

        // 1. Погода
        try {
            const wRes = await axios.get('https://api.open-meteo.com/v1/forecast?latitude=54.87&longitude=69.14&hourly=temperature_2m,precipitation&timezone=auto');
            const h = wRes.data.hourly;
            dataContext.weather = { morning: h.temperature_2m[8], day: h.temperature_2m[14], is_snow: h.precipitation.slice(0, 24).reduce((a,b)=>a+b,0) > 0.5 };
        } catch(e) {}

        // 2. Спорт
        try {
            dataContext.sport.yesterday = await sport.getDailySummary(chatId, -1);
            const today = await sport.getDailySummary(chatId, 0);
            dataContext.sport.todayBlocks = today ? today.blocks : [];
        } catch(e) {}

        // 3. English
        const word = await ai.generateEnglishWord();
        if (word) await db.addEnglishWord(chatId, word);

        // Генерация
        const text = await ai.generateMorningBriefing(
            dataContext.weather, 
            [], 
            [], 
            dataContext.sport.yesterday,
            dataContext.sport.todayBlocks,
            word
        );

        if (text) {
            const safeText = text.replace(/\*\*/g, '*').replace(/__/g, '_');
            await bot.telegram.sendMessage(chatId, safeText, { parse_mode: 'Markdown' });
        }
    } catch (e) { console.error('Morning Briefing Error:', e); }
}

module.exports = { sendMorningBriefing };

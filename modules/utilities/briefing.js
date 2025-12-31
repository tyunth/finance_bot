const axios = require('axios');
const db = require('../../db');
const ai = require('./utilities.ai');
const sport = require('../sport/sport.service');

async function sendMorningBriefing(bot, chatId) {
    try {
        // --- 1. SOFT DELETE (АВТО-ЧИСТКА) ---
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
            const yesterdaySummary = await sport.getDailySummary(chatId, -1);
            const todaySummary = await sport.getDailySummary(chatId, 0);
            
            dataContext.sport.yesterday = yesterdaySummary;
            dataContext.sport.todayBlocks = todaySummary ? todaySummary.blocks : [];
        } catch(e) { console.error('Ошибка спорта:', e.message); }

        // 3. English
        const word = await ai.generateEnglishWord();
        if (word) await db.addEnglishWord(chatId, word);

        // --- 3. ГЕНЕРАЦИЯ ТЕКСТА ---
        const text = await ai.generateMorningBriefing(
            dataContext.weather, 
            [], 
            [], 
            dataContext.sport.yesterday,
            dataContext.sport.todayBlocks,
            word
        );

        if (text) {
            // 🔥 ЛЕЧЕНИЕ MARKDOWN (Legacy Mode)
            // AI часто выдает `**bold**`, а Legacy Markdown понимает только `*bold*`.
            // Также AI делает списки через `* Пункт`, что конфликтует с жирным текстом.
            
            let safeText = text
                .replace(/\*\*/g, '*')       // Меняем двойные звезды на одинарные
                .replace(/__/g, '_')         // Меняем двойное подчеркивание на одинарное
                .replace(/^\s*\*\s/gm, '• ') // 🔥 ГЛАВНОЕ: Меняем маркеры списка "*" на точки "•", чтобы не путать парсер
                .replace(/\n\*/g, '\n•');    // На всякий случай еще раз меняем звезды в начале строк

            // Попытка отправить красиво
            try {
                await bot.telegram.sendMessage(chatId, safeText, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('⚠️ Ошибка Markdown в сводке, отправляю простой текст:', err.message);
                
                // 🔥 ФОЛЛБЭК: Если красивое сообщение не прошло — отправляем чистый текст.
                // Лучше некрасивая сводка, чем никакой.
                await bot.telegram.sendMessage(chatId, safeText); 
            }
        }
    } catch (e) { console.error('Morning Briefing Error:', e); }
}

module.exports = { sendMorningBriefing };

const cron = require('node-cron');
const axios = require('axios');
const db = require('../db');
const config = require('../config');
const ai = require('../ai');      
const gcal = require('../calendar');
const sport = require('../sport');

module.exports = (bot) => {
    console.log('⏰ Cron Manager v2 initialized');

    // 1. Утренняя сводка (02:00 UTC или твое время)
    cron.schedule('0 2 * * *', async () => {
        await runDailyBackup(bot);
        await new Promise(r => setTimeout(r, 3000));
        await sendMorningBriefing(bot, config.ADMIN_ID);
    });

    // 2. Вечерний спорт
    cron.schedule('0 15 * * *', async () => {
        bot.telegram.sendMessage(config.ADMIN_ID, '🔔 **Вечерний спорт-чек!**', 
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💪 Открыть', callback_data: 'sport_refresh' }]] } }
        ).catch(e => console.error(e));
    });

    // 3. Поллинг календаря (каждый час)
    setInterval(async () => {
        await runCalendarCheck(bot);
        // await runMonthlyInterestCheck(bot); // Если нужно
    }, 60 * 60 * 1000);
};

// --- ФУНКЦИИ ЛОГИКИ ---

async function runDailyBackup(bot) {
    try {
        await bot.telegram.sendDocument(config.ADMIN_ID, { 
            source: db.DB_PATH, 
            filename: `backup_${new Date().toISOString().split('T')[0]}.db` 
        });
    } catch (e) { console.error('Backup fail:', e); }
}

async function runCalendarCheck(bot) {
    try {
        // Передаем логгер-функцию
        const events = await gcal.getRecentLessons((msg) => console.log('GCal Log:', msg));
        if (!events.length) return;

        const students = await db.getStudents(config.ADMIN_ID);
        const names = students.map(s => s.name);
        const keywords = [...names, 'Тест', 'Пробный', 'Урок'];

        for (const event of events) {
            const processed = await db.isEventProcessed(event.id);
            if (processed) continue;

            const isRelevant = keywords.some(k => event.summary.toLowerCase().includes(k.toLowerCase()));
            if (!isRelevant) continue;

            const { studentName, subject } = gcal.parseLessonInfo(event.summary);
            
            await bot.telegram.sendMessage(config.ADMIN_ID, 
                `🔔 *Урок завершен:*\n${event.summary}\n👤 ${studentName}\n📚 ${subject}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: `💰 Оплачен (+${config.LESSON_PRICE})`, callback_data: `cal_paid_${event.id}` }],
                        [{ text: `📝 В долг`, callback_data: `cal_debt_${event.id}` }],
                        [{ text: `❌ Отмена/Удалить`, callback_data: `cal_cancel_menu_${event.id}` }]
                    ]}
                }
            );
            // Помечаем как pending, чтобы не спамить
            await db.markEventProcessed(event.id, event.summary, 'pending');
        }
    } catch (e) { console.error('Calendar Poll Error:', e.message); }
}

async function sendMorningBriefing(bot, chatId) {
    try {
        // Сбор данных как в старом боте
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

        // 3. English word
        const word = await ai.generateEnglishWord();
        if (word) await db.addEnglishWord(chatId, word);

        // Генерация текста
        const text = await ai.generateMorningBriefing(
            dataContext.weather, 
            [], // calendar (можно подключить gcal.getEventsForDate)
            [], // todos
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

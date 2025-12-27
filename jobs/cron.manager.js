const cron = require('node-cron');
const axios = require('axios');
const db = require('../db');
const config = require('../config');
// const ai = require('../ai');      
const calendar = require('../modules/calendar/calendar.service');
const sport = require('../modules/sport/sport.service');
const calendarService = require('../modules/calendar/calendar.service');
const { sendMorningBriefing } = require('../modules/utilities/briefing.js');

module.exports = (bot) => {
    console.log('⏰ Cron Manager initialized');

    // 1. Утренняя сводка (02:00 UTC)
    cron.schedule('0 2 * * *', async () => {
        await runDailyBackup(bot);
        await new Promise(r => setTimeout(r, 3000));
        await sendMorningBriefing(bot, config.ADMIN_ID);
    });

    // 2. Вечерний спорт (15:00 UTC)
    cron.schedule('0 15 * * *', async () => {
        bot.telegram.sendMessage(config.ADMIN_ID, '🔔 **Вечерний спорт-чек!**', 
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💪 Открыть', callback_data: 'sport_refresh' }]] } }
        ).catch(e => console.error(e));
    });

    // 3. Поллинг календаря (раз в час)
        setInterval(async () => {
        // Передаем bot, чтобы сервис мог отправлять сообщения
        await calendarService.checkLessons(bot, config.ADMIN_ID);
    }, 60 * 60 * 1000);
};

// --- ФУНКЦИИ ---

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
        // Передаем колбэк для логов
        const events = await gcal.getRecentLessons((msg) => console.log('GCal:', msg));
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
            // Помечаем как pending
            await db.markEventProcessed(event.id, event.summary, 'pending');
        }
    } catch (e) { console.error('Calendar Poll Error:', e.message); }
}

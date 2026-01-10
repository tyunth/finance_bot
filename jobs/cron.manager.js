const cron = require('node-cron');
const db = require('../db');
const config = require('../config');

// Подключаем модули
const calendarService = require('../modules/calendar/calendar.service');
const sportService = require('../modules/sport/sport.service');
const { sendMorningBriefing } = require('../modules/utilities/briefing.js');

module.exports = (bot) => {
    console.log('⏰ Cron Manager initialized');

    // 1. Утренняя сводка (02:00 UTC = 07:00/08:00 Local)
    cron.schedule('0 2 * * *', async () => {
        await runDailyBackup(bot);
        // Ждем 3 сек, чтобы бэкап успел отправиться
        await new Promise(r => setTimeout(r, 3000));
        await sendMorningBriefing(bot, config.ADMIN_ID);
    });

    // 2. Вечерний спорт (15:00 UTC = 20:00/21:00 Local)
    cron.schedule('0 15 * * *', async () => {
        // 🔥 Теперь вызываем умную проверку из сервиса
        await sportService.processEveningReminders(bot);
    });

    // 3. Поллинг календаря (каждый час)
    setInterval(async () => {
        // Проверяем уроки для админа (или можно переделать под всех)
        await calendarService.checkLessons(bot, config.ADMIN_ID);
    }, 60 * 60 * 1000);

    // 4. Проверка практики в 12:00 UTC и вопрос о добирании
    cron.schedule('0 12 * * *', async () => {
        await calendarService.checkPracticeAndAsk(bot, config.ADMIN_ID);
    });
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

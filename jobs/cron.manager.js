// jobs/cron.manager.js
const cron = require('node-cron');
const db = require('../db');
const config = require('../config');
const ai = require('../ai');      // Убедись, что ai.js есть в корне
const gcal = require('../calendar'); // Убедись, что calendar.js есть в корне
const sport = require('../sport');   // Убедись, что sport.js есть в корне

module.exports = (bot) => {
    console.log('⏰ Cron Manager initialized');

    // 1. Утренний бэкап и сводка (02:00)
    cron.schedule('0 2 * * *', async () => {
        console.log('Running Morning Tasks...');
        
        // Бэкап базы
        try {
            await bot.telegram.sendDocument(config.ADMIN_ID, { 
                source: db.DB_PATH, 
                filename: `backup_${new Date().toISOString().split('T')[0]}.db` 
            }, { caption: '💾 Ночной бэкап' });
        } catch (e) { console.error('Backup error:', e); }

        // Пауза 3 сек
        await new Promise(r => setTimeout(r, 3000));

        // AI Сводка (вызываем твою логику генерации)
        // Тут нужно убедиться, что функция sendMorningBriefing экспортируема или перенести её сюда.
        // Для простоты пока оставим заглушку или перенеси логику sendMorningBriefing сюда.
        // await sendMorningBriefing(bot, config.ADMIN_ID); 
    });

    // 2. Вечерний спорт-чек (15:00 UTC / 20:00 Местного)
    cron.schedule('0 15 * * *', async () => {
        try {
            await bot.telegram.sendMessage(config.ADMIN_ID, 
                '🔔 **Вечерний спорт-чек!**\nОтметь выполненное:',
                { reply_markup: { inline_keyboard: [[{ text: '💪 Открыть', callback_data: 'sport_refresh' }]] } }
            );
        } catch (e) { console.error('Evening Cron Error:', e); }
    });

    // 3. Воскресенье: План на неделю
    cron.schedule('5 15 * * 0', async () => {
        try {
            await bot.telegram.sendMessage(config.ADMIN_ID,
                '📅 **Конец недели!**\nЗагрузи новый план тренировок.',
                { reply_markup: { inline_keyboard: [[{ text: '⚙️ Загрузить план', callback_data: 'sport_new' }]] } }
            );
        } catch (e) { console.error('Sunday Cron Error:', e); }
    });

    // 4. Ежечасные проверки (Календарь + Проценты)
    setInterval(async () => {
        // Тут твоя логика runCalendarCheck и runMonthlyInterestCheck
        // Лучше их тоже вынести в сервисы, но пока можно оставить в bot.js или перенести сюда позже.
    }, 60 * 60 * 1000);
};

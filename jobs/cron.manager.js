const cron = require('node-cron');
const db = require('../db');
const config = require('../config');

// Подключаем модули
const calendarService = require('../modules/calendar/calendar.service');
const sportService = require('../modules/sport/sport.service');
const { sendMorningBriefing } = require('../modules/utilities/briefing.js');
const { sendEveningReminder, uploadBlackVideo } = require('../modules/media/1se.bot');

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

    // 5. Вечернее напоминание о видео (16:00 UTC = 21:00/22:00 Local)
    cron.schedule('0 16 * * *', async () => {
        await processEveningVideoReminders(bot);
    });

    // 6. Автоматическая загрузка черного видео (19:00 UTC = 00:00/00:00 Local)
    cron.schedule('0 19 * * *', async () => {
        await processAutomaticBlackVideoUpload(bot);
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

// Обработка вечерних напоминаний о видео
async function processEveningVideoReminders(bot) {
    console.log('🎬 Проверка вечернего напоминания о видео...');
    
    // Берем всех пользователей из базы
    const users = await db.dbAll('SELECT * FROM users');

    for (const user of users) {
        // 1. Проверяем права (modules string: "finance,sport,media" или "all")
        const modules = (user.modules || '').split(',');
        // Если медиа нет в модулях И пользователь не админ
        if (!modules.includes('media') && !modules.includes('all') && user.role !== 'admin') {
            continue;
        }

        // 2. Отправляем напоминание
        try {
            await sendEveningReminder(bot, user.telegram_id);
        } catch (e) {
            console.error(`Не удалось отправить напоминание юзеру ${user.telegram_id}:`, e.message);
        }
    }
}

// Автоматическая загрузка черного видео
async function processAutomaticBlackVideoUpload(bot) {
    console.log('⚫ Проверка автоматической загрузки черного видео...');
    
    // Берем всех пользователей из базы
    const users = await db.dbAll('SELECT * FROM users');

    for (const user of users) {
        // 1. Проверяем права (modules string: "finance,sport,media" или "all")
        const modules = (user.modules || '').split(',');
        // Если медиа нет в модулях И пользователь не админ
        if (!modules.includes('media') && !modules.includes('all') && user.role !== 'admin') {
            continue;
        }

        // 2. Проверяем, есть ли видео за сегодня
        const hasVideo = await checkVideoForToday(user.telegram_id);
        
        if (!hasVideo) {
            // 3. Загружаем черное видео
            try {
                const result = await uploadBlackVideo(user.telegram_id);
                if (result) {
                    console.log(`⚫ Черное видео загружено для пользователя ${user.telegram_id}`);
                }
            } catch (e) {
                console.error(`Ошибка загрузки черного видео для юзера ${user.telegram_id}:`, e.message);
            }
        }
    }
}

// Проверка, есть ли видео за сегодня у пользователя (копия из 1se.bot.js)
async function checkVideoForToday(userId) {
    const today = new Date().toISOString().split('T')[0];
    const row = await db.dbGet(
        'SELECT id FROM one_second_videos WHERE user_id = ? AND date = ? AND is_automatic = 0',
        [userId, today]
    );
    return !!row; // true если есть реальное видео, false если нет
}

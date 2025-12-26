const { Composer } = require('telegraf');
const sport = require('../../sport'); // Подключаем твой sport.js из корня
const db = require('../../db');

const bot = new Composer();

// Middleware для проверки доступа к модулю
const checkAccess = async (ctx, next) => {
    const modules = await db.getUserModules(ctx.from.id);
    if (modules.includes('all') || modules.includes('sport')) return next();
    return ctx.reply('⛔ Модуль "Спорт" отключен.');
};

// Команды
bot.command('sport', checkAccess, (ctx) => sport.renderMainMenu(ctx));
bot.hears('💪 Спорт', checkAccess, (ctx) => sport.renderMainMenu(ctx));

// Обработка всех callback-ов, начинающихся на sport_
bot.action(/^sport_/, (ctx) => sport.handleCallback(ctx));

// Загрузка плана (если бот ждет файл)
bot.on('document', async (ctx, next) => {
    if (ctx.session.state && ctx.session.state.step === 'AWAITING_SPORT_PLAN') {
        return sport.handlePlanUpload(ctx);
    }
    return next();
});

module.exports = bot;

const { Composer } = require('telegraf');
// 🔥 ВАЖНО: Подключаем сервис, который лежит РЯДОМ в этой же папке
const sportService = require('./sport.service'); 
const db = require('../../db');

const bot = new Composer();

// Middleware проверки доступа
const checkAccess = async (ctx, next) => {
    const modules = await db.getUserModules(ctx.from.id);
    if (modules.includes('all') || modules.includes('sport')) return next();
    return ctx.reply('⛔ Модуль "Спорт" отключен.');
};

// Команды
// Обращаемся к sportService, а не sport
bot.command('sport', checkAccess, (ctx) => sportService.renderMainMenu(ctx));
bot.hears('💪 Спорт', checkAccess, (ctx) => sportService.renderMainMenu(ctx));

// Обработка всех callback-ов, начинающихся на sport_
bot.action(/^sport_/, (ctx) => sportService.handleCallback(ctx));

// Обработка текста (для загрузки плана и дат выходных)
bot.on('text', async (ctx, next) => {
    if (ctx.session.state && ctx.session.state.step === 'AWAITING_SPORT_PLAN') {
        return sportService.handlePlanUpload(ctx);
    }
    if (ctx.session.state && ctx.session.state.step === 'AWAITING_REST_DATE') {
        return sportService.handleRestDateInput(ctx);
    }
    return next();
});

module.exports = bot;

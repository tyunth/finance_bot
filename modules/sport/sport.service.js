const { Composer } = require('telegraf');
const sportService = require('./sport.service'); // Теперь подключаем локальный сервис
const db = require('../../db');

const bot = new Composer();

const checkAccess = async (ctx, next) => {
    const modules = await db.getUserModules(ctx.from.id);
    if (modules.includes('all') || modules.includes('sport')) return next();
    return ctx.reply('⛔ Модуль "Спорт" отключен.');
};

bot.command('sport', checkAccess, (ctx) => sportService.renderMainMenu(ctx));
bot.hears('💪 Спорт', checkAccess, (ctx) => sportService.renderMainMenu(ctx));

// Регулярка ловит: sport_new, sport_refresh, sport_inc_..., sport_done_...
bot.action(/^sport_/, (ctx) => sportService.handleCallback(ctx));

bot.on('text', async (ctx, next) => {
    if (ctx.session.state && ctx.session.state.step === 'AWAITING_SPORT_PLAN') {
        return sportService.handlePlanUpload(ctx);
    }
    return next();
});

module.exports = bot;

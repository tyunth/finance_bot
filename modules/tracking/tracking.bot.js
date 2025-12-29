const { Composer } = require('telegraf');
const trackingService = require('./tracking.service');
const db = require('../../db');

const bot = new Composer();

// Меню
bot.hears(['📦 Посылки', '/track'], async (ctx) => {
    await trackingService.renderMainMenu(ctx);
});

// Команда быстрого добавления: /track XX123YY Описание
bot.command('track', async (ctx) => {
    const text = ctx.message.text.replace('/track', '').trim();
    if (!text) return trackingService.renderMainMenu(ctx);
    
    // Эмуляция загрузки, если ввели текст сразу
    ctx.message.text = text;
    await trackingService.handleTrackUpload(ctx);
});

// Callback
bot.action(/^track_/, (ctx) => trackingService.handleCallback(ctx));

// Текст (если ждем ввод)
bot.on('text', async (ctx, next) => {
    if (ctx.session.state && ctx.session.state.step === 'AWAITING_TRACK') {
        return trackingService.handleTrackUpload(ctx);
    }
    return next();
});

module.exports = bot;

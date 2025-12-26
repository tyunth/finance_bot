const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config');
const exporter = require('../../export_service'); 
const { sendMorningBriefing } = require('../../utilities/briefing');
const bot = new Composer();

// ... (оставляем старый код users/sql, если он нужен) ...

// Команда EXPORT
bot.command('export', async (ctx) => {
    const userId = ctx.from.id;
    // Если админ - даем выбор
    if (userId.toString() === config.ADMIN_ID.toString()) {
        await ctx.reply('Что выгрузить?', Markup.inlineKeyboard([
            [Markup.button.callback('💾 Полная база (.db)', 'export_admin_db')],
            [Markup.button.callback('📊 Мой Excel (.xlsx)', 'export_my_excel')]
        ]));
    } else {
        // Обычный юзер - только Excel
        await sendUserExcel(ctx, userId);
    }
});

bot.action('export_admin_db', async (ctx) => {
    if (ctx.from.id.toString() !== config.ADMIN_ID.toString()) return;
    await ctx.replyWithDocument({ source: db.DB_PATH, filename: 'finance.db' });
    await ctx.answerCbQuery();
});

bot.action('export_my_excel', async (ctx) => {
    await sendUserExcel(ctx, ctx.from.id);
    await ctx.answerCbQuery();
});

async function sendUserExcel(ctx, userId) {
    const msg = await ctx.reply('⏳ Генерирую отчет...');
    try {
        const buffer = await exporter.generateUserExcel(userId);
        const dateStr = new Date().toISOString().split('T')[0];
        await ctx.replyWithDocument({ source: buffer, filename: `Finance_${dateStr}.xlsx` });
        await ctx.deleteMessage(msg.message_id);
    } catch (e) {
        ctx.editMessageText('Ошибка экспорта: ' + e.message);
    }
}

module.exports = bot;

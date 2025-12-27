const { Composer, Markup } = require('telegraf');
const calendarService = require('./calendar.service'); // Локальный сервис

const bot = new Composer();

// Хелпер: достает текст заголовка из сообщения бота
function getSummaryFromMsg(ctx) {
    if (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.text) {
        const lines = ctx.callbackQuery.message.text.split('\n');
        // Сообщение выглядит так: "🔔 *Урок завершен:*\nЗаголовок..."
        // Берем вторую строку
        if (lines.length > 1) return lines[1];
    }
    return 'Урок';
}

// Команда /sync
bot.command('sync', async (ctx) => {
    const msg = await ctx.reply('🔄 Проверяю календарь...');
    const result = await calendarService.checkLessons(ctx, ctx.from.id);
    
    await ctx.telegram.editMessageText(
        ctx.chat.id, 
        msg.message_id, 
        null, 
        result.count > 0 ? `✅ Проверка завершена. ${result.message}` : '🔕 Новых уроков не найдено.'
    );
});

// 1. Оплачено
bot.action(/^cal_paid_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const summary = getSummaryFromMsg(ctx);
    
    const studentName = await calendarService.processPayment(ctx.from.id, eventId, summary);
    await ctx.editMessageText(`💰 Оплачено: ${studentName}`);
});

// 2. В Долги
bot.action(/^cal_debt_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const summary = getSummaryFromMsg(ctx);

    const studentName = await calendarService.processDebt(ctx.from.id, eventId, summary);
    await ctx.editMessageText(`📝 Записано в долги: ${studentName}`);
});

// 3. Меню отмены
bot.action(/^cal_cancel_menu_(.+)$/, (ctx) => {
    const eventId = ctx.match[1];
    ctx.editMessageText('Причина отмены?', Markup.inlineKeyboard([
        [Markup.button.callback('Согласовано', `cal_cx_agreed_${eventId}`)],
        [Markup.button.callback('Я отменил', `cal_cx_teacher_${eventId}`)],
        [Markup.button.callback('Ученик отменил', `cal_cx_student_${eventId}`)],
        [Markup.button.callback('🔙 Назад', `cal_ignore`)]
    ]));
});

// 4. Фиксация отмены
bot.action(/^cal_cx_([a-z]+)_(.+)$/, async (ctx) => {
    const reason = ctx.match[1];
    const eventId = ctx.match[2];
    const summary = getSummaryFromMsg(ctx);

    await calendarService.processCancellation(ctx.from.id, eventId, summary, reason);
    await ctx.editMessageText(`✅ Отмена записана (${reason}). Событие удалено.`);
});

bot.action('cal_ignore', (ctx) => ctx.deleteMessage());

module.exports = bot;

const { Composer, Markup } = require('telegraf');
const db = require('../../db');

const bot = new Composer();

// Меню учеников
bot.hears(['🎓 Ученики', '/students'], async (ctx) => {
    const students = await db.getStudents(ctx.from.id);
    if (!students.length) return ctx.reply('Список учеников пуст.');

    const buttons = students.map(s => [Markup.button.callback(s.name, `show_student_${s.id}`)]);
    ctx.reply('👨‍🎓 Ваши ученики:', Markup.inlineKeyboard(buttons));
});

// Долги
bot.hears(['/debts', 'Долги'], async (ctx) => {
    const debts = await db.getDebts(ctx.from.id);
    if (!debts.length) return ctx.reply('🎉 Долгов нет!');

    let msg = '*🚩 Неоплаченные занятия:*\n';
    const buttons = debts.map(d => [
        Markup.button.callback(`💰 Оплатить (${d.amount})`, `pay_debt_${d.id}`)
    ]);

    debts.forEach(d => {
        msg += `\n• ${d.student_name}: ${d.amount} (${d.subject})`;
    });

    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

// Callback: Показать ученика
bot.action(/^show_student_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    const s = await db.dbGet('SELECT * FROM students WHERE id = ?', [id]);
    if (!s) return ctx.answerCbQuery('Не найден');

    await ctx.reply(
        `👤 *${s.name}*\n📚 Предмет: ${s.subject}\n💰 Цена урока: ${s.price || 4000} KZT\n📞 Тел: ${s.phone || '-'}\n📍 Адрес: ${s.address || '-'}\n📝 Заметки: ${s.notes || '-'}`,
        { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
});

// Callback: Оплатить долг
bot.action(/^pay_debt_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    try {
        await db.payDebt(id);
        await ctx.editMessageText('✅ Долг отмечен как оплаченный.');
    } catch (e) {
        await ctx.answerCbQuery('Ошибка оплаты');
    }
});

module.exports = bot;

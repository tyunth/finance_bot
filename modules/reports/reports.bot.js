const { Composer } = require('telegraf');
const db = require('../../db');
const config = require('../../config');

const bot = new Composer();

// Хелпер для форматирования
const formatAmount = (val) => new Intl.NumberFormat('ru-RU').format(val) + ' ' + config.CURRENCY;

// --- 1. ИСТОРИЯ (/latest) ---
bot.command(['latest', 'history'], async (ctx) => {
    const limit = 10;
    const rows = await db.dbAll(
        `SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`, 
        [ctx.from.id, limit]
    );

    if (!rows.length) return ctx.reply('📭 История пуста.');

    let msg = `📜 *Последние ${limit} операций:*\n`;
    rows.forEach(r => {
        const icon = r.type === 'income' ? '🟢' : '🔴';
        const date = r.date.split('T')[0];
        msg += `\n${icon} *${formatAmount(r.amount)}* — ${r.category}`;
        if (r.comment) msg += ` _(${r.comment})_`;
        msg += ` [${date}] /del_${r.id}`;
    });

    ctx.replyWithMarkdown(msg);
});

// --- 2. СТАТИСТИКА ЗА ПЕРИОД ---
async function sendStats(ctx, periodType) {
    const now = new Date();
    let start, end;
    let title;

    if (periodType === 'day') {
        const date = ctx.message.text.split(' ')[1] || now.toISOString().split('T')[0];
        start = date; end = date;
        title = `📅 Отчет за ${date}`;
    } else if (periodType === 'week') {
        const day = now.getDay() || 7; 
        if (day !== 1) now.setHours(-24 * (day - 1)); // Понедельник
        start = now.toISOString().split('T')[0];
        end = new Date().toISOString().split('T')[0];
        title = `📅 Отчет за неделю (${start} - ${end})`;
    } else if (periodType === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]; // 1 число
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]; // Последнее число
        title = `📅 Отчет за месяц (${new Date().toLocaleString('ru', { month: 'long' })})`;
    }

    // SQL запрос
    const rows = await db.dbAll(
        `SELECT category, type, SUM(amount) as total 
         FROM transactions 
         WHERE user_id = ? AND date >= ? AND date <= ? 
         GROUP BY category, type ORDER BY total DESC`,
        [ctx.from.id, start, end]
    );

    if (!rows.length) return ctx.reply(`${title}: Данных нет.`);

    let income = 0;
    let expense = 0;
    let msg = `*${title}*\n`;

    // Группируем
    const incomes = rows.filter(r => r.type === 'income');
    const expenses = rows.filter(r => r.type === 'expense');

    if (incomes.length) {
        msg += '\n📈 *Доходы:*';
        incomes.forEach(r => {
            income += r.total;
            msg += `\n• ${r.category}: ${Math.round(r.total)}`;
        });
    }

    if (expenses.length) {
        msg += '\n📉 *Расходы:*';
        expenses.forEach(r => {
            expense += r.total;
            msg += `\n• ${r.category}: ${Math.round(r.total)}`;
        });
    }

    const balance = income - expense;
    msg += `\n\n💰 *Сальдо:* ${formatAmount(balance)}`;

    ctx.replyWithMarkdown(msg);
}

bot.command('day', (ctx) => sendStats(ctx, 'day'));
bot.command('week', (ctx) => sendStats(ctx, 'week'));
bot.command('month', (ctx) => sendStats(ctx, 'month'));

// Удаление конкретной записи (по клику из /latest)
bot.hears(/^\/del_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.dbRun('DELETE FROM transactions WHERE id = ? AND user_id = ?', [id, ctx.from.id]);
    ctx.reply(`🗑 Запись #${id} удалена.`);
});

module.exports = bot;

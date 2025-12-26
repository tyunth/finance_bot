const { Composer } = require('telegraf');
const db = require('../../db');
const config = require('../../config');

const bot = new Composer();

bot.command('day', async (ctx) => {
    // Если дата не указана, берем сегодня
    let date = new Date().toISOString().split('T')[0];
    
    // Если указали /day 2023-10-01
    const args = ctx.message.text.split(' ');
    if (args[1]) date = args[1];

    const stats = await db.dbAll(
        `SELECT category, SUM(amount) as total, type 
         FROM transactions 
         WHERE user_id = ? AND date = ? 
         GROUP BY category, type`, 
        [ctx.from.id, date]
    );

    if (!stats.length) return ctx.reply(`📅 За ${date} записей нет.`);

    let income = 0;
    let expense = 0;
    let msg = `📅 *Отчет за ${date}*\n`;

    // Расходы
    const expRows = stats.filter(r => r.type === 'expense');
    if (expRows.length) {
        msg += '\n📉 *Расходы:*';
        expRows.forEach(r => {
            expense += r.total;
            msg += `\n• ${r.category}: ${Math.round(r.total)}`;
        });
    }

    // Доходы
    const incRows = stats.filter(r => r.type === 'income');
    if (incRows.length) {
        msg += '\n\n📈 *Доходы:*';
        incRows.forEach(r => {
            income += r.total;
            msg += `\n• ${r.category}: ${Math.round(r.total)}`;
        });
    }

    msg += `\n\n💰 *Итог:* ${income - expense} ${config.CURRENCY}`;
    ctx.replyWithMarkdown(msg);
});

module.exports = bot;

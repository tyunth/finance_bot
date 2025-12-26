const { Composer } = require('telegraf');
const db = require('../../db');
const config = require('../../config');

const bot = new Composer();

// Хелпер для форматирования
const formatAmount = (val) => new Intl.NumberFormat('ru-RU').format(val) + ' ' + config.CURRENCY;

// --- ИСТОРИЯ (/latest) ---
bot.command(['latest', 'history'], async (ctx) => {
    const limit = 10;
    const rows = await db.dbAll(
        `SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT ?`, 
        [ctx.from.id, limit]
    );

    if (!rows.length) return ctx.reply('📭 История пуста.');

    let msg = `📜 *Последние ${limit} операций:*\n`;
    rows.forEach(r => {
        let icon = '⚪️';
        if (r.type === 'income') icon = '🟢';
        if (r.type === 'expense') icon = '🔴';
        if (r.type === 'transfer') icon = '🔄';

        const date = r.date.split('T')[0]; // YYYY-MM-DD
        
        if (r.type === 'transfer') {
            msg += `\n${icon} *${formatAmount(r.amount)}* (${r.source_account} -> ${r.target_account})`;
        } else {
            msg += `\n${icon} *${formatAmount(r.amount)}* — ${r.category}`;
        }
        
        if (r.comment) msg += ` _(${r.comment})_`;
        msg += ` /del_${r.id}`;
    });

    ctx.replyWithMarkdown(msg);
});

// --- СТАТИСТИКА ЗА ПЕРИОД ---
async function sendStats(ctx, periodType) {
    const now = new Date();
    let start, end;
    let title;

    if (periodType === 'day') {
        // Если юзер ввел /day 2023-12-01
        const inputDate = ctx.message && ctx.message.text ? ctx.message.text.split(' ')[1] : null;
        const date = inputDate || now.toISOString().split('T')[0];
        start = date + 'T00:00:00'; 
        end = date + 'T23:59:59';
        title = `📅 Отчет за ${date}`;
    } else if (periodType === 'week') {
        const day = now.getDay() || 7; 
        const monday = new Date(now);
        monday.setHours(-24 * (day - 1));
        start = monday.toISOString().split('T')[0] + 'T00:00:00';
        end = now.toISOString().split('T')[0] + 'T23:59:59';
        title = `📅 Неделя (${start.split('T')[0]} - ${end.split('T')[0]})`;
    } else if (periodType === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0] + 'T00:00:00';
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0] + 'T23:59:59';
        title = `📅 Месяц (${new Date().toLocaleString('ru', { month: 'long' })})`;
    }

    // SQL запрос: Берем ВСЁ за этот период
    const rows = await db.dbAll(
        `SELECT category, type, amount 
         FROM transactions 
         WHERE user_id = ? AND date >= ? AND date <= ?`,
        [ctx.from.id, start, end]
    );

    if (!rows.length) return ctx.reply(`${title}: Данных нет.`);

    let income = 0;
    let expense = 0;
    const catStats = {}; // Для группировки расходов

    rows.forEach(r => {
        // --- ВАЖНАЯ ФИЛЬТРАЦИЯ ---
        if (r.type === 'transfer') return; // Переводы игнорим в статистике "трат" и "заработка"

        if (r.type === 'income') {
            // Игнорируем пополнения депозитов, если они записаны как income с категорией Депозит (старый стиль)
            // Но мы всё равно суммируем РЕАЛЬНЫЕ доходы
            if (r.category !== 'Депозит') { 
                income += r.amount;
            }
        } 
        else if (r.type === 'expense') {
            expense += r.amount;
            // Собираем стату по категориям
            catStats[r.category] = (catStats[r.category] || 0) + r.amount;
        }
    });

    let msg = `*${title}*\n`;
    
    // Сортировка категорий по убыванию
    const sortedCats = Object.entries(catStats).sort((a, b) => b[1] - a[1]);

    if (sortedCats.length > 0) {
        msg += '\n📉 *Расходы:*';
        sortedCats.forEach(([cat, amount]) => {
            msg += `\n• ${cat}: ${formatAmount(amount)}`;
        });
    }

    msg += `\n\n💵 *Доход:* ${formatAmount(income)}`;
    msg += `\n💸 *Расход:* ${formatAmount(expense)}`;
    msg += `\n💰 *Сальдо:* ${formatAmount(income - expense)}`;

    ctx.replyWithMarkdown(msg);
}

bot.command('day', (ctx) => sendStats(ctx, 'day'));
bot.command('week', (ctx) => sendStats(ctx, 'week'));
bot.command('month', (ctx) => sendStats(ctx, 'month'));

// Обработка кнопки "Отчет" из меню
bot.hears(['📊 Отчет', 'Отчет', 'Отчеты'], (ctx) => sendStats(ctx, 'month'));

module.exports = bot;

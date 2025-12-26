const { Composer } = require('telegraf');
const fs = require('fs');
const db = require('../../db');
const config = require('../../config');
const exporter = require('../../export_service');

const bot = new Composer();

// Middleware: пускаем только админа
bot.use(async (ctx, next) => {
    if (ctx.from.id.toString() !== config.ADMIN_ID.toString()) return; // Молча игнорим чужих
    return next();
});

// Команда: Скачать базу данных
bot.command('backup', async (ctx) => {
    try {
        await ctx.replyWithDocument({ source: './finance.db', filename: 'finance_backup.db' });
    } catch (e) {
        ctx.reply('Ошибка бэкапа: ' + e.message);
    }
});

// Команда: Список пользователей
bot.command('users', async (ctx) => {
    const users = await db.getAllUsers(); // Убедись, что такой метод есть в db.js (или dbAll('SELECT...'))
    let msg = '👥 *Пользователи:*\n';
    
    users.forEach(u => {
        msg += `\nID: \`${u.telegram_id}\` | ${u.first_name}`;
        msg += `\nRole: ${u.role} | Mod: ${u.modules || 'all'}\n`;
    });
    
    ctx.replyWithMarkdown(msg);
});

// Команда: SQL запрос (ОПАСНО, но удобно для дебага)
// Пример: /sql SELECT * FROM users
bot.command('sql', async (ctx) => {
    const query = ctx.message.text.replace('/sql', '').trim();
    if (!query) return ctx.reply('Пиши запрос');
    
    try {
        const rows = await db.dbAll(query);
        const json = JSON.stringify(rows, null, 2);
        
        if (json.length > 4000) {
            ctx.replyWithDocument({ source: Buffer.from(json), filename: 'result.json' });
        } else {
            ctx.reply(`\`\`\`json\n${json}\n\`\`\``, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        ctx.reply('Ошибка: ' + e.message);
    }
});
// Команда EXPORT (Excel)
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

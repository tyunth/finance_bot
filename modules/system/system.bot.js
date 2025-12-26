const { Composer } = require('telegraf');
const fs = require('fs');
const db = require('../../db');
const config = require('../../config');

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

module.exports = bot;

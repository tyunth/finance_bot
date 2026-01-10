const { Telegraf, session, Markup } = require('telegraf');
const config = require('./config');
const db = require('./db');
const keyboard = require('./modules/utilities/keyboard');

// Инициализация
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());


// --- 1. MIDDLEWARE (Фейс-контроль) ---
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.session) ctx.session = {};
    if (!ctx.state) ctx.state = {};

    try {
        let user = await db.getUser(ctx.from.id);
        if (!user && ctx.from.id.toString() === config.ADMIN_ID.toString()) {
            await db.createUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
            await db.approveUser(ctx.from.id);
            await db.dbRun('UPDATE users SET role="admin" WHERE telegram_id = ?', [ctx.from.id]);
            user = await db.getUser(ctx.from.id);
        }
        if (!user) return ctx.reply('Нет доступа.');
        ctx.state.user = user;

        // Логирование использования
        const logUsage = async () => {
            try {
                let functionName = 'unknown';
                if (ctx.message) {
                    if (ctx.message.text) {
                        functionName = ctx.message.text.startsWith('/') ? ctx.message.text.split(' ')[0] : 'text_message';
                    } else if (ctx.message.photo) {
                        functionName = 'photo';
                    } else if (ctx.message.video) {
                        functionName = 'video';
                    } else if (ctx.message.document) {
                        functionName = 'document';
                    } else if (ctx.message.voice) {
                        functionName = 'voice';
                    } else {
                        functionName = 'other_message';
                    }
                } else if (ctx.callbackQuery) {
                    functionName = 'callback_' + ctx.callbackQuery.data.split('_')[0];
                }
                console.log(`Bot usage: ${ctx.from.id} - ${functionName}`);
                await db.incrementUsageCounter(ctx.from.id, functionName, 'bot');
            } catch (e) {
                console.error('Error logging bot usage:', e);
            }
        };
        logUsage();

        return next();
    } catch (e) { console.error(e); return next(); }
});

// --- 2. ПОДКЛЮЧЕНИЕ МОДУЛЕЙ ---
// Мы разбиваем бота на файлы. Каждый файл отвечает за свою часть.

bot.use(require('./modules/finance/finance.bot'));   // 💰 Финансы
bot.use(require('./modules/finance/receipts.bot')); // Чеки
bot.use(require('./modules/students/students.bot')); // 🎓 Ученики
bot.use(require('./modules/shopping/shopping.bot')); // 🛒 Покупки
bot.use(require('./modules/todos/todos.bot'));       // 📝 Дела
bot.use(require('./modules/reports/reports.bot'));     // 📊 Отчеты
bot.use(require('./modules/system/system.bot'));       // ⚙️ Админка
bot.use(require('./modules/calendar/calendar.bot')); // <-- Календарь
bot.use(require('./modules/sport/sport.bot'));       // <-- Спорт
bot.use(require('./modules/media/1se.bot'));

bot.command('last', async (ctx) => {
    // Проверка на админа (по желанию, можно убрать if)
    if (ctx.from.id !== 133245761) return; // <-- Твой ID (или используй config.ADMIN_ID)

    try {
        const rows = await db.dbAll(`
            SELECT id, user_id, amount, category, comment, date
            FROM transactions
            ORDER BY id DESC
            LIMIT 10
        `);

        console.log('\n--- ПОСЛЕДНИЕ ТРАНЗАКЦИИ ---');
        console.table(rows); // console.table делает красоту
        console.log('----------------------------\n');

        ctx.reply('Вывел последние 10 транзакций в консоль сервера.');
    } catch (e) {
        ctx.reply('Ошибка: ' + e.message);
    }
});

// Запуск кронов
require('./jobs/cron.manager')(bot);
const HELP_MSG = `
🤖 **Доступные команды:**
📅 *Календарь*
/sync - Проверка
/students - Ученики
/debts - Долги

💰 *Финансы*
/undo - ↩️ Отменить последнюю запись
/latest - 📜 История (10 шт)
/day - Отчет за день
/week - Отчет за неделю
/month - Отчет за месяц
/categories - Мои категории

📝 *Разное*
/todo [текст] - Задача
/trash - Корзина
/morning - Сводка
/export - Скачать данные
/movie - Монтаж видео
`;

bot.hears(['Помощь', '/help'], (ctx) => ctx.replyWithMarkdown(HELP_MSG));

// --- 3. ГЛАВНОЕ МЕНЮ (/start) ---
bot.start(async (ctx) => {
    ctx.session.state = {};
    await db.ensureMainAccount(ctx.from.id);
    
    const menu = await keyboard.getMainMenu(ctx.from.id);
    await ctx.reply(`Привет! Меню обновлено.`, menu);
});

bot.hears(['Меню', 'menu'], async (ctx) => {
    const menu = await keyboard.getMainMenu(ctx.from.id);
    await ctx.reply('Главное меню:', menu);
});



// Запуск кронов
require('./jobs/cron.manager')(bot);

bot.launch().then(() => console.log('🚀 Bot V2 Full Power started'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

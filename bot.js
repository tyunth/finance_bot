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

// --- ПОЛНОЕ МЕНЮ ПОМОЩИ ---
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
`;

bot.hears(['Помощь', '/help'], (ctx) => ctx.replyWithMarkdown(HELP_MSG));

// --- 3. ГЛАВНОЕ МЕНЮ (/start) ---
bot.start(async (ctx) => {
    ctx.session.state = {};
    await db.ensureMainAccount(ctx.from.id);
    
    const menu = await keyboard.getMainMenu(ctx.from.id); // <--- Вот здесь
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

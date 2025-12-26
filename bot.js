const { Telegraf, session, Markup } = require('telegraf');
const config = require('./config');
const db = require('./db');

// Инициализация
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// --- 1. MIDDLEWARE (Фейс-контроль) ---
bot.use(async (ctx, next) => {
    // Пропускаем системные апдейты
    if (!ctx.from) return next();
    
    // Инициализация сессии
    if (!ctx.session) ctx.session = {}; 
    if (!ctx.state) ctx.state = {};
    
    try {
        let user = await db.getUser(ctx.from.id);

        // Авто-регистрация Админа (первый запуск)
        if (!user && ctx.from.id.toString() === config.ADMIN_ID.toString()) {
            console.log('👑 Админ найден. Создаю запись...');
            await db.createUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
            await db.approveUser(ctx.from.id);
            await db.dbRun('UPDATE users SET role="admin" WHERE telegram_id = ?', [ctx.from.id]);
            user = await db.getUser(ctx.from.id);
        }

        // Если пользователя нет -> Заявка
        if (!user) {
            await db.createUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
            await ctx.telegram.sendMessage(config.ADMIN_ID, 
                `👤 **Новая заявка!**\nИмя: ${ctx.from.first_name} (ID: \`${ctx.from.id}\`)`,
                { parse_mode: 'Markdown' }
            );
            return ctx.reply('🔒 Доступ закрыт. Заявка отправлена администратору.');
        }

        // Если не одобрен
        if (!user.is_approved) return ctx.reply('⏳ Ожидайте подтверждения.');

        // Всё ок -> сохраняем юзера в контекст
        ctx.state.user = user;
        return next();

    } catch (e) {
        console.error('Middleware Error:', e);
        return next();
    }
});

// --- 2. ПОДКЛЮЧЕНИЕ МОДУЛЕЙ ---
// Мы разбиваем бота на файлы. Каждый файл отвечает за свою часть.

bot.use(require('./modules/finance/finance.bot'));   // 💰 Финансы
bot.use(require('./modules/students/students.bot')); // 🎓 Ученики
bot.use(require('./modules/shopping/shopping.bot')); // 🛒 Покупки
bot.use(require('./modules/todos/todos.bot'));       // 📝 Дела
bot.use(require('./modules/reports/reports.bot'));     // 📊 Отчеты
bot.use(require('./modules/system/system.bot'));       // ⚙️ Админка

// --- 3. ГЛАВНОЕ МЕНЮ (/start) ---
bot.start(async (ctx) => {
    ctx.session.state = {}; // Сброс состояния
    await db.ensureMainAccount(ctx.from.id);
    
    // Генерируем меню на основе прав (Модулей)
    const modules = await db.getUserModules(ctx.from.id);
    const buttons = [];

    // Финансы (Есть у всех по дефолту)
    buttons.push(['📉 Расходы', '📈 Доходы']);
    
    // Ученики
    if (modules.includes('all') || modules.includes('students')) {
        buttons.push(['🎓 Ученики', '📅 Расписание']);
    }

    // Доп кнопки
    buttons.push(['📊 Отчет', 'Счета']);
    buttons.push(['Помощь']);

    await ctx.reply(`Привет, ${ctx.from.first_name}! Бот перезапущен (Модульная версия v2).`, 
        Markup.keyboard(buttons).resize()
    );
});

// Help
bot.hears('Помощь', (ctx) => ctx.reply(
    `/list - Список покупок\n/students - Ученики\n/debts - Долги\n/day [дата] - Расходы за день\n/trash - Корзина`
));

// --- 4. ЗАПУСК КРОНОВ ---
require('./jobs/cron.manager')(bot);

// --- 5. ЗАПУСК БОТА ---
bot.launch().then(() => console.log('🚀 Telegram Bot started successfully'));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

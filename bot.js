const { Telegraf, session } = require('telegraf');
const config = require('./config');
const db = require('./db');
const cron = require('node-cron'); 

// Инициализация
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// --- MIDDLEWARE ---
// Твой фейс-контроль (немного сократил для читаемости)
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.session) ctx.session = {}; 
    if (!ctx.state) ctx.state = {};
    
    try {
        let user = await db.getUser(ctx.from.id);
        
        // Авто-регистрация админа
        if (!user && ctx.from.id.toString() === config.ADMIN_ID.toString()) {
            await db.createUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
            await db.approveUser(ctx.from.id);
            await db.dbRun('UPDATE users SET role="admin" WHERE telegram_id = ?', [ctx.from.id]);
            user = await db.getUser(ctx.from.id);
        }

        // Если нет в базе
        if (!user) {
            await db.createUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
            await ctx.telegram.sendMessage(config.ADMIN_ID, `👤 Новая заявка: ${ctx.from.first_name} (ID: ${ctx.from.id})`);
            return ctx.reply('🔒 Доступ закрыт. Заявка отправлена админу.');
        }

        if (!user.is_approved) return ctx.reply('⏳ Ждите подтверждения.');

        ctx.state.user = user;
        return next();
    } catch (e) {
        console.error('Middleware Error:', e);
        return next();
    }
});

// --- ПОДКЛЮЧЕНИЕ МОДУЛЕЙ ---
// Мы подключаем логику из папок модулей
bot.use(require('./modules/finance/finance.bot'));   // Финансы
bot.use(require('./modules/students/students.bot')); // Ученики
// bot.use(require('./modules/sport/sport.bot'));    // Спорт (если есть)

// --- ОБЩИЕ КОМАНДЫ ---
bot.start(async (ctx) => {
    ctx.session.state = {}; 
    await db.ensureMainAccount(ctx.from.id);
    
    // Проверка модулей
    const modules = await db.getUserModules(ctx.from.id);
    const buttons = [['📉 Расходы', '📈 Доходы']];
    
    if (modules.includes('all') || modules.includes('students')) {
        buttons.push(['🎓 Ученики', '📅 Расписание']);
    }
    
    buttons.push(['Счета', 'Помощь']);

    await ctx.reply(`Привет, ${ctx.from.first_name}! Бот обновлен и разбит на модули.`, {
        reply_markup: { keyboard: buttons, resize_keyboard: true }
    });
});

bot.hears('Помощь', (ctx) => ctx.reply('/list - Покупки\n/students - Ученики\n/debts - Долги\n/day [дата] - Отчет'));

// --- ЗАПУСК ---
bot.launch().then(() => console.log('🤖 Bot started (Modular architecture)'));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// (Кроны можно вынести в jobs/cron.manager.js, но пока можно оставить тут или подключить отдельно)
require('./jobs/cron.manager')(bot); // Мы создадим этот файл позже

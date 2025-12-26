const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config'); // Убедись, что config.js есть в корне

const bot = new Composer();

// Хелперы
const formatAmount = (amount) => new Intl.NumberFormat('ru-RU').format(amount) + ' ' + config.CURRENCY;
const parseAmount = (text) => {
    const cleaned = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
};

// --- 1. ПРОСМОТР СЧЕТОВ ---
bot.hears('Счета', async (ctx) => {
    const { balances, accountsList } = await db.getBalances(ctx.from.id);
    let msg = `💳 *Ваши счета:*`;
    
    // Основной и другие
    for (const acc of accountsList) {
        msg += `\n\n*${acc.name}*: ${formatAmount(balances[acc.name] || 0)}`;
        if (acc.is_deposit) {
            msg += `\n🏦 _${acc.bank_name || 'Банк'} (${acc.rate}%)_`;
        }
    }
    
    // Inline кнопки для депозитов
    const buttons = [
        [Markup.button.callback('➕ Новый депозит', 'btn_add_deposit')],
        [Markup.button.callback('🗑 Удалить депозит', 'btn_del_deposit')]
    ];
    
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

// --- 2. ДОБАВЛЕНИЕ ОПЕРАЦИЙ (Wizard на минималках) ---

// Вход в режим "Расходы"
bot.hears(['📉 Расходы', 'Расход'], (ctx) => {
    ctx.session.state = { type: 'expense', step: 'AMOUNT' };
    ctx.reply('💸 Введите сумму расхода:', Markup.removeKeyboard()); // Убираем клаву, чтобы не мешала
});

// Вход в режим "Доходы"
bot.hears(['📈 Доходы', 'Доход'], (ctx) => {
    ctx.session.state = { type: 'income', step: 'AMOUNT' };
    ctx.reply('💰 Введите сумму дохода:', Markup.removeKeyboard());
});

// Вход в режим "Перевод"
bot.hears('Перевод', async (ctx) => {
    ctx.session.state = { type: 'transfer', step: 'SOURCE' };
    
    // Генерируем кнопки счетов
    const { accountsList } = await db.getBalances(ctx.from.id);
    const buttons = accountsList.map(a => [a.name]);
    buttons.push(['Отмена']);
    
    ctx.reply('📤 Откуда переводим?', Markup.keyboard(buttons).resize());
});

// --- 3. ОБРАБОТЧИК ТЕКСТА (State Machine) ---
bot.on('text', async (ctx, next) => {
    const state = ctx.session.state || {};
    const text = ctx.message.text.trim();

    // Если нет активного процесса — пропускаем к другим модулям
    if (!state.step) return next();

    // Отмена в любой момент
    if (text === 'Отмена' || text === '/cancel') {
        ctx.session.state = {};
        // Возвращаем главное меню (надо бы вынести его в отдельную функцию, но пока захардкодим)
        return ctx.reply('❌ Отменено.', Markup.keyboard([
            ['📉 Расходы', '📈 Доходы'], ['📊 Отчет', 'Счета']
        ]).resize());
    }

    // === ЛОГИКА РАСХОДОВ И ДОХОДОВ ===
    if (['expense', 'income'].includes(state.type)) {
        
        // Шаг 1: Сумма
        if (state.step === 'AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('🔢 Введите число (например 500 или 12.50).');
            
            state.amount = amount;
            state.step = 'CATEGORY'; // Следующий шаг
            
            // Показываем категории
            const cats = await db.getUserCategories(ctx.from.id, state.type);
            // Разбиваем по 2 кнопки в ряд
            const buttons = [];
            for (let i = 0; i < cats.length; i += 2) buttons.push(cats.slice(i, i + 2));
            buttons.push(['Отмена']);

            return ctx.reply('📂 Выберите категорию или напишите новую:', Markup.keyboard(buttons).resize());
        }

        // Шаг 2: Категория (+ Комментарий авто)
        if (state.step === 'CATEGORY') {
            const category = text; // То, что нажал или написал юзер
            
            // Пишем в базу
            await db.addTransaction({
                userId: ctx.from.id,
                type: state.type,
                amount: state.amount,
                category: category,
                tag: state.type === 'income' ? 'Доход' : 'Разное',
                comment: 'Через бота', // Можно добавить шаг для коммента, если хочешь
                sourceAccount: state.type === 'expense' ? 'Основной' : null,
                targetAccount: state.type === 'income' ? 'Основной' : null
            });

            const { balances } = await db.getBalances(ctx.from.id);
            const sign = state.type === 'income' ? '+' : '-';
            
            ctx.reply(`✅ *Записано:*\n${sign}${formatAmount(state.amount)} — ${category}\n\n💰 Баланс: ${formatAmount(balances['Основной'])}`, {
                parse_mode: 'Markdown',
                ...Markup.keyboard([['📉 Расходы', '📈 Доходы'], ['📊 Отчет', 'Счета']]).resize()
            });
            
            ctx.session.state = {}; // Сброс
            return;
        }
    }
    
    return next();
});

module.exports = bot;

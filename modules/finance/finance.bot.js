const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config');

const bot = new Composer();

// --- ХЕЛПЕР: ГЛАВНОЕ МЕНЮ ---
async function getMainMenu(ctx) {
    const modules = await db.getUserModules(ctx.from.id);
    const buttons = [['📉 Расходы', '📈 Доходы']];
    
    if (modules.includes('all') || modules.includes('students')) {
        buttons.push(['🎓 Ученики', '📅 Расписание']);
    }
    if (modules.includes('all') || modules.includes('sport')) {
        buttons.push(['💪 Спорт']);
    }
    buttons.push(['📊 Отчет', 'Счета']);
    buttons.push(['Помощь']);

    return Markup.keyboard(buttons).resize();
}

// --- ХЕЛПЕРЫ ---
const formatAmount = (amount) => new Intl.NumberFormat('ru-RU').format(amount) + ' ' + config.CURRENCY;
const parseAmount = (text) => {
    const cleaned = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
};

// --- 1. СТАРТ ВВОДА ---
bot.hears(['📉 Расходы', 'Расход'], async (ctx) => {
    ctx.session.state = { type: 'expense', step: 'AMOUNT' };
    await ctx.reply('💸 Введите сумму:', Markup.keyboard([['❌ Отмена']]).resize());
});

bot.hears(['📈 Доходы', 'Доход'], async (ctx) => {
    ctx.session.state = { type: 'income', step: 'AMOUNT' };
    await ctx.reply('💰 Введите сумму:', Markup.keyboard([['❌ Отмена']]).resize());
});

// --- 2. МАШИНА СОСТОЯНИЙ ---
bot.on('text', async (ctx, next) => {
    const state = ctx.session.state || {};
    const text = ctx.message.text.trim();

    // Сброс
    if (text === '❌ Отмена' || text === '/cancel') {
        ctx.session.state = {};
        const menu = await getMainMenu(ctx);
        return ctx.reply('Отменено.', menu);
    }

    // Пропускаем, если не наш процесс
    if (!state.step || !['expense', 'income'].includes(state.type)) {
        return next();
    }

    // === ШАГ 1: СУММА ===
    if (state.step === 'AMOUNT') {
        const amount = parseAmount(text);
        if (!amount) return ctx.reply('🔢 Введите число (например: 150).');
        
        state.amount = amount;
        state.step = 'COMMENT'; // Идем к комментарию
        
        await ctx.reply('💬 На что потрачено? (Комментарий)', Markup.keyboard([['❌ Отмена']]).resize());
        return;
    }

    // === ШАГ 2: КОММЕНТАРИЙ + АВТО-КАТЕГОРИЯ ===
    if (state.step === 'COMMENT') {
        state.comment = text;
        
        // 🔥 УМНАЯ ЛОГИКА: Ищем категорию по комментарию
        // В db.js должна быть функция getCategoryByComment
        const predictedCategory = await db.getCategoryByComment(text);

        if (predictedCategory) {
            // ---> УРА, НАШЛИ! Сохраняем сразу
            await saveTransaction(ctx, state, predictedCategory, true);
        } else {
            // ---> НЕ НАШЛИ. Спрашиваем категорию
            state.step = 'CATEGORY';
            
            const cats = await db.getUserCategories(ctx.from.id, state.type);
            const buttons = [];
            for (let i = 0; i < cats.length; i += 2) buttons.push(cats.slice(i, i + 2));
            buttons.push(['❌ Отмена']);

            await ctx.reply(
                `📂 Категория для "${text}" не найдена. Выбери из списка или напиши свою:`, 
                Markup.keyboard(buttons).resize()
            );
        }
        return;
    }

    // === ШАГ 3: КАТЕГОРИЯ (Только если не нашли авто) ===
    if (state.step === 'CATEGORY') {
        const category = text;
        
        // Сохраняем и ОБУЧАЕМ бота
        await saveTransaction(ctx, state, category, false);
        
        // Запоминаем связку "Комментарий -> Категория"
        if (state.comment) {
            await db.learnKeyword(state.comment, category);
        }
        return;
    }

    return next();
});

// --- ФУНКЦИЯ СОХРАНЕНИЯ ---
async function saveTransaction(ctx, state, category, isAuto) {
    await db.addTransaction({
        userId: ctx.from.id,
        type: state.type,
        amount: state.amount,
        category: category,
        tag: state.type === 'income' ? 'Доход' : 'Разное',
        comment: state.comment,
        sourceAccount: state.type === 'expense' ? 'Основной' : null,
        targetAccount: state.type === 'income' ? 'Основной' : null
    });

    const { balances } = await db.getBalances(ctx.from.id);
    const sign = state.type === 'income' ? '+' : '-';
    const autoBadge = isAuto ? '🤖' : '';

    const mainMenu = await getMainMenu(ctx);
    
    await ctx.reply(
        `✅ *Записано:*\n${sign}${formatAmount(state.amount)} — ${state.comment}\n📂 Категория: ${category} ${autoBadge}\n💰 Баланс: ${formatAmount(balances['Основной'])}`, 
        { parse_mode: 'Markdown', ...mainMenu }
    );
    
    ctx.session.state = {}; // Сброс
}

// --- СЧЕТА ---
bot.hears('Счета', async (ctx) => {
    const { balances, accountsList } = await db.getBalances(ctx.from.id);
    let msg = `💳 *Ваши счета:*`;
    
    for (const acc of accountsList) {
        msg += `\n\n*${acc.name}*: ${formatAmount(balances[acc.name] || 0)}`;
        if (acc.is_deposit) msg += `\n🏦 _${acc.bank_name || 'Банк'} (${acc.rate}%)_`;
    }
    
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
        [Markup.button.callback('➕ Новый депозит', 'btn_add_deposit')]
    ]));
});

module.exports = bot;

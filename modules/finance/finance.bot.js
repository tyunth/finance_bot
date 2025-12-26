const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config');

// Composer — это как "мини-роутер" для бота
const bot = new Composer();

// Хелперы (можно вынести в utils)
const formatAmount = (amount) => `${amount.toFixed(0)} ${config.CURRENCY}`;
const parseAmount = (text) => parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.'));

// --- ОБРАБОТЧИКИ ---

bot.hears('Счета', async (ctx) => {
    const { balances, accountsList } = await db.getBalances(ctx.from.id);
    let msg = `💳 *Ваши счета:*`;
    for (const acc of accountsList) {
        msg += `\n\n*${acc.name}*: ${formatAmount(balances[acc.name] || 0)}`;
        if (acc.is_deposit) msg += `\n_Банк: ${acc.bank_name} (${acc.rate}%)_`;
    }
    ctx.replyWithMarkdown(msg);
});

// Сценарии ввода (упрощенные, без WizardScene пока что, на стейтах как у тебя было)
bot.hears(['📉 Расходы', 'Расход'], (ctx) => {
    ctx.session.state = { type: 'expense', step: 'AWAITING_AMOUNT' };
    ctx.reply('💸 Введите сумму расхода:', Markup.removeKeyboard());
});

bot.hears(['📈 Доходы', 'Доход'], (ctx) => {
    ctx.session.state = { type: 'income', step: 'AWAITING_AMOUNT' };
    ctx.reply('💰 Введите сумму дохода:', Markup.removeKeyboard());
});

// Обработка текста (Ловит ввод суммы и комментов)
bot.on('text', async (ctx, next) => {
    const state = ctx.session.state || {};
    const text = ctx.message.text;

    // Если мы не в процессе ввода финансов — передаем управление дальше (другим модулям)
    if (!state.type || !['expense', 'income'].includes(state.type)) return next();

    // Шаг 1: Сумма
    if (state.step === 'AWAITING_AMOUNT') {
        const amount = parseAmount(text);
        if (!amount) return ctx.reply('Введите число (или "Отмена").');
        
        state.amount = amount;
        state.step = 'AWAITING_CATEGORY';
        
        // Получаем категории
        const cats = await db.getUserCategories(ctx.from.id, state.type);
        const buttons = [];
        for (let i = 0; i < cats.length; i += 2) buttons.push(cats.slice(i, i + 2));
        
        ctx.reply('Выберите категорию или напишите новую:', 
            Markup.keyboard([...buttons, ['Отмена']]).resize()
        );
        return;
    }

    // Шаг 2: Категория (и сохранение)
    if (state.step === 'AWAITING_CATEGORY') {
        if (text === 'Отмена') {
            ctx.session.state = {};
            return ctx.reply('Отменено', Markup.keyboard([['📉 Расходы', '📈 Доходы'], ['Счета']]).resize());
        }

        const category = text;
        await db.addTransaction({
            userId: ctx.from.id,
            type: state.type,
            amount: state.amount,
            category: category,
            comment: 'Через бота',
            tag: state.type === 'income' ? 'Доход' : 'Разное',
            sourceAccount: state.type === 'expense' ? 'Основной' : null,
            targetAccount: state.type === 'income' ? 'Основной' : null
        });

        const { balances } = await db.getBalances(ctx.from.id);
        ctx.reply(`✅ Записано: ${state.type === 'income' ? '+' : '-'}${formatAmount(state.amount)} (${category})\nБаланс: ${formatAmount(balances['Основной'])}`, 
            Markup.keyboard([['📉 Расходы', '📈 Доходы'], ['Счета']]).resize()
        );
        ctx.session.state = {};
    }
});

module.exports = bot;

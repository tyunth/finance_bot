const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config');
const { getMainMenu } = require('../utilities/keyboard.js');

const bot = new Composer();

// --- ХЕЛПЕРЫ ---
const formatAmount = (amount) => new Intl.NumberFormat('ru-RU').format(amount) + ' ' + config.CURRENCY;
const parseAmount = (text) => {
    const cleaned = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
};

// Генератор клавиатуры счетов (исключаем уже выбранный)
async function generateAccountKeyboard(userId, excludeName = null) {
    const { accountsList } = await db.getBalances(userId);
    const buttons = [];
    accountsList.forEach(acc => {
        if (acc.name !== excludeName) buttons.push([acc.name]);
    });
    buttons.push(['❌ Отмена']);
    return Markup.keyboard(buttons).resize();
}

// =========================================================
// 1. КОМАНДЫ (UNDO, DELETE) - ДОЛЖНЫ БЫТЬ СВЕРХУ
// =========================================================

bot.command('undo', async (ctx) => {
    // Удаляем последнюю транзакцию ЛЮБОГО типа
    const last = await db.dbGet(
        'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [ctx.from.id]
    );

    if (!last) return ctx.reply('Нет операций для отмены.');

    await db.dbRun('DELETE FROM transactions WHERE id = ?', [last.id]);
    
    const { balances } = await db.getBalances(ctx.from.id);
    
    // Формируем красивое сообщение
    let msg = `↩️ *Отменено:* `;
    if (last.type === 'transfer') {
        msg += `Перевод ${formatAmount(last.amount)} (${last.source_account} -> ${last.target_account})`;
    } else {
        const sign = last.type === 'income' ? '+' : '-';
        msg += `${sign}${formatAmount(last.amount)} — ${last.category}`;
    }
    msg += `\n💰 Баланс осн.: ${formatAmount(balances['Основной'])}`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Обработка /delete 123
bot.hears(/^\/delete\s+(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await deleteTx(ctx, id);
});
// Обработка клика по ссылке /del_123
bot.hears(/^\/del_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await deleteTx(ctx, id);
});

async function deleteTx(ctx, id) {
    const tx = await db.dbGet('SELECT id FROM transactions WHERE id = ? AND user_id = ?', [id, ctx.from.id]);
    if (!tx) return ctx.reply('Запись не найдена или чужая.');
    await db.dbRun('DELETE FROM transactions WHERE id = ?', [id]);
    ctx.reply(`🗑 Запись #${id} удалена.`);
}


// =========================================================
// 2. ВХОД В РЕЖИМЫ (КНОПКИ МЕНЮ)
// =========================================================

bot.hears(['📉 Расходы', 'Расход'], async (ctx) => {
    ctx.session.state = { type: 'expense', step: 'EXPENSE_AMOUNT' };
    await ctx.reply('💸 Введите сумму расхода:', Markup.keyboard([['❌ Отмена']]).resize());
});

bot.hears(['📈 Доходы', 'Доход'], async (ctx) => {
    ctx.session.state = { type: 'income', step: 'INCOME_CATEGORY' };
    const buttons = [['Репетиторство', 'Стипендия'], ['Зарплата', 'Подарок'], ['Другое'], ['❌ Отмена']];
    await ctx.reply('💰 Выберите категорию дохода:', Markup.keyboard(buttons).resize());
});

// Кнопки "Перевод" может не быть в главном меню, но команда должна работать
bot.hears(['Перевод', '/transfer'], async (ctx) => {
    ctx.session.state = { type: 'transfer', step: 'TRANSFER_SOURCE' };
    // Показываем счета
    const kb = await generateAccountKeyboard(ctx.from.id);
    await ctx.reply('📤 С какого счета переводим?', kb);
});

// Редактирование
bot.hears(/^edit\s+(\d+)$/i, async (ctx) => {
    const txId = parseInt(ctx.match[1]);
    const t = await db.dbGet('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [txId, ctx.from.id]);
    if (!t) return ctx.reply('Транзакция не найдена.');
    
    // Определяем тип для стейта
    const editType = t.type === 'income' ? 'edit_income' : 'edit_expense';
    ctx.session.state = { type: editType, txId, step: 'EDIT_AMOUNT', oldAmount: t.amount };
    
    await ctx.reply(
        `✏️ Редактирование #${txId} (${t.category})\nСумма: ${formatAmount(t.amount)}\nВведите новую (или 0):`, 
        Markup.keyboard([['❌ Отмена']]).resize()
    );
});


// =========================================================
// 3. ОБРАБОТКА ТЕКСТА (STATE MACHINE)
// =========================================================

bot.on('text', async (ctx, next) => {
    const state = ctx.session.state || {};
    const text = ctx.message.text.trim();

    // 1. Отмена
    if (text === '❌ Отмена' || text === '/cancel') {
        ctx.session.state = {};
        const menu = await getMainMenu(ctx.from.id);
        return ctx.reply('Отменено.', menu);
    }

    if (!state.type) return next(); // Не наш клиент

    // --- ЛОГИКА РАСХОДОВ ---
    if (state.type === 'expense') {
        if (state.step === 'EXPENSE_AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('Введите число.');
            state.amount = amount;
            state.step = 'EXPENSE_COMMENT';
            await ctx.reply('💬 На что? (Комментарий)', Markup.keyboard([['Пропустить'], ['❌ Отмена']]).resize());
            return;
        }
        if (state.step === 'EXPENSE_COMMENT') {
            state.comment = text === 'Пропустить' ? '' : text;
            const predicted = await db.getCategoryByComment(text);
            if (predicted) {
                await saveTransaction(ctx, 'expense', state.amount, predicted, state.comment, true);
            } else {
                state.step = 'EXPENSE_CATEGORY';
                const cats = await db.getUserCategories(ctx.from.id, 'expense');
                const buttons = [];
                for (let i = 0; i < cats.length; i += 3) buttons.push(cats.slice(i, i + 2));
                buttons.push(['❌ Отмена']);
                await ctx.reply('📂 Выберите категорию:', Markup.keyboard(buttons).resize());
            }
            return;
        }
        if (state.step === 'EXPENSE_CATEGORY') {
            await saveTransaction(ctx, 'expense', state.amount, text, state.comment, false);
            if (state.comment) await db.learnKeyword(state.comment, text);
            return;
        }
    }

    // --- ЛОГИКА ДОХОДОВ ---
    if (state.type === 'income') {
        if (state.step === 'INCOME_CATEGORY') {
            state.category = text;
            // Пресеты
            if (text === 'Репетиторство') return saveTransaction(ctx, 'income', config.LESSON_PRICE || 0, text, 'Урок');
            if (text === 'Стипендия') {
                const schol = config.SCHOLARSHIP || 0;
                if (schol > 0) return saveTransaction(ctx, 'income', schol, text, 'Стипендия');
            }
            state.step = 'INCOME_AMOUNT';
            await ctx.reply('💰 Сумма дохода:', Markup.keyboard([['❌ Отмена']]).resize());
            return;
        }
        if (state.step === 'INCOME_AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('Введите число.');
            await saveTransaction(ctx, 'income', amount, state.category, 'Доход');
            return;
        }
    }

    // --- ЛОГИКА ПЕРЕВОДОВ (ИСПРАВЛЕНО) ---
    if (state.type === 'transfer') {
        // Шаг 1: ОТКУДА
        if (state.step === 'TRANSFER_SOURCE') {
            state.sourceAccount = text;
            state.step = 'TRANSFER_TARGET';
            // Генерируем клавиатуру, исключая выбранный счет
            const kb = await generateAccountKeyboard(ctx.from.id, text);
            await ctx.reply(`Списано с: ${text}. Куда зачисляем?`, kb);
            return;
        }
        // Шаг 2: КУДА
        if (state.step === 'TRANSFER_TARGET') {
            state.targetAccount = text;
            state.step = 'TRANSFER_AMOUNT';
            await ctx.reply(`🔄 ${state.sourceAccount} ➜ ${state.targetAccount}. Сумма:`, Markup.keyboard([['❌ Отмена']]).resize());
            return;
        }
        // Шаг 3: СУММА и СОХРАНЕНИЕ
        if (state.step === 'TRANSFER_AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('Введите число.');
            
            // ВАЖНО: type = 'transfer', чтобы не попадало в статистику доходов
            await db.addTransaction({
                userId: ctx.from.id, 
                type: 'transfer', 
                amount: amount, 
                category: 'Перевод', 
                tag: 'Перевод',
                comment: `Перевод ${state.sourceAccount}->${state.targetAccount}`, 
                sourceAccount: state.sourceAccount, 
                targetAccount: state.targetAccount
            });
            
            const menu = await getMainMenu(ctx.from.id);
            const { balances } = await db.getBalances(ctx.from.id);
            
            await ctx.reply(
                `✅ *Перевод выполнен:*\n${state.sourceAccount} ➜ ${state.targetAccount}: ${formatAmount(amount)}\n\n💰 ${state.sourceAccount}: ${formatAmount(balances[state.sourceAccount])}\n💰 ${state.targetAccount}: ${formatAmount(balances[state.targetAccount])}`, 
                { parse_mode: 'Markdown', ...menu }
            );
            
            ctx.session.state = {};
            return;
        }
    }

    return next();
});

// --- СОХРАНЕНИЕ ТРАНЗАКЦИИ (Income/Expense) ---
async function saveTransaction(ctx, type, amount, category, comment, isAuto = false) {
    await db.addTransaction({
        userId: ctx.from.id, type, amount, category,
        tag: type === 'income' ? 'Доход' : 'Разное',
        comment,
        sourceAccount: type === 'expense' ? 'Основной' : null,
        targetAccount: type === 'income' ? 'Основной' : null
    });

    const { balances } = await db.getBalances(ctx.from.id);
    const sign = type === 'income' ? '+' : '-';
    const menu = await getMainMenu(ctx.from.id);
    const badge = isAuto ? ' 🤖' : '';

    await ctx.reply(
        `✅ *${type === 'income' ? 'Доход' : 'Расход'} записан:*\n` + 
        `${sign}${formatAmount(amount)} — ${category}${badge}\n` +
        `${comment ? `_(${comment})_` : ''}\n` + 
        `💰 Баланс: ${formatAmount(balances['Основной'])}`, 
        { parse_mode: 'Markdown', ...menu }
    );
    ctx.session.state = {};
}

// --- ПРОСМОТР СЧЕТОВ ---
bot.hears('Счета', async (ctx) => {
    const { balances, accountsList } = await db.getBalances(ctx.from.id);
    let msg = `💳 *Ваши счета:*`;
    for (const acc of accountsList) {
        msg += `\n\n*${acc.name}*: ${formatAmount(balances[acc.name] || 0)}`;
        if (acc.is_deposit) msg += `\n🏦 _${acc.bank_name} (${acc.rate}%)_`;
    }
    
    // Добавляем кнопку перевода
    const buttons = [
        [Markup.button.callback('➕ Новый депозит', 'btn_add_deposit')],
        [Markup.button.callback('🔄 Сделать перевод', 'btn_start_transfer')] // <-- Новая кнопка
    ];
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

// Callback для кнопки перевода из списка счетов
bot.action('btn_start_transfer', async (ctx) => {
    ctx.session.state = { type: 'transfer', step: 'TRANSFER_SOURCE' };
    const kb = await generateAccountKeyboard(ctx.from.id);
    await ctx.deleteMessage(); // Удаляем меню счетов, чтобы не мешало
    await ctx.reply('📤 С какого счета переводим?', kb);
});

module.exports = bot;

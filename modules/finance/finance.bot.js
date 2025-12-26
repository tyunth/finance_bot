const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config');
// Обрати внимание на путь к меню!
const { getMainMenu } = require('../utilities/menu.js');

const bot = new Composer();

// --- ХЕЛПЕРЫ ---
const formatAmount = (amount) => new Intl.NumberFormat('ru-RU').format(amount) + ' ' + config.CURRENCY;
const parseAmount = (text) => {
    const cleaned = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
};

// Генератор клавиатуры счетов
async function generateAccountKeyboard(userId, excludeName = null) {
    const { accountsList } = await db.getBalances(userId);
    const buttons = [];
    accountsList.forEach(acc => {
        if (acc.name !== excludeName) buttons.push([acc.name]);
    });
    buttons.push(['❌ Отмена']);
    return Markup.keyboard(buttons).resize();
}

// ==========================================
// 1. КОМАНДЫ УДАЛЕНИЯ И ОТМЕНЫ (НОВОЕ)
// ==========================================

// Отмена последней записи (/undo)
bot.command('undo', async (ctx) => {
    const last = await db.dbGet(
        'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [ctx.from.id]
    );

    if (!last) return ctx.reply('Нет операций для отмены.');

    await db.dbRun('DELETE FROM transactions WHERE id = ?', [last.id]);
    
    const { balances } = await db.getBalances(ctx.from.id);
    const sign = last.type === 'income' ? '+' : '-';
    
    ctx.reply(
        `↩️ *Отменено:*\n${sign}${formatAmount(last.amount)} — ${last.category} (${last.comment})\n💰 Баланс: ${formatAmount(balances['Основной'])}`,
        { parse_mode: 'Markdown' }
    );
});

// Удаление по ID (/delete 123)
bot.command('delete', async (ctx) => handleDelete(ctx));
bot.hears(/^delete\s+(\d+)$/i, async (ctx) => handleDelete(ctx));

// Удаление по клику из /latest (/del_123)
bot.hears(/^\/del_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await deleteById(ctx, id);
});

async function handleDelete(ctx) {
    const text = ctx.message.text;
    const parts = text.split(/\s+/); // Разбиваем "delete 123"
    const id = parts[1];
    
    if (!id) return ctx.reply('Укажите ID. Пример: /delete 123');
    await deleteById(ctx, id);
}

async function deleteById(ctx, id) {
    const tx = await db.dbGet('SELECT id FROM transactions WHERE id = ? AND user_id = ?', [id, ctx.from.id]);
    if (!tx) return ctx.reply('Запись не найдена.');

    await db.dbRun('DELETE FROM transactions WHERE id = ?', [id]);
    ctx.reply(`🗑 Запись #${id} удалена.`);
}


// ==========================================
// 2. ВХОД В РЕЖИМЫ (Доход/Расход/Перевод)
// ==========================================

bot.hears(['📉 Расходы', 'Расход'], async (ctx) => {
    ctx.session.state = { type: 'expense', step: 'EXPENSE_AMOUNT' };
    await ctx.reply('💸 Введите сумму расхода:', Markup.keyboard([['❌ Отмена']]).resize());
});

bot.hears(['📈 Доходы', 'Доход'], async (ctx) => {
    ctx.session.state = { type: 'income', step: 'INCOME_CATEGORY' };
    // Пресеты категорий
    const buttons = [['Репетиторство', 'Стипендия'], ['Зарплата', 'Подарок'], ['Другое'], ['❌ Отмена']];
    await ctx.reply('💰 Выберите категорию дохода:', Markup.keyboard(buttons).resize());
});

bot.hears('Перевод', async (ctx) => {
    ctx.session.state = { type: 'transfer', step: 'TRANSFER_SOURCE' };
    const kb = await generateAccountKeyboard(ctx.from.id);
    await ctx.reply('📤 С какого счета переводим?', kb);
});

// Редактирование (/edit 123)
bot.hears(/^edit\s+(\d+)$/i, async (ctx) => {
    const txId = parseInt(ctx.match[1]);
    const t = await db.dbGet('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [txId, ctx.from.id]);
    
    if (!t) return ctx.reply('Транзакция не найдена.');
    
    const editType = t.type === 'income' ? 'edit_income' : 'edit_expense';
    ctx.session.state = { type: editType, txId, step: 'EDIT_AMOUNT', oldAmount: t.amount };
    
    await ctx.reply(
        `✏️ Редактирование #${txId} (${t.category})\nТекущая сумма: ${t.amount}\nВведите новую сумму (или 0 чтобы оставить):`, 
        Markup.keyboard([['❌ Отмена']]).resize()
    );
});


// ==========================================
// 3. МАШИНА СОСТОЯНИЙ (ОБРАБОТКА ТЕКСТА)
// ==========================================

bot.on('text', async (ctx, next) => {
    const state = ctx.session.state || {};
    const text = ctx.message.text.trim();

    // 1. Глобальная отмена
    if (text === '❌ Отмена' || text === '/cancel') {
        ctx.session.state = {};
        const menu = await getMainMenu(ctx.from.id);
        return ctx.reply('Отменено.', menu);
    }

    if (!state.type) return next(); // Если нет активного действия -> пропускаем

    // --- РАСХОДЫ ---
    if (state.type === 'expense') {
        // Шаг 1: Сумма
        if (state.step === 'EXPENSE_AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('Введите число.');
            state.amount = amount;
            state.step = 'EXPENSE_COMMENT';
            await ctx.reply('💬 На что? (Комментарий)', Markup.keyboard([['Пропустить'], ['❌ Отмена']]).resize());
            return;
        }
        // Шаг 2: Комментарий + Авто-категория
        if (state.step === 'EXPENSE_COMMENT') {
            state.comment = text === 'Пропустить' ? '' : text;
            
            // Пробуем угадать категорию
            const predicted = await db.getCategoryByComment(text);
            
            if (predicted) {
                // Угадали -> сохраняем сразу
                await saveTransaction(ctx, 'expense', state.amount, predicted, state.comment, true);
            } else {
                // Не угадали -> спрашиваем
                state.step = 'EXPENSE_CATEGORY';
                const cats = await db.getUserCategories(ctx.from.id, 'expense');
                
                // Формируем кнопки по 2 в ряд
                const buttons = [];
                for (let i = 0; i < cats.length; i += 2) buttons.push(cats.slice(i, i + 2));
                buttons.push(['❌ Отмена']);
                
                await ctx.reply('📂 Выберите категорию:', Markup.keyboard(buttons).resize());
            }
            return;
        }
        // Шаг 3: Категория (если не угадали)
        if (state.step === 'EXPENSE_CATEGORY') {
            await saveTransaction(ctx, 'expense', state.amount, text, state.comment, false);
            if (state.comment) await db.learnKeyword(state.comment, text); // Обучаем
            return;
        }
    }

    // --- ДОХОДЫ ---
    if (state.type === 'income') {
        // Шаг 1: Категория
        if (state.step === 'INCOME_CATEGORY') {
            state.category = text;
            // Проверка пресетов (фиксированные цены)
            if (text === 'Репетиторство') return saveTransaction(ctx, 'income', config.LESSON_PRICE || 0, text, 'Урок');
            if (text === 'Стипендия') {
                const schol = config.SCHOLARSHIP || 0;
                if (schol > 0) return saveTransaction(ctx, 'income', schol, text, 'Стипендия');
            }
            // Если не пресет -> спрашиваем сумму
            state.step = 'INCOME_AMOUNT';
            await ctx.reply('💰 Введите сумму дохода:', Markup.keyboard([['❌ Отмена']]).resize());
            return;
        }
        // Шаг 2: Сумма
        if (state.step === 'INCOME_AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('Введите число.');
            await saveTransaction(ctx, 'income', amount, state.category, 'Доход');
            return;
        }
    }

    // --- ПЕРЕВОДЫ ---
    if (state.type === 'transfer') {
        if (state.step === 'TRANSFER_SOURCE') {
            state.sourceAccount = text;
            state.step = 'TRANSFER_TARGET';
            const kb = await generateAccountKeyboard(ctx.from.id, text); // Исключаем выбранный
            await ctx.reply(`Списано с: ${text}. Куда зачисляем?`, kb);
            return;
        }
        if (state.step === 'TRANSFER_TARGET') {
            state.targetAccount = text;
            state.step = 'TRANSFER_AMOUNT';
            await ctx.reply(`🔄 ${state.sourceAccount} ➜ ${state.targetAccount}. Сумма:`, Markup.keyboard([['❌ Отмена']]).resize());
            return;
        }
        if (state.step === 'TRANSFER_AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('Введите число.');
            
            await db.addTransaction({
                userId: ctx.from.id, type: 'transfer', amount, category: 'Перевод', tag: 'Перевод',
                comment: 'Перевод', sourceAccount: state.sourceAccount, targetAccount: state.targetAccount
            });
            
            const menu = await getMainMenu(ctx.from.id);
            await ctx.reply('✅ Перевод выполнен.', menu);
            ctx.session.state = {};
            return;
        }
    }

    // --- РЕДАКТИРОВАНИЕ ---
    if (state.type && state.type.startsWith('edit_')) {
        if (state.step === 'EDIT_AMOUNT') {
            const amount = parseAmount(text);
            if (amount === null && text !== '0') return ctx.reply('Число или 0.');
            
            if (amount !== null && amount !== 0) state.amount = amount;
            else state.amount = state.oldAmount; // Оставляем как было
            
            state.step = 'EDIT_COMMENT';
            await ctx.reply('Новый комментарий (или "Пропустить"):', Markup.keyboard([['Пропустить'], ['❌ Отмена']]).resize());
            return;
        }
        if (state.step === 'EDIT_COMMENT') {
            state.comment = text === 'Пропустить' ? '' : text;
            state.step = 'EDIT_CATEGORY';
            
            const isExp = state.type === 'edit_expense';
            const cats = await db.getUserCategories(ctx.from.id, isExp ? 'expense' : 'income');
            
            // Кнопки категорий
            const buttons = [];
            for (let i = 0; i < cats.length; i += 2) buttons.push(cats.slice(i, i + 2));
            
            await ctx.reply('Новая категория:', Markup.keyboard(buttons).resize());
            return;
        }
        if (state.step === 'EDIT_CATEGORY') {
            const cat = text;
            const tag = state.type === 'edit_expense' ? 'Разное' : 'Доход';
            
            await db.dbRun(
                'UPDATE transactions SET amount = ?, comment = ?, category = ?, tag = ? WHERE id = ?', 
                [state.amount, state.comment, cat, tag, state.txId]
            );
            
            const menu = await getMainMenu(ctx.from.id);
            await ctx.reply('✅ Транзакция обновлена!', menu);
            ctx.session.state = {};
            return;
        }
    }

    return next();
});

// --- СОХРАНЕНИЕ ---
async function saveTransaction(ctx, type, amount, category, comment, isAuto = false) {
    await db.addTransaction({
        userId: ctx.from.id, type, amount, category,
        tag: type === 'income' ? 'Доход' : 'Разное',
        comment: comment,
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

// --- СЧЕТА ---
bot.hears('Счета', async (ctx) => {
    const { balances, accountsList } = await db.getBalances(ctx.from.id);
    let msg = `💳 *Ваши счета:*`;
    for (const acc of accountsList) {
        msg += `\n\n*${acc.name}*: ${formatAmount(balances[acc.name] || 0)}`;
        if (acc.is_deposit) msg += `\n🏦 _${acc.bank_name} (${acc.rate}%)_`;
    }
    const buttons = [[Markup.button.callback('➕ Новый депозит', 'btn_add_deposit')]];
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

module.exports = bot;

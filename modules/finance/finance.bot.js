const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config');
const { getMainMenu } = require('../utilities/menu.js');

const bot = new Composer();

// Хелперы
const formatAmount = (amount) => new Intl.NumberFormat('ru-RU').format(amount) + ' ' + config.CURRENCY;
const parseAmount = (text) => {
    const cleaned = text.replace(/[^0-9.,]/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
};

// --- 1. СТАРТ ВВОДА ---

// 1. ЛОГИКА ДОХОДОВ (Категория -> Сумма)
bot.hears(['📈 Доходы', 'Доход'], async (ctx) => {
    ctx.session.state = { type: 'income', step: 'INCOME_CATEGORY' };
    
    // Предлагаем категории сразу
    // Можно добавить их в config или брать из базы.
    // Пока захардкодим основные + Другое, как ты просил.
    const buttons = [
        ['Репетиторство', 'Стипендия'],
        ['Зарплата', 'Подарок'],
        ['Другое'],
        ['❌ Отмена']
    ];
    
    await ctx.reply('💰 Выберите источник дохода:', Markup.keyboard(buttons).resize());
});

// 2. ЛОГИКА РАСХОДОВ (Сумма -> Коммент -> Кат)
bot.hears(['📉 Расходы', 'Расход'], async (ctx) => {
    ctx.session.state = { type: 'expense', step: 'EXPENSE_AMOUNT' };
    await ctx.reply('💸 Введите сумму расхода:', Markup.keyboard([['❌ Отмена']]).resize());
});

// --- 2. МАШИНА СОСТОЯНИЙ ---
bot.on('text', async (ctx, next) => {
    const state = ctx.session.state || {};
    const text = ctx.message.text.trim();

    // Глобальная отмена
    if (text === '❌ Отмена' || text === '/cancel') {
        ctx.session.state = {};
        const menu = await getMainMenu(ctx.from.id);
        return ctx.reply('Отменено.', menu);
    }

    // Если стейта нет, это не к нам
    if (!state.type) return next();

    // ---------------------------------------
    // ОБРАБОТКА ДОХОДОВ
    // ---------------------------------------
    if (state.type === 'income') {
        
        // ШАГ 1: Выбор категории
        if (state.step === 'INCOME_CATEGORY') {
            const category = text;
            state.category = category;

            // ПРЕСЕТЫ СУММ
            if (category === 'Репетиторство') {
                // Берем цену урока из конфига
                await saveTransaction(ctx, 'income', config.LESSON_PRICE, category, 'Урок');
                return;
            }
            if (category === 'Стипендия') {
                // Допустим, стипендия фиксированная. Если нет в конфиге - 41000 (пример) или спросить.
                // Давай пока спросим или возьмем из конфига если есть.
                const scholarship = config.SCHOLARSHIP || 0; 
                if (scholarship > 0) {
                    await saveTransaction(ctx, 'income', scholarship, category, 'Стипендия');
                    return;
                }
                // Если суммы нет - идем спрашивать
            }

            // Если категория "Другое" или сумма не фиксирована
            state.step = 'INCOME_AMOUNT';
            await ctx.reply('💰 Введите сумму дохода:', Markup.keyboard([['❌ Отмена']]).resize());
            return;
        }

        // ШАГ 2: Ввод суммы (если не пресет)
        if (state.step === 'INCOME_AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('Введите число.');
            
            await saveTransaction(ctx, 'income', amount, state.category || 'Другое', 'Доход');
            return;
        }
    }

    // ---------------------------------------
    // ОБРАБОТКА РАСХОДОВ
    // ---------------------------------------
    if (state.type === 'expense') {
        
        // ШАГ 1: Сумма
        if (state.step === 'EXPENSE_AMOUNT') {
            const amount = parseAmount(text);
            if (!amount) return ctx.reply('Введите число.');
            state.amount = amount;
            state.step = 'EXPENSE_COMMENT';
            await ctx.reply('💬 На что? (Комментарий)', Markup.keyboard([['❌ Отмена']]).resize());
            return;
        }

        // ШАГ 2: Комментарий + Авто-категория
        if (state.step === 'EXPENSE_COMMENT') {
            state.comment = text;
            const predicted = await db.getCategoryByComment(text);
            
            if (predicted) {
                // Нашли -> сохраняем
                await saveTransaction(ctx, 'expense', state.amount, predicted, state.comment, true);
            } else {
                // Не нашли -> спрашиваем
                state.step = 'EXPENSE_CATEGORY';
                const cats = await db.getUserCategories(ctx.from.id, 'expense');
                const buttons = [];
                for (let i = 0; i < cats.length; i += 2) buttons.push(cats.slice(i, i + 2));
                buttons.push(['❌ Отмена']);
                await ctx.reply('📂 Выберите категорию:', Markup.keyboard(buttons).resize());
            }
            return;
        }

        // ШАГ 3: Ручной выбор категории
        if (state.step === 'EXPENSE_CATEGORY') {
            await saveTransaction(ctx, 'expense', state.amount, text, state.comment, false);
            // Обучаем
            await db.learnKeyword(state.comment, text);
            return;
        }
    }

    return next();
});

// --- ФУНКЦИЯ СОХРАНЕНИЯ ---
async function saveTransaction(ctx, type, amount, category, comment, isAuto = false) {
    await db.addTransaction({
        userId: ctx.from.id,
        type: type,
        amount: amount,
        category: category,
        tag: type === 'income' ? 'Доход' : 'Разное',
        comment: comment,
        sourceAccount: type === 'expense' ? 'Основной' : null,
        targetAccount: type === 'income' ? 'Основной' : null
    });

    const { balances } = await db.getBalances(ctx.from.id);
    const sign = type === 'income' ? '+' : '-';
    const menu = await getMainMenu(ctx.from.id); // <-- ИСПОЛЬЗУЕМ ОБЩЕЕ МЕНЮ

    const msg = `✅ *${type === 'income' ? 'Доход' : 'Расход'} записан:*\n` +
                `${sign}${formatAmount(amount)} — ${category}\n` +
                `${comment ? `_(${comment})_` : ''}\n` +
                `💰 Баланс: ${formatAmount(balances['Основной'])}`;

    await ctx.reply(msg, { parse_mode: 'Markdown', ...menu });
    ctx.session.state = {};
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

// --- НОВЫЕ КОМАНДЫ ---

// 1. UNDO (Отмена последней записи)
bot.command('undo', async (ctx) => {
    // Ищем последнюю транзакцию
    const last = await db.dbGet(
        'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [ctx.from.id]
    );

    if (!last) return ctx.reply('Нет операций для отмены.');

    // Удаляем
    await db.dbRun('DELETE FROM transactions WHERE id = ?', [last.id]);
    
    // Обновляем баланс для вывода
    const { balances } = await db.getBalances(ctx.from.id);
    
    ctx.reply(
        `↩️ *Отменено:*\n${last.type === 'income' ? '+' : '-'}${formatAmount(last.amount)} — ${last.category}\n💰 Баланс: ${formatAmount(balances['Основной'])}`,
        { parse_mode: 'Markdown' }
    );
});

// 2. УПРАВЛЕНИЕ КАТЕГОРИЯМИ
bot.command('categories', async (ctx) => {
    const expenses = await db.getUserCategories(ctx.from.id, 'expense');
    const incomes = await db.getUserCategories(ctx.from.id, 'income');
    
    let msg = '*📂 Ваши категории:*\n\n📉 *Расходы:*\n' + expenses.join(', ') + '\n\n📈 *Доходы:*\n' + incomes.join(', ');
    msg += '\n\nЧтобы добавить, пишите: `/add_cat Расход Бензин`';
    
    ctx.replyWithMarkdown(msg);
});

// Добавление: /add_cat Расход Бензин
bot.hears(/^\/add_cat\s+(Расход|Доход)\s+(.+)$/i, async (ctx) => {
    const type = ctx.match[1].toLowerCase() === 'расход' ? 'expense' : 'income';
    const name = ctx.match[2].trim();
    
    await db.addCategory(ctx.from.id, type, name);
    ctx.reply(`✅ Категория "${name}" добавлена в ${type === 'expense' ? 'Расходы' : 'Доходы'}.`);
});

module.exports = bot;

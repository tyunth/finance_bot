const { Telegraf, Markup, session } = require('telegraf');
const fs = require('fs');
require('dotenv').config();

// Импорт модулей
const config = require('./config');
const db = require('./db');
const kb = require('./keyboards');
const gcal = require('./calendar');

// ---------------- UTILS ----------------

function formatAmount(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) return `0 ${config.CURRENCY}`;
    return `${amount.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${config.CURRENCY}`;
}

function parseAmount(text) {
    const cleaned = text.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
    const amount = parseFloat(cleaned);
    return isNaN(amount) ? null : Math.abs(amount);
}

function formatTransactionRow(t) {
    let dir = t.type === 'income' ? 'ДОХОД' : (t.type === 'expense' ? 'РАСХОД' : 'ПЕРЕВОД');
    const date = new Date(t.date).toLocaleDateString('ru-RU');
    return `ID: ${t.id} | ${dir} ${formatAmount(t.amount)}\nКат: ${t.category || '-'} | Комм: ${t.comment || '-'}\nДата: ${date}`;
}

function parseDate(text) {
    const parts = text.split('.');
    if (parts.length < 2) return null;
    let day = parseInt(parts[0]), month = parseInt(parts[1]) - 1;
    let year = parts.length === 3 ? parseInt(parts[2]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    const date = new Date(year, month, day);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

// ---------------- BOT SETUP ----------------
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());
bot.use((ctx, next) => {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.state) ctx.session.state = {};
    return next();
});

// ---------------- CALENDAR POLLING LOGIC ----------------

/**
 * Запускает проверку календаря.
 * @param {object} ctx - Контекст Telegraf (если вызвано вручную) или null (если по таймеру)
 */
async function runCalendarCheck(ctx = null) {
    const adminId = config.ADMIN_ID || (ctx ? ctx.from.id : null);
    
    if (!adminId) {
        console.log('Admin ID не задан, проверка календаря невозможна.');
        return;
    }

    // Функция для отправки логов (только в консоль при авто-режиме)
    const log = async (msg) => {
        console.log(msg);
        if (ctx) { 
            // Если запуск ручной - шлем в чат тихо
            await ctx.reply(`⚙️ ${msg}`, { disable_notification: true });
        }
    };

    try {
        const events = await gcal.getRecentLessons(log);
        
        if (events.length === 0) {
            return;
        }
        
        for (const event of events) {
            // Пропускаем, если уже обработали
            const processed = await db.isEventProcessed(event.id);
            if (processed) {
                await log(`-- Событие "${event.summary}" уже было обработано ранее.`);
                continue;
            }

            const summary = event.summary;
            const { studentName, subject } = gcal.parseLessonInfo(summary);
            const amount = config.LESSON_PRICE;

            // Отправляем интерактивное уведомление
            await bot.telegram.sendMessage(adminId, 
                `🔔 **Урок завершен:** ${summary}\n` +
                `Студент: ${studentName}\n` +
                `Предмет: ${subject}\n\n` +
                `Что делаем?`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(`✅ Был, оплачен (+${amount})`, `cal_paid_${event.id}`)],
                        [Markup.button.callback(`⏳ Был, не оплачен (Долг)`, `cal_debt_${event.id}`)],
                        [Markup.button.callback(`❌ Не было (Удалить)`, `cal_del_${event.id}`)]
                    ])
                }
            );
        }

    } catch (e) {
        console.error('Ошибка при проверке календаря:', e);
        if (e.message.includes('google_key.json')) {
             await bot.telegram.sendMessage(config.ADMIN_ID, `Ошибка календаря: ${e.message}`);
        }
    }
}

// Запускаем интервал проверки (каждые 15 минут)
setInterval(() => runCalendarCheck(), 15 * 60 * 1000);

// ---------------- HANDLERS ----------------

bot.start(async (ctx) => {
    ctx.session.state = {}; 
    await db.ensureMainAccount(ctx.from.id);
    await new Promise(r => setTimeout(r, 100));
    
    const { balances } = await db.getBalances(ctx.from.id);
    let msg = `Привет! Бот в строю.\n\nБалансы:`;
    for (const [name, bal] of Object.entries(balances)) {
        if (name === 'Основной' || bal > 0) msg += `\n${name}: ${formatAmount(bal)}`;
    }
    ctx.reply(msg, kb.MAIN_KEYBOARD);
    
    // Тихий запуск проверки при старте
    runCalendarCheck(); 
});

const HELP_MSG = `
Команды:
/day 05.12 - Траты за дату
/latest 10 - Последние транзакции
/debts - Список долгов учеников
/add_deposit - Добавить депозит
/delete_deposit - Удалить депозит
/edit ID - Редактировать запись
/delete ID - Удалить запись
/sync - Принудительная проверка календаря
`;

bot.hears('Помощь', (ctx) => ctx.reply(HELP_MSG, kb.MAIN_KEYBOARD));

// --- CALENDAR COMMANDS ---
bot.command('sync', (ctx) => runCalendarCheck(ctx));

// --- CALENDAR ACTIONS ---

bot.action(/cal_paid_(.+)/, async (ctx) => {
    const eventId = ctx.match[1];
    const msgLines = ctx.callbackQuery.message.text.split('\n');
    const summaryLine = msgLines.find(l => l.includes('Урок завершен:'));
    const summary = summaryLine ? summaryLine.split('Урок завершен:')[1].trim() : 'Урок';
    
    const { studentName, subject } = gcal.parseLessonInfo(summary);
    const amount = config.LESSON_PRICE;

    await db.addTransaction({
        userId: ctx.from.id,
        type: 'income',
        amount: amount,
        category: 'Репетиторство',
        tag: `Ученик: ${studentName}`,
        comment: `${subject} (${summary})`,
        sourceAccount: null,
        targetAccount: 'Основной'
    });

    await db.markEventProcessed(eventId, summary, 'paid');
    ctx.editMessageText(`✅ Урок "${summary}" оплачен. +${formatAmount(amount)}`);
});

bot.action(/cal_debt_(.+)/, async (ctx) => {
    const eventId = ctx.match[1];
    const msgLines = ctx.callbackQuery.message.text.split('\n');
    const summaryLine = msgLines.find(l => l.includes('Урок завершен:'));
    const summary = summaryLine ? summaryLine.split('Урок завершен:')[1].trim() : 'Урок';
    
    const { studentName, subject } = gcal.parseLessonInfo(summary);

    await db.addDebt(ctx.from.id, studentName, subject, config.LESSON_PRICE, eventId);
    await db.markEventProcessed(eventId, summary, 'debt');

    ctx.editMessageText(`⏳ Урок "${summary}" записан в долги.`);
});

bot.action(/cal_del_(.+)/, async (ctx) => {
    const eventId = ctx.match[1];
    const success = await gcal.deleteEvent(eventId);
    
    if (success) {
        await db.markEventProcessed(eventId, 'Deleted Event', 'cancelled');
        ctx.editMessageText(`❌ Событие удалено из календаря.`);
    } else {
        ctx.reply('Ошибка при удалении из календаря. Проверьте права сервисного аккаунта.');
    }
});

// --- ДОЛГИ ---
bot.command('debts', async (ctx) => {
    const debts = await db.getDebts(ctx.from.id);
    if (!debts.length) return ctx.reply('Долгов нет.', kb.MAIN_KEYBOARD);
    
    let msg = '*Неоплаченные уроки:*\n';
    const buttons = debts.map(d => [Markup.button.callback(`Оплачено: ${d.student_name} (${d.date.slice(0,10)})`, `pay_debt_${d.id}`)]);
    
    debts.forEach(d => {
        msg += `\n- ${d.student_name} (${d.subject}): ${formatAmount(d.amount)} от ${d.date.slice(0,10)}`;
    });
    
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

bot.action(/pay_debt_(.+)/, async (ctx) => {
    const debtId = ctx.match[1];
    const debt = await db.dbGet('SELECT * FROM debts WHERE id = ?', [debtId]);
    if (!debt) return ctx.reply('Не найдено.');

    await db.addTransaction({
        userId: ctx.from.id,
        type: 'income',
        amount: debt.amount,
        category: 'Репетиторство',
        tag: `Ученик: ${debt.student_name}`,
        comment: `Оплата долга за ${debt.date.slice(0,10)} (${debt.subject})`,
        sourceAccount: null,
        targetAccount: 'Основной'
    });

    await db.dbRun('UPDATE debts SET is_paid = 1 WHERE id = ?', [debtId]);
    ctx.editMessageText(`✅ Долг ${debt.student_name} оплачен!`);
});


// --- КОМАНДЫ (REGEX) ---

bot.hears(/^(?:\/)?day\s+(.+)$/i, async (ctx) => {
    const text = ctx.match[1];
    const dateStr = parseDate(text);
    if (!dateStr) return ctx.reply('Неверный формат. Пример: day 05.12');

    const rows = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? AND date LIKE ? ORDER BY date DESC', [ctx.from.id, `${dateStr}%`]);
    if (!rows.length) return ctx.reply(`Нет операций за ${dateStr}.`);
    
    const report = rows.map(r => formatTransactionRow(r)).join('\n\n');
    ctx.reply(`Операции за ${dateStr}:\n\n${report}`);
});

bot.hears(/^(?:\/)?latest(?:\s+(\d+))?$/i, async (ctx) => {
    const limit = parseInt(ctx.match[1]) || 10;
    const rows = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC LIMIT ?', [ctx.from.id, limit]);
    if (!rows.length) return ctx.reply('Нет записей.');
    const text = rows.map(r => "```\n" + formatTransactionRow(r) + "\n```").join("\n");
    ctx.replyWithMarkdown(`*Последние ${limit}:*\n${text}`);
});

bot.command('export', async (ctx) => {
    if (fs.existsSync(db.DB_PATH)) await ctx.replyWithDocument({ source: db.DB_PATH, filename: 'finance.db' });
    else ctx.reply('БД не найдена.');
});

// --- РЕДАКТИРОВАНИЕ И УДАЛЕНИЕ ---

const handleEdit = async (ctx, text) => {
    const parts = text.split(/\s+/);
    const txId = parseInt(parts[1]); 
    if (isNaN(txId)) return ctx.reply('Укажите ID: edit 123');
    
    const t = await db.dbGet('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [txId, ctx.from.id]);
    if (!t) return ctx.reply('Не найдено.');

    const editType = t.type === 'income' ? 'edit_income' : 'edit_expense';

    ctx.session.state = {
        type: editType, 
        txId,
        step: config.STATE.EDIT_AWAITING_AMOUNT
    };
    ctx.reply(`Редактирование ID ${txId}.\nВведите новую сумму (или 0 чтобы оставить ${t.amount}):`, kb.BACK_KEYBOARD);
};

bot.command(['edit', 'editor'], (ctx) => handleEdit(ctx, ctx.message.text));
bot.hears(/^edit\s+(\d+)$/i, (ctx) => handleEdit(ctx, ctx.message.text));

const handleDelete = async (ctx, text) => {
    const parts = text.split(/\s+/);
    const txId = parseInt(parts[1]);
    if (isNaN(txId)) return ctx.reply('Укажите ID: delete 123');
    await db.dbRun('DELETE FROM transactions WHERE id = ? AND user_id = ?', [txId, ctx.from.id]);
    ctx.reply(`Запись ${txId} удалена.`);
};

bot.command('delete', (ctx) => handleDelete(ctx, ctx.message.text));
bot.hears(/^delete\s+(\d+)$/i, (ctx) => handleDelete(ctx, ctx.message.text));


// --- ДЕПОЗИТЫ ---

bot.command('add_deposit', (ctx) => {
    ctx.session.state = { step: config.STATE.AWAITING_DEPOSIT_NAME };
    ctx.reply('Название депозита:', kb.BACK_KEYBOARD);
});

const startDeleteDeposit = async (ctx) => {
    const list = await db.dbAll('SELECT name FROM accounts WHERE user_id = ? AND is_deposit = 1', [ctx.from.id]);
    if (!list.length) return ctx.reply('Нет депозитов.', kb.MAIN_KEYBOARD);
    
    ctx.session.state = { step: config.STATE.AWAITING_DEPOSIT_DELETION };
    const buttons = list.map(a => [a.name]);
    buttons.push(['Отмена']);
    ctx.reply('Выберите депозит для удаления:', Markup.keyboard(buttons).resize());
};

bot.command('delete_deposit', (ctx) => startDeleteDeposit(ctx));
bot.hears('delete_deposit', (ctx) => startDeleteDeposit(ctx));

// --- СЧЕТА ---
bot.hears('Счета', async (ctx) => {
    const { balances, accountsList } = await db.getBalances(ctx.from.id);
    let msg = `Ваши счета:`;
    for (const acc of accountsList) {
        msg += `\n\n${acc.name}: ${formatAmount(balances[acc.name] || 0)}`;
        if (acc.is_deposit) msg += `\nБанк: ${acc.bank_name || '-'}\nСтавка: ${acc.rate}%, до ${acc.term_date || '-'}`;
    }
    ctx.reply(msg, kb.ACCOUNTS_INLINE);
});

bot.hears('Отчеты', async (ctx) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    
    const rows = await db.dbAll(`SELECT type, amount FROM transactions WHERE user_id = ? AND date >= ?`, [ctx.from.id, startOfMonth]);
    let income = 0, expense = 0;
    rows.forEach(r => r.type === 'income' ? income += r.amount : (r.type === 'expense' ? expense += r.amount : 0));

    const catStats = await db.getCategoryStats(ctx.from.id, startOfMonth);
    let catMsg = '';
    Object.entries(catStats).sort(([,a], [,b]) => b - a).forEach(([cat, amt]) => catMsg += `\n${cat}: ${formatAmount(amt)}`);

    ctx.reply(`Отчет за текущий месяц:\n\nДоход: ${formatAmount(income)}\nРасход: ${formatAmount(expense)}\nИтого: ${formatAmount(income - expense)}\n\nПо категориям:${catMsg}`);
});

// --- ГЛАВНОЕ МЕНЮ ---

bot.hears('Доход', (ctx) => {
    ctx.session.state = { type: 'income', step: config.STATE.AWAITING_CATEGORY };
    ctx.reply('Категория дохода:', kb.generateReplyKeyboard(config.INCOME_CATEGORIES, true));
});

bot.hears('Расход', (ctx) => {
    ctx.session.state = { type: 'expense', step: config.STATE.AWAITING_EXPENSE_AMOUNT };
    ctx.reply('Сумма расхода:', kb.BACK_KEYBOARD);
});

bot.hears('Перевод', async (ctx) => {
    ctx.session.state = { type: 'transfer', step: config.STATE.AWAITING_TRANSFER_SOURCE };
    const keyb = await kb.generateAccountReplyKeyboard(db, ctx.from.id, null, false);
    ctx.reply('С какого счета переводим?', keyb);
});

// --- CALLBACKS ---
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    if (data === 'cancel_op') {
        ctx.session.state = {};
        return ctx.editMessageText('Отменено.');
    }
    if (data === 'btn_add_deposit') {
        ctx.session.state = { step: config.STATE.AWAITING_DEPOSIT_NAME };
        return ctx.reply('Название депозита:', kb.BACK_KEYBOARD);
    }
    if (data === 'btn_del_deposit') {
        return startDeleteDeposit(ctx);
    }
});

// --- TEXT HANDLER ---
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    
    const state = ctx.session.state;
    const userId = ctx.from.id;

    if (['Отмена', 'В меню'].includes(text)) {
        ctx.session.state = {};
        return ctx.reply('В меню.', kb.MAIN_KEYBOARD);
    }

    if (text === 'Назад') {
        if (state.step === config.STATE.AWAITING_EXPENSE_COMMENT) {
            state.step = config.STATE.AWAITING_EXPENSE_AMOUNT;
            return ctx.reply('Сумма расхода:', kb.BACK_KEYBOARD);
        }
        if (state.step === config.STATE.AWAITING_CATEGORY && state.type === 'expense') {
            state.step = config.STATE.AWAITING_EXPENSE_COMMENT;
            return ctx.reply('Комментарий:', kb.SKIP_COMMENT_KEYBOARD);
        }
        if (state.step === config.STATE.AWAITING_INCOME_AMOUNT) {
            state.step = config.STATE.AWAITING_CATEGORY;
            return ctx.reply('Категория дохода:', kb.generateReplyKeyboard(config.INCOME_CATEGORIES, true));
        }
        if (state.step === config.STATE.AWAITING_TRANSFER_TARGET) {
            state.step = config.STATE.AWAITING_TRANSFER_SOURCE;
            const keyb = await kb.generateAccountReplyKeyboard(db, userId, null, false);
            return ctx.reply('С какого счета?', keyb);
        }
        if (state.step === config.STATE.AWAITING_TRANSFER_AMOUNT) {
            state.step = config.STATE.AWAITING_TRANSFER_TARGET;
            const keyb = await kb.generateAccountReplyKeyboard(db, userId, state.sourceAccount, true);
            return ctx.reply('На какой счет?', keyb);
        }
        
        ctx.session.state = {};
        return ctx.reply('В меню.', kb.MAIN_KEYBOARD);
    }

    if (!state || !state.step) return ctx.reply('Используйте меню.', kb.MAIN_KEYBOARD);

    // --- УДАЛЕНИЕ ДЕПОЗИТА ---
    if (state.step === config.STATE.AWAITING_DEPOSIT_DELETION) {
        try {
            const acc = await db.dbGet('SELECT id FROM accounts WHERE name = ? AND user_id = ? AND is_deposit = 1', [text, userId]);
            if (!acc) return ctx.reply('Такой депозит не найден.');
            
            await db.dbRun('DELETE FROM accounts WHERE id = ?', [acc.id]);
            ctx.session.state = {};
            return ctx.reply(`Депозит "${text}" удален.`, kb.MAIN_KEYBOARD);
        } catch (e) {
            return ctx.reply('Ошибка удаления.');
        }
    }

    // --- ДЕПОЗИТ ---
    if (state.step === config.STATE.AWAITING_DEPOSIT_NAME) {
        state.depositName = text;
        state.step = config.STATE.AWAITING_DEPOSIT_BANK;
        return ctx.reply('Название банка:', kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_DEPOSIT_BANK) {
        state.depositBank = text;
        state.step = config.STATE.AWAITING_DEPOSIT_RATE;
        return ctx.reply('Процентная ставка (число):', kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_DEPOSIT_RATE) {
        const rate = parseFloat(text.replace(',', '.'));
        if (isNaN(rate)) return ctx.reply('Введите число.');
        state.depositRate = rate;
        state.step = config.STATE.AWAITING_DEPOSIT_TERM;
        return ctx.reply('Срок (например, 01.01.2025):', kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_DEPOSIT_TERM) {
        try {
            await db.dbRun('INSERT INTO accounts (user_id, name, is_deposit, rate, term_date, bank_name) VALUES (?, ?, 1, ?, ?, ?)',
                [userId, state.depositName, state.depositRate, text, state.depositBank]);
            ctx.session.state = {};
            return ctx.reply('Депозит создан.', kb.MAIN_KEYBOARD);
        } catch (e) { return ctx.reply('Ошибка. Такое имя уже есть.'); }
    }

    // --- ПЕРЕВОД ---
    if (state.step === config.STATE.AWAITING_TRANSFER_SOURCE) {
        const acc = await db.dbGet('SELECT * FROM accounts WHERE user_id = ? AND name = ?', [userId, text]);
        if (!acc) return ctx.reply('Выберите счет из меню.');
        state.sourceAccount = text;
        state.step = config.STATE.AWAITING_TRANSFER_TARGET;
        const keyb = await kb.generateAccountReplyKeyboard(db, userId, text, true);
        return ctx.reply(`Списано с: ${text}. Куда зачислить?`, keyb);
    }
    if (state.step === config.STATE.AWAITING_TRANSFER_TARGET) {
        const acc = await db.dbGet('SELECT * FROM accounts WHERE user_id = ? AND name = ?', [userId, text]);
        if (!acc) return ctx.reply('Выберите счет из меню.');
        state.targetAccount = text;
        state.step = config.STATE.AWAITING_TRANSFER_AMOUNT;
        return ctx.reply(`Перевод: ${state.sourceAccount} -> ${state.targetAccount}. Введите сумму:`, kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_TRANSFER_AMOUNT) {
        const amount = parseAmount(text);
        if (!amount) return ctx.reply('Введите число.');
        await db.addTransaction({ userId, type: 'transfer', amount, category: 'Перевод', tag: 'Перевод', comment: 'Перевод', sourceAccount: state.sourceAccount, targetAccount: state.targetAccount });
        ctx.session.state = {};
        return ctx.reply('Перевод выполнен.', kb.MAIN_KEYBOARD);
    }

    // --- РАСХОД ---
    if (state.step === config.STATE.AWAITING_EXPENSE_AMOUNT) {
        const amount = parseAmount(text);
        if (!amount) return ctx.reply('Число.');
        state.amount = amount;
        state.step = config.STATE.AWAITING_EXPENSE_COMMENT;
        return ctx.reply('Комментарий:', kb.SKIP_COMMENT_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_EXPENSE_COMMENT) {
        state.comment = text === 'Пропустить' ? '' : text;
        state.step = config.STATE.AWAITING_CATEGORY;
        return ctx.reply('Категория:', kb.generateReplyKeyboard(config.EXPENSE_CATEGORIES, true));
    }

    // --- ДОХОД ---
    if (state.step === config.STATE.AWAITING_INCOME_AMOUNT) {
        const amount = parseAmount(text);
        if (!amount) return ctx.reply('Число.');
        state.amount = amount;
        state.step = config.STATE.AWAITING_INCOME_COMMENT;
        return ctx.reply('Комментарий:', kb.SKIP_COMMENT_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_INCOME_COMMENT) {
        state.comment = text === 'Пропустить' ? '' : text;
        await db.addTransaction({
            userId, type: 'income', amount: state.amount, category: state.category, tag: 'Доход', comment: state.comment,
            sourceAccount: null, targetAccount: 'Основной'
        });
        const { balances } = await db.getBalances(userId);
        ctx.session.state = {};
        return ctx.reply(`Доход записан.\nБаланс (Основной): ${formatAmount(balances['Основной'])}`, kb.MAIN_KEYBOARD);
    }

    // --- КАТЕГОРИЯ ---
    if (state.step === config.STATE.AWAITING_CATEGORY) {
        const cat = text.split(' (')[0];
        const allCats = [...config.EXPENSE_CATEGORIES.flat(), ...config.INCOME_CATEGORIES.flat()].map(c => c.split(' (')[0]);
        if (allCats.includes(cat)) {
            state.category = cat;
            if (state.type === 'income' && config.FIXED_INCOME_AMOUNTS[cat]) {
                await db.addTransaction({ userId, type: 'income', amount: config.FIXED_INCOME_AMOUNTS[cat], category: cat, tag: 'Фиксированный', comment: 'Авто', sourceAccount: null, targetAccount: 'Основной' });
                const { balances } = await db.getBalances(userId);
                ctx.session.state = {};
                return ctx.reply(`Зачислено.\nБаланс (Основной): ${formatAmount(balances['Основной'])}`, kb.MAIN_KEYBOARD);
            }
            if (state.type === 'income') {
                state.step = config.STATE.AWAITING_INCOME_AMOUNT;
                return ctx.reply('Сумма:', kb.BACK_KEYBOARD);
            }
            if (state.type === 'expense') {
                const tag = config.AUTO_TAGS[cat] || 'Разное';
                await db.addTransaction({ userId, type: 'expense', amount: state.amount, category: cat, tag: tag, comment: state.comment, sourceAccount: 'Основной', targetAccount: null });
                ctx.session.state = {};
                return ctx.reply(`Расход записан: ${cat}`, kb.MAIN_KEYBOARD);
            }
        }
        return ctx.reply('Выберите категорию кнопкой.');
    }

    // --- РЕДАКТИРОВАНИЕ ---
    if (state.type && state.type.startsWith('edit_')) {
        const isExpenseEdit = state.type === 'edit_expense';
        const keyb = isExpenseEdit ? config.EXPENSE_CATEGORIES : config.INCOME_CATEGORIES;
        
        if (state.step === config.STATE.EDIT_AWAITING_AMOUNT) {
            const amount = parseAmount(text);
            if (amount === null && text !== '0') return ctx.reply('Число или 0.');
            if (amount !== null) state.amount = amount; 
            
            state.step = config.STATE.EDIT_AWAITING_COMMENT;
            return ctx.reply('Новый комментарий:', kb.SKIP_COMMENT_KEYBOARD);
        }
        if (state.step === config.STATE.EDIT_AWAITING_COMMENT) {
            state.comment = text === 'Пропустить' ? '' : text;
            state.step = config.STATE.EDIT_AWAITING_CATEGORY;
            return ctx.reply('Новая категория:', kb.generateReplyKeyboard(keyb));
        }
        if (state.step === config.STATE.EDIT_AWAITING_CATEGORY) {
            const cat = text.split(' (')[0];
            const tag = isExpenseEdit ? (config.AUTO_TAGS[cat] || 'Разное') : 'Доход';
            
            await db.dbRun('UPDATE transactions SET amount = ?, comment = ?, category = ?, tag = ? WHERE id = ?', 
                [state.amount, state.comment, cat, tag, state.txId]);
            
            ctx.session.state = {};
            return ctx.reply('Обновлено!', kb.MAIN_KEYBOARD);
        }
    }

    ctx.reply('Не понял.', kb.MAIN_KEYBOARD);
});

bot.launch().then(() => console.log('Бот работает'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
const { Telegraf, Markup, session } = require('telegraf');
const fs = require('fs');
require('dotenv').config();

// Импорт модулей
const config = require('./config');
const db = require('./db');
const kb = require('./keyboards');
const gcal = require('./calendar');
const ocr = require('./ocr_service'); 

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

function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[*_`\[\]()]/g, ''); 
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

// ---------------- CALENDAR POLLING ----------------

async function runCalendarCheck(ctx = null) {
    const adminId = config.ADMIN_ID || (ctx ? ctx.from.id : null);
    
    if (!adminId) {
        console.log('Admin ID не задан, проверка календаря невозможна.');
        return;
    }

    const log = async (msg) => {
        console.log(msg);
        if (ctx) await ctx.reply(`LOG: ${msg}`, { disable_notification: true });
    };

    try {
        const events = await gcal.getRecentLessons(log);
        
        if (events.length === 0) return;
        
        for (const event of events) {
            const processed = await db.isEventProcessed(event.id);
            if (processed) {
                await log(`-- Событие "${event.summary}" уже было обработано.`);
                continue;
            }

            const summary = event.summary;
            const { studentName, subject } = gcal.parseLessonInfo(summary);
            const amount = config.LESSON_PRICE;

            await bot.telegram.sendMessage(adminId, 
                `Урок завершен: ${summary}\n` +
                `Студент: ${studentName}\n` +
                `Предмет: ${subject}\n\n` +
                `Что делаем?`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(`Был, оплачен (+${amount})`, `cal_paid_${event.id}`)],
                        [Markup.button.callback(`Был, не оплачен (Долг)`, `cal_debt_${event.id}`)],
                        [Markup.button.callback(`Не было (Удалить)`, `cal_del_${event.id}`)]
                    ])
                }
            );
			await db.markEventProcessed(event.id, summary, 'pending');
        }
    } catch (e) {
        console.error('Ошибка при проверке календаря:', e);
        if (e.message.includes('google_key.json')) {
             await bot.telegram.sendMessage(config.ADMIN_ID, `Ошибка календаря: ${e.message}`);
        }
    }
}

// Проверка раз в 15 минут
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
    runCalendarCheck(); 
});

const HELP_MSG = `
Команды:
/show - Показать сырой текст последнего чека
/day 05.12 - Траты за дату
/latest 10 - Последние транзакции
/debts - Список долгов учеников
/add_deposit - Добавить депозит
/delete_deposit - Удалить депозит
/edit ID - Редактировать запись
/delete ID - Удалить запись
/sync - Проверить календарь вручную
/export - скачать базу данных
`;

bot.hears('Помощь', (ctx) => ctx.reply(HELP_MSG, kb.MAIN_KEYBOARD));

// --- COMMANDS ---
bot.command('sync', (ctx) => runCalendarCheck(ctx));

bot.command('show', (ctx) => {
    const raw = ctx.session.receipt ? ctx.session.receipt.rawText : 'Нет сохраненного текста чека. Отправьте фото сначала.';
    if (raw.length > 4000) {
         return ctx.replyWithDocument({ source: Buffer.from(raw), filename: 'receipt.txt' });
    }
    return ctx.reply(raw);
});

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

// --- EDIT & DELETE ---
const handleEdit = async (ctx, text) => {
    const parts = text.split(/\s+/);
    const txId = parseInt(parts[1]); 
    if (isNaN(txId)) return ctx.reply('Укажите ID: edit 123');
    const t = await db.dbGet('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [txId, ctx.from.id]);
    if (!t) return ctx.reply('Не найдено.');
    const editType = t.type === 'income' ? 'edit_income' : 'edit_expense';
    ctx.session.state = { type: editType, txId, step: config.STATE.EDIT_AWAITING_AMOUNT };
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

// --- DEPOSITS ---
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

// --- DEBTS ---
bot.command('debts', async (ctx) => {
    const debts = await db.getDebts(ctx.from.id);
    if (!debts.length) return ctx.reply('Долгов нет.', kb.MAIN_KEYBOARD);
    
    let msg = '*Неоплаченные уроки:*\n';
    
    // ИЗМЕНЕНИЕ: Теперь создаем по 2 кнопки на каждый долг (Оплатить и Простить)
    const buttons = debts.map(d => [
        Markup.button.callback(`Оплатить`, `pay_debt_${d.id}`),
        Markup.button.callback(`Простить`, `cancel_debt_${d.id}`)
    ]);

    debts.forEach(d => { msg += `\n- ${d.student_name} (${d.subject}): ${formatAmount(d.amount)} от ${d.date.slice(0,10)}`; });
    
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

// --- MENU ACTIONS ---
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

// --- CALLBACK QUERIES ---
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    if (data === 'cancel_op') { ctx.session.state = {}; return ctx.editMessageText('Отменено.'); }
    if (data === 'btn_add_deposit') { ctx.session.state = { step: config.STATE.AWAITING_DEPOSIT_NAME }; return ctx.reply('Название депозита:', kb.BACK_KEYBOARD); }
    if (data === 'btn_del_deposit') { return startDeleteDeposit(ctx); }
    
    if (data === 'show_raw_ocr') {
        const raw = ctx.session.receipt ? ctx.session.receipt.rawText : 'Текст не сохранен.';
        return ctx.reply(raw.substring(0, 4000));
    }

    // Календарь
    if (data.startsWith('cal_')) {
        const eventId = data.split('_')[2]; 
        const action = data.split('_')[1]; 
        
        if (action === 'del') {
            const success = await gcal.deleteEvent(eventId);
            if (success) {
                await db.markEventProcessed(eventId, 'Deleted', 'cancelled');
                return ctx.editMessageText('Событие удалено.');
            } else return ctx.reply('Ошибка удаления.');
        }

        const msgLines = ctx.callbackQuery.message.text.split('\n');
        const summaryLine = msgLines.find(l => l.includes('Урок завершен:'));
        const summary = summaryLine ? summaryLine.split('Урок завершен:')[1].trim() : 'Урок';
        const { studentName, subject } = gcal.parseLessonInfo(summary);

        if (action === 'paid') {
            await db.addTransaction({
                userId: ctx.from.id, type: 'income', amount: config.LESSON_PRICE, category: 'Репетиторство',
                tag: `Ученик: ${studentName}`, comment: `${subject} (${summary})`, sourceAccount: null, targetAccount: 'Основной'
            });
            await db.markEventProcessed(eventId, summary, 'paid');
            return ctx.editMessageText(`Оплачено: ${summary}`);
        }
        if (action === 'debt') {
            await db.addDebt(ctx.from.id, studentName, subject, config.LESSON_PRICE, eventId);
            await db.markEventProcessed(eventId, summary, 'debt');
            return ctx.editMessageText(`В долги: ${summary}`);
        }
    }

    if (data.startsWith('pay_debt_')) {
        const debtId = data.replace('pay_debt_', '');
        const debt = await db.dbGet('SELECT * FROM debts WHERE id = ?', [debtId]);
        if (!debt) return ctx.reply('Не найдено.');
        await db.addTransaction({
            userId: ctx.from.id, type: 'income', amount: debt.amount, category: 'Репетиторство',
            tag: `Ученик: ${debt.student_name}`, comment: `Оплата долга (${debt.subject})`, sourceAccount: null, targetAccount: 'Основной'
        });
        await db.dbRun('UPDATE debts SET is_paid = 1 WHERE id = ?', [debtId]);
        return ctx.editMessageText(`Долг ${debt.student_name} оплачен!`);
    }
	if (data.startsWith('cancel_debt_')) {
        const debtId = data.replace('cancel_debt_', '');
        // Удаляем долг из базы
        await db.dbRun('DELETE FROM debts WHERE id = ?', [debtId]);
        return ctx.editMessageText(`Долг удален (прощен).`);
    }
});

// --- PHOTO HANDLER (OCR) ---
bot.on('photo', async (ctx) => {
    try {
        ctx.reply('🔍 Анализирую чек...');
        const photo = ctx.message.photo.pop();
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        
        const response = await fetch(fileLink.href);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const receiptData = await ocr.parseReceipt(buffer);
        
        ctx.session.receipt = {
            rawText: receiptData.rawText,
            shopName: receiptData.shopName || 'Unknown',
            address: receiptData.address,
            date: receiptData.date,
            items: [],
            currentIndex: 0,
            totalSum: receiptData.total || 0,
			totalWarning: receiptData.totalWarning
        };

        if (receiptData.error || !receiptData.items || receiptData.items.length === 0) {
             return ctx.reply('Товары не найдены или ошибка.', Markup.inlineKeyboard([
                 Markup.button.callback('Показать сырой текст (Debug)', 'show_raw_ocr')
             ]));
        }

        const itemsToProcess = [];
        for (const item of receiptData.items) {
            let category = await db.getProductCategory(item.name);
            if (!category) {
                const shopKey = Object.keys(config.SHOP_MAPPINGS).find(key => 
                    receiptData.shopName.toLowerCase().includes(key.toLowerCase())
                );
                if (shopKey) category = config.SHOP_MAPPINGS[shopKey];
            }
            item.category = category; 
            itemsToProcess.push(item);
        }

        ctx.session.receipt.items = itemsToProcess;
        await processNextReceiptItem(ctx);

    } catch (e) {
        console.error(e);
        ctx.reply('Ошибка обработки фото.');
    }
});

async function processNextReceiptItem(ctx) {
    const receipt = ctx.session.receipt;
    const itemIndex = receipt.items.findIndex(i => !i.category);
    
    if (itemIndex === -1) return finalizeReceipt(ctx);

    const item = receipt.items[itemIndex];
    ctx.session.state = { step: 'AWAITING_RECEIPT_CATEGORY', currentItemIndex: itemIndex };

    const msg = `**${escapeMarkdown(receipt.shopName)}**\nТовар: **${escapeMarkdown(item.name)}**\nЦена: ${formatAmount(item.price)}\n\nКатегория?`;
    await ctx.replyWithMarkdown(msg, kb.generateReplyKeyboard(config.EXPENSE_CATEGORIES));
}

async function finalizeReceipt(ctx) {
    const receipt = ctx.session.receipt;
    const grouped = {};
    for (const item of receipt.items) {
        if (!grouped[item.category]) grouped[item.category] = { sum: 0, items: [] };
        grouped[item.category].sum += item.price;
        grouped[item.category].items.push(item);
    }

    const displayDate = new Date(receipt.date).toLocaleDateString('ru-RU');
    let reportMsg = `**Чек из ${escapeMarkdown(receipt.shopName)}** (${displayDate})\n`;
    if (receipt.address) reportMsg += `Адрес: ${escapeMarkdown(receipt.address)}\n\n`;
	if (receipt.totalWarning) {
        reportMsg += `\n${receipt.totalWarning}\n`;
    }
    reportMsg += `\n`;
    for (const [category, data] of Object.entries(grouped)) {
        const tag = config.AUTO_TAGS[category] || 'Разное';
        const itemNames = data.items.map(i => escapeMarkdown(i.name)).join(', ');
        const addrSuffix = receipt.address ? ` (${escapeMarkdown(receipt.address)})` : '';
        const comment = `Чек ${escapeMarkdown(receipt.shopName)}: ${itemNames.substring(0, 30)}...${addrSuffix}`;

        const result = await db.addTransaction({
            userId: ctx.from.id,
            type: 'expense',
            amount: data.sum,
            category: category,
            tag: tag,
            comment: comment,
            sourceAccount: 'Основной',
            targetAccount: null,
            date: receipt.date 
        });
        
        if (result.lastID) await db.saveReceiptItems(result.lastID, receipt.shopName, data.items, receipt.date);
        reportMsg += `- ${category}: ${formatAmount(data.sum)}\n`;
    }
    
    const { balances } = await db.getBalances(ctx.from.id);
    reportMsg += `\nБаланс: ${formatAmount(balances['Основной'])}`;
    
    const debugKeyboard = Markup.inlineKeyboard([
        Markup.button.callback('Показать сырой текст (Debug)', 'show_raw_ocr')
    ]);

    delete ctx.session.receipt;
    ctx.session.state = {};
    await ctx.replyWithMarkdown(reportMsg, debugKeyboard);
}

// --- TEXT HANDLER ---
async function handleStandardTextFlow(ctx) {
    const text = ctx.message.text.trim();
    const state = ctx.session.state;
    const userId = ctx.from.id;

    if (!state || !state.step) return ctx.reply('Используйте меню.', kb.MAIN_KEYBOARD);
    if (text === 'Назад') return goBack(ctx);

    // УДАЛЕНИЕ ДЕПОЗИТА
    if (state.step === config.STATE.AWAITING_DEPOSIT_DELETION) {
        try {
            const acc = await db.dbGet('SELECT id FROM accounts WHERE name = ? AND user_id = ? AND is_deposit = 1', [text, userId]);
            if (!acc) return ctx.reply('Такой депозит не найден.');
            await db.dbRun('DELETE FROM accounts WHERE id = ?', [acc.id]);
            ctx.session.state = {};
            return ctx.reply(`Депозит "${text}" удален.`, kb.MAIN_KEYBOARD);
        } catch (e) { return ctx.reply('Ошибка.'); }
    }

    // ДЕПОЗИТ (СОЗДАНИЕ)
    if (state.step === config.STATE.AWAITING_DEPOSIT_NAME) {
        state.depositName = text;
        state.step = config.STATE.AWAITING_DEPOSIT_BANK;
        return ctx.reply('Название банка:', kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_DEPOSIT_BANK) {
        state.depositBank = text;
        state.step = config.STATE.AWAITING_DEPOSIT_RATE;
        return ctx.reply('Процентная ставка:', kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_DEPOSIT_RATE) {
        const rate = parseFloat(text.replace(',', '.'));
        if (isNaN(rate)) return ctx.reply('Число.');
        state.depositRate = rate;
        state.step = config.STATE.AWAITING_DEPOSIT_TERM;
        return ctx.reply('Срок (31.12.2025):', kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_DEPOSIT_TERM) {
        try {
            await db.dbRun('INSERT INTO accounts (user_id, name, is_deposit, rate, term_date, bank_name) VALUES (?, ?, 1, ?, ?, ?)',
                [userId, state.depositName, state.depositRate, text, state.depositBank]);
            ctx.session.state = {};
            return ctx.reply('Депозит создан.', kb.MAIN_KEYBOARD);
        } catch (e) { return ctx.reply('Имя занято.'); }
    }

    // ПЕРЕВОД
    if (state.step === config.STATE.AWAITING_TRANSFER_SOURCE) {
        const acc = await db.dbGet('SELECT * FROM accounts WHERE user_id = ? AND name = ?', [userId, text]);
        if (!acc) return ctx.reply('Выберите счет из меню.');
        state.sourceAccount = text;
        state.step = config.STATE.AWAITING_TRANSFER_TARGET;
        const keyb = await kb.generateAccountReplyKeyboard(db, userId, text, true);
        return ctx.reply(`Списано с: ${text}. Куда?`, keyb);
    }
    if (state.step === config.STATE.AWAITING_TRANSFER_TARGET) {
        const acc = await db.dbGet('SELECT * FROM accounts WHERE user_id = ? AND name = ?', [userId, text]);
        if (!acc) return ctx.reply('Выберите счет из меню.');
        state.targetAccount = text;
        state.step = config.STATE.AWAITING_TRANSFER_AMOUNT;
        return ctx.reply(`Перевод: ${state.sourceAccount} -> ${state.targetAccount}. Сумма:`, kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_TRANSFER_AMOUNT) {
        const amount = parseAmount(text);
        if (!amount) return ctx.reply('Введите число.');
        await db.addTransaction({ userId, type: 'transfer', amount, category: 'Перевод', tag: 'Перевод', comment: 'Перевод', sourceAccount: state.sourceAccount, targetAccount: state.targetAccount });
        ctx.session.state = {};
        return ctx.reply('Перевод выполнен.', kb.MAIN_KEYBOARD);
    }

    // РАСХОД
    if (state.step === config.STATE.AWAITING_EXPENSE_AMOUNT) {
        const amount = parseAmount(text);
        if (!amount) return ctx.reply('Число.');
        state.amount = amount;
        state.step = config.STATE.AWAITING_EXPENSE_COMMENT;
        return ctx.reply('Комментарий:', kb.SKIP_COMMENT_KEYBOARD);
    }
    
    // --- ИЗМЕНЕНИЯ ТУТ: ПРОВЕРКА КОММЕНТАРИЯ НА АВТО-КАТЕГОРИЮ ---
    if (state.step === config.STATE.AWAITING_EXPENSE_COMMENT) {
        state.comment = text === 'Пропустить' ? '' : text;
        
        // 1. Пробуем найти категорию по слову
        const autoCategory = await db.getCategoryByComment(state.comment);

        if (autoCategory) {
            // Если узнали — сохраняем сразу!
            const tag = config.AUTO_TAGS[autoCategory] || 'Разное';
            await db.addTransaction({ 
                userId, type: 'expense', amount: state.amount, category: autoCategory, 
                tag: tag, comment: state.comment, sourceAccount: 'Основной', targetAccount: null 
            });
            
            ctx.session.state = {};
            const { balances } = await db.getBalances(userId);
            return ctx.reply(
                `🧠 Узнал "${escapeMarkdown(state.comment)}"! Записал в "${autoCategory}".\nБаланс: ${formatAmount(balances['Основной'])}`, 
                kb.MAIN_KEYBOARD
            );
        }

        state.step = config.STATE.AWAITING_CATEGORY;
        return ctx.reply('Категория:', kb.generateReplyKeyboard(config.EXPENSE_CATEGORIES, true));
    }

    // ДОХОД
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

    // КАТЕГОРИЯ
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
                
                // --- ИЗМЕНЕНИЯ ТУТ: ОБУЧЕНИЕ ---
                if (state.comment && state.comment.length > 0) {
                    await db.learnKeyword(state.comment, cat);
                }

                await db.addTransaction({ userId, type: 'expense', amount: state.amount, category: cat, tag: tag, comment: state.comment, sourceAccount: 'Основной', targetAccount: null });
                ctx.session.state = {};
                return ctx.reply(`Расход записан: ${cat}`, kb.MAIN_KEYBOARD);
            }
        }
        return ctx.reply('Выберите категорию кнопкой.');
    }

    // РЕДАКТИРОВАНИЕ
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
}

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    
    if (text === 'Отмена') {
        ctx.session.state = {};
        delete ctx.session.receipt;
        return ctx.reply('Отменено.', kb.MAIN_KEYBOARD);
    }

    if (ctx.session.state && ctx.session.state.step === 'AWAITING_RECEIPT_CATEGORY' && ctx.session.receipt) {
        const catClean = text.split(' (')[0];
        const allCats = config.EXPENSE_CATEGORIES.flat();
        
        if (allCats.includes(catClean)) {
            const itemIndex = ctx.session.state.currentItemIndex;
            const item = ctx.session.receipt.items[itemIndex];
            await db.learnProductCategory(item.name, catClean);
            ctx.session.receipt.items[itemIndex].category = catClean;
            ctx.reply(`Запомнил: "${escapeMarkdown(item.name)}" -> ${catClean}`);
            return processNextReceiptItem(ctx);
        } else {
            return ctx.reply('Выберите категорию из кнопок.');
        }
    }

    handleStandardTextFlow(ctx);
});

async function goBack(ctx) {
    const state = ctx.session.state;
    ctx.session.state = {};
    return ctx.reply('В меню.', kb.MAIN_KEYBOARD);
}

bot.launch().then(() => {
    console.log('Бот работает');
    console.log('helloworld');
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

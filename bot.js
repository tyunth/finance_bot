const { Telegraf, Markup, session } = require('telegraf');
const fs = require('fs');
const cron = require('node-cron'); // <--- ДОБАВЛЕНО
const axios = require('axios');    // <--- ДОБАВЛЕНО
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
let lastNotifiedMonth = null; 
let lastBackupDate = null;

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
        console.log('Admin ID не задан.');
        return;
    }

    const log = async (msg) => {
        console.log(msg);
        if (ctx) await ctx.reply(`LOG: ${msg}`, { disable_notification: true });
    };

    try {
        const events = await gcal.getRecentLessons(log);
        if (events.length === 0) return;

        // 1. Получаем список имен учеников из базы
        const students = await db.getStudents();
        const studentNames = students.map(s => s.name);
        // Добавляем ключевые слова
        const keywords = [...studentNames, 'Тест', 'Пробный', 'Урок', 'Занятие'];

        for (const event of events) {
            const processed = await db.isEventProcessed(event.id);
            if (processed) continue;

            const summary = event.summary;
            
            // 2. Фильтрация: Проверяем, есть ли в названии события ключевое слово
            const isRelevant = keywords.some(key => summary.toLowerCase().includes(key.toLowerCase()));
            
            if (!isRelevant) {
                // Если событие не про учеников - пропускаем (можно раскомментировать лог для отладки)
                // await log(`Пропуск события: ${summary}`);
                continue;
            }

            const { studentName, subject } = gcal.parseLessonInfo(summary);
            const amount = config.LESSON_PRICE;

            await bot.telegram.sendMessage(adminId, 
                `Урок завершен: ${summary}\nСтудент: ${studentName}\nПредмет: ${subject}\n\nЧто делаем?`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(`Был, оплачен (+${amount})`, `cal_paid_${event.id}`)],
                        [Markup.button.callback(`Был, не оплачен (Долг)`, `cal_debt_${event.id}`)],
                        [Markup.button.callback(`Отмена/Удалить`, `cal_cancel_menu_${event.id}`)]
                    ])
                }
            );
            await db.markEventProcessed(event.id, summary, 'pending');
        }
    } catch (e) {
        console.error('Ошибка календаря:', e);
        if (e.message.includes('google_key.json')) await bot.telegram.sendMessage(config.ADMIN_ID, `Ошибка календаря: ${e.message}`);
    }
}

// ---------------- HANDLERS (REFACTORED) ----------------

// 1. Депозиты: Удаление
async function handleDepositDeletion(ctx) {
    const text = ctx.message.text.trim();
    try {
        const acc = await db.dbGet('SELECT id FROM accounts WHERE name = ? AND user_id = ? AND is_deposit = 1', [text, ctx.from.id]);
        if (!acc) return ctx.reply('Такой депозит не найден.');
        await db.dbRun('DELETE FROM accounts WHERE id = ?', [acc.id]);
        ctx.session.state = {};
        return ctx.reply(`Депозит "${text}" удален.`, kb.MAIN_KEYBOARD);
    } catch (e) { return ctx.reply('Ошибка.'); }
}

// 2. Депозиты: Создание
async function handleDepositCreation(ctx) {
    const text = ctx.message.text.trim();
    const state = ctx.session.state;
    const userId = ctx.from.id;

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
        if (isNaN(rate)) return ctx.reply('Введите число.');
        state.depositRate = rate;
        state.step = config.STATE.AWAITING_DEPOSIT_AMOUNT;
        return ctx.reply('Начальная сумма вклада:', kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_DEPOSIT_AMOUNT) {
        const amount = parseAmount(text);
        if (amount === null) return ctx.reply('Введите число.');
        state.depositAmount = amount;
        state.step = config.STATE.AWAITING_DEPOSIT_TERM;
        return ctx.reply('Дата окончания (например: 31.12.2025):', kb.BACK_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_DEPOSIT_TERM) {
        try {
            const startDate = new Date().toISOString();
            await db.dbRun(
                'INSERT INTO accounts (user_id, name, is_deposit, rate, term_date, bank_name, start_date) VALUES (?, ?, 1, ?, ?, ?, ?)',
                [userId, state.depositName, state.depositRate, text, state.depositBank, startDate]
            );
            if (state.depositAmount > 0) {
                await db.addTransaction({
                    userId, type: 'income', amount: state.depositAmount, category: 'Депозит', tag: 'Депозит', 
                    comment: 'Открытие вклада (Начальный остаток)', sourceAccount: null, targetAccount: state.depositName
                });
            }
            ctx.session.state = {};
            return ctx.reply(`Депозит "${state.depositName}" создан.\nСумма: ${formatAmount(state.depositAmount)}\nСтавка: ${state.depositRate}%`, kb.MAIN_KEYBOARD);
        } catch (e) { console.error(e); return ctx.reply('Ошибка: возможно, такое имя уже есть.'); }
    }
}

// 3. Переводы
async function handleTransfer(ctx) {
    const text = ctx.message.text.trim();
    const state = ctx.session.state;
    const userId = ctx.from.id;

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
}

// 4. Расходы
async function handleExpense(ctx) {
    const text = ctx.message.text.trim();
    const state = ctx.session.state;
    const userId = ctx.from.id;

    if (state.step === config.STATE.AWAITING_EXPENSE_AMOUNT) {
        const amount = parseAmount(text);
        if (!amount) return ctx.reply('Число.');
        state.amount = amount;
        state.step = config.STATE.AWAITING_EXPENSE_COMMENT;
        return ctx.reply('Комментарий:', kb.SKIP_COMMENT_KEYBOARD);
    }
    if (state.step === config.STATE.AWAITING_EXPENSE_COMMENT) {
        state.comment = text === 'Пропустить' ? '' : text;
        // Авто-поиск категории
        const autoCategory = await db.getCategoryByComment(state.comment);
        if (autoCategory) {
            const tag = config.AUTO_TAGS[autoCategory] || 'Разное';
            await db.addTransaction({ 
                userId, type: 'expense', amount: state.amount, category: autoCategory, 
                tag: tag, comment: state.comment, sourceAccount: 'Основной', targetAccount: null 
            });
            ctx.session.state = {};
            const { balances } = await db.getBalances(userId);
            return ctx.reply(`🧠 Узнал "${escapeMarkdown(state.comment)}"! Записал в "${autoCategory}".\nБаланс: ${formatAmount(balances['Основной'])}`, kb.MAIN_KEYBOARD);
        }
        state.step = config.STATE.AWAITING_CATEGORY;
        return ctx.reply('Категория:', kb.generateReplyKeyboard(config.EXPENSE_CATEGORIES, true));
    }
}

// 5. Доходы
async function handleIncome(ctx) {
    const text = ctx.message.text.trim();
    const state = ctx.session.state;
    const userId = ctx.from.id;

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
}

// 6. Выбор категории
async function handleCategoryInput(ctx) {
    const text = ctx.message.text.trim();
    const state = ctx.session.state;
    const userId = ctx.from.id;

    const cat = text.split(' (')[0];
    const allCats = [...config.EXPENSE_CATEGORIES.flat(), ...config.INCOME_CATEGORIES.flat()].map(c => c.split(' (')[0]);
    
    if (allCats.includes(cat)) {
        state.category = cat;
        // Фиксированный доход
        if (state.type === 'income' && config.FIXED_INCOME_AMOUNTS[cat]) {
            await db.addTransaction({ userId, type: 'income', amount: config.FIXED_INCOME_AMOUNTS[cat], category: cat, tag: 'Фиксированный', comment: 'Авто', sourceAccount: null, targetAccount: 'Основной' });
            const { balances } = await db.getBalances(userId);
            ctx.session.state = {};
            return ctx.reply(`Зачислено.\nБаланс (Основной): ${formatAmount(balances['Основной'])}`, kb.MAIN_KEYBOARD);
        }
        // Обычный доход
        if (state.type === 'income') {
            state.step = config.STATE.AWAITING_INCOME_AMOUNT;
            return ctx.reply('Сумма:', kb.BACK_KEYBOARD);
        }
        // Расход
        if (state.type === 'expense') {
            const tag = config.AUTO_TAGS[cat] || 'Разное';
            if (state.comment && state.comment.length > 0) await db.learnKeyword(state.comment, cat);
            await db.addTransaction({ userId, type: 'expense', amount: state.amount, category: cat, tag: tag, comment: state.comment, sourceAccount: 'Основной', targetAccount: null });
            ctx.session.state = {};
            return ctx.reply(`Расход записан: ${cat}`, kb.MAIN_KEYBOARD);
        }
    }
    return ctx.reply('Выберите категорию кнопкой.');
}

// 7. Редактирование
async function handleEditFlow(ctx) {
    const text = ctx.message.text.trim();
    const state = ctx.session.state;
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
        await db.dbRun('UPDATE transactions SET amount = ?, comment = ?, category = ?, tag = ? WHERE id = ?', [state.amount, state.comment, cat, tag, state.txId]);
        ctx.session.state = {};
        return ctx.reply('Обновлено!', kb.MAIN_KEYBOARD);
    }
}

// 8. Коррекция процентов
async function handleInterestCorrection(ctx) {
    const amount = parseAmount(ctx.message.text.trim());
    if (!amount) return ctx.reply('Введите число.');
    await db.addTransaction({
        userId: ctx.from.id, type: 'income', amount: amount, category: 'Проценты', tag: 'Депозит',
        comment: 'Ручная капитализация', sourceAccount: null, targetAccount: ctx.session.state.targetAccount
    });
    ctx.session.state = {};
    return ctx.reply(`Начислено ${formatAmount(amount)} на "${ctx.session.state.targetAccount}".`, kb.MAIN_KEYBOARD);
}

// 9. Добавление покупки
async function handleShoppingCreation(ctx) {
    const text = ctx.message.text.trim();
    const type = ctx.session.state.shoppingType || 'buy'; // 'buy' или 'wish'
    
    await db.addShoppingItem({ item_name: text, type: type, price_estimate: 0 });
    
    ctx.session.state = {}; // Сброс состояния
    await ctx.reply(`Добавлено: ${text}`);
    
    // Сразу показываем обновленный список
    return renderList(ctx, type);
}

// 10. Редактирование покупки
async function handleShoppingEdit(ctx) {
    const text = ctx.message.text.trim();
    const { id, type } = ctx.session.state;
    
    // Обновляем в базе (нужен прямой SQL, так как функции editShoppingItem нет в db.js - добавим её ниже, или тут вызовем raw query)
    await db.dbRun('UPDATE shopping_list SET item_name = ? WHERE id = ?', [text, id]);
    
    ctx.session.state = {};
    await ctx.reply(`Обновлено: ${text}`);
    return renderList(ctx, type);
}

// --- DISPATCHER ---
async function handleStandardTextFlow(ctx) {
    const state = ctx.session.state;
    if (!state || !state.step) return ctx.reply('Используйте меню.', kb.MAIN_KEYBOARD);

    const step = state.step;
    if (step === config.STATE.AWAITING_DEPOSIT_DELETION) return handleDepositDeletion(ctx);
    if ([config.STATE.AWAITING_DEPOSIT_NAME, config.STATE.AWAITING_DEPOSIT_BANK, config.STATE.AWAITING_DEPOSIT_RATE, config.STATE.AWAITING_DEPOSIT_AMOUNT, config.STATE.AWAITING_DEPOSIT_TERM].includes(step)) return handleDepositCreation(ctx);
    if ([config.STATE.AWAITING_TRANSFER_SOURCE, config.STATE.AWAITING_TRANSFER_TARGET, config.STATE.AWAITING_TRANSFER_AMOUNT].includes(step)) return handleTransfer(ctx);
    if ([config.STATE.AWAITING_EXPENSE_AMOUNT, config.STATE.AWAITING_EXPENSE_COMMENT].includes(step)) return handleExpense(ctx);
    if ([config.STATE.AWAITING_INCOME_AMOUNT, config.STATE.AWAITING_INCOME_COMMENT].includes(step)) return handleIncome(ctx);
    if (step === config.STATE.AWAITING_CATEGORY) return handleCategoryInput(ctx);
    if (step.startsWith('EDIT_')) return handleEditFlow(ctx);
    if (step === config.STATE.AWAITING_INTEREST_CORRECTION) return handleInterestCorrection(ctx);
    if (step === config.STATE.AWAITING_SHOPPING_ITEM) return handleShoppingCreation(ctx);
    if (step === config.STATE.AWAITING_SHOPPING_EDIT) return handleShoppingEdit(ctx);
    return ctx.reply('Не понял.', kb.MAIN_KEYBOARD);
}



// --- COMMANDS & HEARS (Specific Listeners) ---

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
/list - Список продуктов
/wishlist - Вишлист
/buy [текст] - Добавить в покупки
/wish [текст] - Добавить в вишлист
/show - Показать текст чека
/day [дата] - Траты за дату
/latest [число] - Последние записи
/debts - Долги учеников
/students - Список учеников
/sync - Синхронизация календаря
/export - Скачать базу
`;

bot.hears('Помощь', (ctx) => ctx.reply(HELP_MSG, kb.MAIN_KEYBOARD));
bot.command('sync', (ctx) => runCalendarCheck(ctx));

bot.command('show', (ctx) => {
    const raw = ctx.session.receipt ? ctx.session.receipt.rawText : 'Нет сохраненного текста чека.';
    if (raw.length > 4000) return ctx.replyWithDocument({ source: Buffer.from(raw), filename: 'receipt.txt' });
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

// --- СПИСОК УЧЕНИКОВ (БЫСТРЫЙ ПРОСМОТР) ---
bot.command('students', async (ctx) => {
    const students = await db.getStudents();
    if (!students.length) return ctx.reply('Список учеников пуст.');

    const buttons = students.map(s => [Markup.button.callback(s.name, `show_student_${s.id}`)]);
    ctx.reply('Выберите ученика:', Markup.inlineKeyboard(buttons));
});

// Обработка клика по ученику
bot.action(/^show_student_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    const s = await db.dbGet('SELECT * FROM students WHERE id = ?', [id]);
    if (!s) return ctx.reply('Ученик не найден.');

    await ctx.reply(
        ` *${escapeMarkdown(s.name)}*\n` +
        ` Предмет: ${s.subject || '-'}\n` +
        ` Тел: ${escapeMarkdown(s.phone || '-')}\n` +
        ` *Адрес: ${escapeMarkdown(s.address || 'Не указан')}*\n` + // Жирным, чтобы видеть квартиру
        ` Родитель: ${escapeMarkdown(s.parents || '-')} (${escapeMarkdown(s.parent_phone || '-')})\n` +
        ` Заметки: ${escapeMarkdown(s.notes || '-')}`,
        { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery();
});


// Добавь обработчик текста
bot.hears('Дела', async (ctx) => {
    const list = await db.getTodos();
    // Активные сверху
    const active = list.filter(t => !t.is_done);
    
    let msg = `📝 *Список дел (${active.length}):*\n\n`;
    const buttons = [];

    if (list.length === 0) msg += "_Список пуст_";
    else {
        list.forEach(t => {
            const statusIcon = t.is_done ? '✅' : '⬜';
            const delBtn = t.is_done ? `🗑` : ''; // Удалять можно только выполненные (для экономии места) или все
            
            // В сообщении показываем список
            msg += `${statusIcon} ${t.text}\n`;
            
            // В кнопках даем управление (только для активных или последних 5, чтобы не спамить кнопками)
            if (!t.is_done) {
                buttons.push([Markup.button.callback(`Выполнить: ${t.text}`, `todo_done_${t.id}`)]);
            } else {
                 // Кнопка удалить выполненное
                 buttons.push([Markup.button.callback(`Удалить: ${t.text}`, `todo_del_${t.id}`)]);
            }
        });
    }

    // Кнопка добавления (через режим диалога или команду)
    // Самый простой способ добавить дело через бота - команда: /todo Текст
    msg += `\n\n_Чтобы добавить: /todo Текст задачи_`;
    
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

// Команда добавления
bot.command('todo', async (ctx) => {
    const text = ctx.message.text.replace('/todo', '').trim();
    if (!text) return ctx.reply('Напиши задачу: /todo Помыть кота');
    await db.addTodo(text);
    ctx.reply(`Записал: ${text}`);
});

// Обработка кнопок
bot.action(/^todo_done_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.toggleTodo(id, 1);
    await ctx.answerCbQuery('Сделано!');
    // Можно обновить сообщение, вызвав ту же логику что в 'Дела'
    ctx.editMessageText('✅ Задача выполнена! Жми "Дела" чтобы обновить список.');
});

bot.action(/^todo_del_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.deleteTodo(id);
    await ctx.answerCbQuery('Удалено!');
    ctx.deleteMessage(); // Просто удаляем сообщение или строку
});

// --- СПИСКИ (НОВАЯ ЛОГИКА) ---

// Универсальная функция показа списка
async function renderList(ctx, type) {
    const list = await db.getShoppingList();
    const items = list.filter(i => i.type === type);
    
    // Проверяем, включен ли режим управления (храним в сессии)
    const isManageMode = ctx.session.manageMode === true;

    const title = type === 'buy' ? '🛒 *Список покупок:*' : '🎁 *Вишлист:*';
    const emptyText = type === 'buy' ? 'Все куплено.' : 'Вишлист пуст.';

    let msg = title + '\n\n';
    const buttons = [];

    if (items.length === 0) msg += `_${emptyText}_`;
    else {
        items.forEach(i => {
            msg += `• ${escapeMarkdown(i.item_name)} ${i.price_estimate ? `(~${i.price_estimate})` : ''}\n`;
            
            if (isManageMode) {
                // В режиме управления: кнопки Удалить и Изменить
                buttons.push([
                    Markup.button.callback(`❌ ${i.item_name}`, `shop_del_${i.id}_${type}`),
                    Markup.button.callback(`✏️ Изм.`, `shop_edit_${i.id}_${type}`)
                ]);
            } else {
                // В обычном режиме: только галочка
                buttons.push([Markup.button.callback(`✅ ${i.item_name}`, `shop_done_${i.id}_${type}`)]);
            }
        });
    }

    // Нижние кнопки
    const controls = [];
    if (!isManageMode) controls.push(Markup.button.callback('➕ Добавить', `shop_add_${type}`));
    
    // Кнопка переключения режима
    const modeBtnText = isManageMode ? '⬅️ Готово' : '⚙️ Ред/Удал';
    controls.push(Markup.button.callback(modeBtnText, `shop_mode_${type}`));
    
    controls.push(Markup.button.callback('🔄', `shop_refresh_${type}`));
    buttons.push(controls);

    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        } catch (e) {}
    } else {
        await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
    }
}

// Команды
bot.command('list', (ctx) => renderList(ctx, 'buy'));
bot.hears('Список', (ctx) => renderList(ctx, 'buy'));

bot.command('wishlist', (ctx) => renderList(ctx, 'wish'));
bot.hears('Вишлист', (ctx) => renderList(ctx, 'wish'));
// Добавить в Повседневное: /buy Хлеб
bot.command('buy', async (ctx) => {
    const text = ctx.message.text.replace('/buy', '').trim();
    if (!text) return ctx.reply('Напишите что купить: /buy Молоко');
    
    await db.addShoppingItem({ item_name: text, type: 'buy', price_estimate: 0 });
    return ctx.reply(`🛒 Добавлено: ${text}`);
});

// Добавить в Вишлист: /wish PS5
bot.command('wish', async (ctx) => {
    const text = ctx.message.text.replace('/wish', '').trim();
    if (!text) return ctx.reply('Напишите что в вишлист: /wish PS5');
    
    await db.addShoppingItem({ item_name: text, type: 'wish', price_estimate: 0 });
    return ctx.reply(`🎁 Добавлено в вишлист: ${text}`);
});

// Edit & Delete handlers
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

// Deposit & Debt Commands
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

bot.command('debts', async (ctx) => {
    const debts = await db.getDebts(ctx.from.id);
    if (!debts.length) return ctx.reply('Долгов нет.', kb.MAIN_KEYBOARD);
    let msg = '*Неоплаченные уроки:*\n';
    const buttons = debts.map(d => [
        Markup.button.callback(`Оплатить`, `pay_debt_${d.id}`),
        Markup.button.callback(`Простить`, `cancel_debt_${d.id}`)
    ]);
    debts.forEach(d => { msg += `\n- ${d.student_name} (${d.subject}): ${formatAmount(d.amount)} от ${d.date.slice(0,10)}`; });
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

// Menu Actions
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
    const rows = await db.dbAll(`SELECT type, amount, category FROM transactions WHERE user_id = ? AND date >= ?`, [ctx.from.id, startOfMonth]);    
    let income = 0, expense = 0;
    rows.forEach(r => {
        if (r.type === 'income') {
            if (r.category !== 'Депозит') income += r.amount;
        } else if (r.type === 'expense') expense += r.amount;
    });
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

async function goBack(ctx) {
    const state = ctx.session.state;
    ctx.session.state = {};
    return ctx.reply('В меню.', kb.MAIN_KEYBOARD);
}

// Callbacks
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
    if (data.startsWith('cal_')) {
        const parts = data.split('_');
        const action = parts[1]; 
        const eventId = parts[2]; 
        // Достаем дополнительные параметры (если есть), например тип урока
        const lessonType = parts[3]; 

        // 1. УДАЛЕНИЕ
        if (action === 'del') {
            const success = await gcal.deleteEvent(eventId);
            if (success) {
                await db.markEventProcessed(eventId, 'Deleted', 'cancelled');
                return ctx.editMessageText('Событие удалено.');
            } else return ctx.reply('Ошибка удаления.');
        }

        // Парсим текст сообщения, чтобы достать имя и предмет (как было раньше)
        const msgLines = ctx.callbackQuery.message.text.split('\n');
        const summaryLine = msgLines.find(l => l.includes('Урок завершен:'));
        const summary = summaryLine ? summaryLine.split('Урок завершен:')[1].trim() : 'Урок';
        const { studentName, subject } = gcal.parseLessonInfo(summary);

        // 2. В ДОЛГИ (Тут тип урока пока не важен, или считаем обычным)
        if (action === 'debt') {
            await db.addDebt(ctx.from.id, studentName, subject, config.LESSON_PRICE, eventId);
            await db.markEventProcessed(eventId, summary, 'debt');
            return ctx.editMessageText(`В долги: ${summary}`);
        }

        // 3. ОПЛАЧЕНО (АВТОМАТИЧЕСКОЕ ОПРЕДЕЛЕНИЕ ТИПА)
        if (action === 'paid') {
            const summaryLower = summary.toLowerCase();
            let lessonType = 'regular'; // По умолчанию

            if (summaryLower.includes('пробный')) {
                lessonType = 'trial';
            } else if (summaryLower.includes('доп') || summaryLower.includes('дополнительный')) {
                lessonType = 'extra';
            }

            let comment = `${subject} (${summary})`;
            if (lessonType === 'trial') comment += ' [ПРОБНЫЙ]';
            
            await db.addTransaction({
                userId: ctx.from.id, 
                type: 'income', 
                amount: config.LESSON_PRICE, 
                category: 'Репетиторство',
                tag: `Ученик: ${studentName}`, 
                comment: comment, 
                sourceAccount: null, 
                targetAccount: 'Основной',
                lesson_type: lessonType
            });
            
            await db.markEventProcessed(eventId, summary, 'paid');
            
            // Красивый ответ в зависимости от типа
            const typeText = lessonType === 'regular' ? 'По расписанию' : (lessonType === 'trial' ? 'ПРОБНЫЙ' : 'ДОПОЛНИТЕЛЬНЫЙ');
            return ctx.editMessageText(`✅ Оплачено: ${summary}\nТип: ${typeText}`);
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
        await db.dbRun('DELETE FROM debts WHERE id = ?', [debtId]);
        return ctx.editMessageText(`Долг удален (прощен).`);
    }
    if (data.startsWith('interest_confirm_')) {
        const parts = data.split('_');
        const accName = parts[2];
        const amount = parseFloat(parts[3]);
        await db.addTransaction({
            userId: ctx.from.id, type: 'income', amount: amount, category: 'Проценты', tag: 'Депозит',
            comment: 'Ежемесячная капитализация', sourceAccount: null, targetAccount: accName
        });
        return ctx.editMessageText(`Начислено ${formatAmount(amount)} на "${accName}".`);
    }
    if (data.startsWith('interest_edit_')) {
        const accName = data.replace('interest_edit_', '');
        ctx.session.state = { step: config.STATE.AWAITING_INTEREST_CORRECTION, targetAccount: accName };
        return ctx.reply(`Введите реальную сумму процентов от банка для "${accName}":`);
    }

// --- SHOPPING ACTIONS ---
    if (data.startsWith('shop_')) {
        const parts = data.split('_'); // shop_action_id_type или shop_action_type
        const action = parts[1];
        
        // 1. ПЕРЕКЛЮЧЕНИЕ РЕЖИМА
        if (action === 'mode') {
            const type = parts[2];
            ctx.session.manageMode = !ctx.session.manageMode; // Инвертируем
            return renderList(ctx, type);
        }

        // 2. ОБНОВИТЬ
        if (action === 'refresh') {
            const type = parts[2];
            return renderList(ctx, type);
        }

        // 3. ДОБАВИТЬ
        if (action === 'add') {
            const type = parts[2];
            ctx.session.state = { step: config.STATE.AWAITING_SHOPPING_ITEM, shoppingType: type };
            return ctx.reply(`Что добавить?`, kb.BACK_KEYBOARD);
        }

        // 4. КУПЛЕНО (ГАЛОЧКА)
        if (action === 'done') {
            const id = parts[2];
            const type = parts[3];
            await db.updateShoppingStatus(id, 'bought');
            return renderList(ctx, type);
        }

        // 5. УДАЛИТЬ (КРЕСТИК)
        if (action === 'del') {
            const id = parts[2];
            const type = parts[3];
            await db.updateShoppingStatus(id, 'deleted'); // Или удаляем насовсем
            return renderList(ctx, type);
        }

        // 6. ИЗМЕНИТЬ (КАРАНДАШ)
        if (action === 'edit') {
            const id = parts[2];
            const type = parts[3];
            ctx.session.state = { 
                step: config.STATE.AWAITING_SHOPPING_EDIT, 
                id: id, 
                type: type 
            };
            return ctx.reply('Введите новое название:', kb.BACK_KEYBOARD);
        }
    }
    // 1. Показ меню причин
    if (data.startsWith('cal_cancel_menu_')) {
        const eventId = data.split('_')[3];
        return ctx.editMessageText('Причина отмены?', Markup.inlineKeyboard([
            [Markup.button.callback('Согласовано', `cal_cx_agreed_${eventId}`)],
            [Markup.button.callback('Я отменил', `cal_cx_teacher_${eventId}`)],
            [Markup.button.callback('Ученик отменил', `cal_cx_student_${eventId}`)],
            [Markup.button.callback('Назад', `cal_back_${eventId}`)] // Нужно добавить логику возврата меню, если хочешь
        ]));
    }

    // 2. Фиксация отмены
    if (data.startsWith('cal_cx_')) {
        const parts = data.split('_');
        const reason = parts[2]; // agreed, teacher, student
        const eventId = parts[3];
        
        // Парсим имя из старого текста сообщения (он есть в ctx)
        // (Тут упрощенно, лучше вынести парсинг в функцию, как было выше)
        const msgLines = ctx.callbackQuery.message.text.split('\n');
        const summaryLine = msgLines.find(l => l.includes('Урок завершен:'));
        const summary = summaryLine ? summaryLine.split('Урок завершен:')[1].trim() : 'Урок';
        const { studentName } = gcal.parseLessonInfo(summary);

        await db.addLessonHistory({
            studentId: null, 
            studentName: studentName,
            date: new Date().toISOString(),
            status: `cancelled_${reason}`,
            reason: reason,
            lostIncome: config.LESSON_PRICE
        });

        // Помечаем как обработанное (status = cancelled)
        await db.markEventProcessed(eventId, summary, 'cancelled');
        
        return ctx.editMessageText(`Записана отмена: ${reason}.`);
    }
    
});

// Photo (OCR) Handler
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
            rawText: receiptData.rawText, shopName: receiptData.shopName || 'Unknown', address: receiptData.address,
            date: receiptData.date, items: [], currentIndex: 0, totalSum: receiptData.total || 0, totalWarning: receiptData.totalWarning
        };
        if (receiptData.error || !receiptData.items || receiptData.items.length === 0) {
             return ctx.reply('Товары не найдены или ошибка.', Markup.inlineKeyboard([Markup.button.callback('Показать сырой текст (Debug)', 'show_raw_ocr')]));
        }
        const itemsToProcess = [];
        for (const item of receiptData.items) {
            let category = await db.getProductCategory(item.name);
            if (!category) {
                const shopKey = Object.keys(config.SHOP_MAPPINGS).find(key => receiptData.shopName.toLowerCase().includes(key.toLowerCase()));
                if (shopKey) category = config.SHOP_MAPPINGS[shopKey];
            }
            item.category = category; 
            itemsToProcess.push(item);
        }
        ctx.session.receipt.items = itemsToProcess;
        await processNextReceiptItem(ctx);
    } catch (e) { console.error(e); ctx.reply('Ошибка обработки фото.'); }
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
    if (receipt.totalWarning) reportMsg += `\n${receipt.totalWarning}\n`;
    reportMsg += `\n`;
    for (const [category, data] of Object.entries(grouped)) {
        const tag = config.AUTO_TAGS[category] || 'Разное';
        const itemNames = data.items.map(i => escapeMarkdown(i.name)).join(', ');
        const addrSuffix = receipt.address ? ` (${escapeMarkdown(receipt.address)})` : '';
        const comment = `Чек ${escapeMarkdown(receipt.shopName)}: ${itemNames.substring(0, 30)}...${addrSuffix}`;
        const result = await db.addTransaction({
            userId: ctx.from.id, type: 'expense', amount: data.sum, category: category, tag: tag, comment: comment,
            sourceAccount: 'Основной', targetAccount: null, date: receipt.date 
        });
        if (result.lastID) await db.saveReceiptItems(result.lastID, receipt.shopName, data.items, receipt.date);
        reportMsg += `- ${category}: ${formatAmount(data.sum)}\n`;
    }
    const { balances } = await db.getBalances(ctx.from.id);
    reportMsg += `\nБаланс: ${formatAmount(balances['Основной'])}`;
    const debugKeyboard = Markup.inlineKeyboard([Markup.button.callback('Показать сырой текст (Debug)', 'show_raw_ocr')]);
    delete ctx.session.receipt;
    ctx.session.state = {};
    await ctx.replyWithMarkdown(reportMsg, debugKeyboard);
}

// ---------------- TEXT FALLBACK (MUST BE LAST) ----------------
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return; // Игнорируем команды
    
    // --- ВОТ ТУТ БЫЛО ПРОПУЩЕНО ---
    if (text === 'Назад') return goBack(ctx);
    // -----------------------------

    if (text === 'Отмена') {
        ctx.session.state = {};
        delete ctx.session.receipt;
        return ctx.reply('Отменено.', kb.MAIN_KEYBOARD);
    }

    // Если мы в режиме OCR (ждем категорию для товара из чека)
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

    // Если ничего из вышеперечисленного - идем в обычную логику
    handleStandardTextFlow(ctx);
});

// --- SCHEDULES ---
async function runMonthlyInterestCheck() {
    const now = new Date();
    if (now.getDate() !== 1) return;
    if (now.getHours() < 10) return;

    const currentMonthStr = now.toISOString().slice(0, 7);
    if (lastNotifiedMonth === currentMonthStr) return;

    const adminId = config.ADMIN_ID; 
    const { accountsList, balances } = await db.getBalances(adminId);
    let notificationSent = false;

    for (const acc of accountsList) {
        if (acc.is_deposit && balances[acc.name] > 0) {
            const alreadyPaid = await db.wasInterestPaidThisMonth(adminId, acc.name);
            if (alreadyPaid) continue;
            const estimatedInterest = Math.round(balances[acc.name] * (acc.rate / 100) / 12);
            await bot.telegram.sendMessage(adminId, 
                `1-е число месяца. Пора начислить проценты по вкладу "${acc.name}".\nТекущий: ${formatAmount(balances[acc.name])}\nРасчет: ${formatAmount(estimatedInterest)}\nВерно?`,
                { ...Markup.inlineKeyboard([[Markup.button.callback(`Да, ${estimatedInterest}`, `interest_confirm_${acc.name}_${estimatedInterest}`)], [Markup.button.callback(`Нет, вручную`, `interest_edit_${acc.name}`)]]) }
            );
            notificationSent = true;
        }
    }
    if (notificationSent) lastNotifiedMonth = currentMonthStr;
}

async function runDailyBackup() {
    const now = new Date();
    if (now.getHours() !== 3) return;
    const todayStr = now.toISOString().slice(0, 10);
    if (lastBackupDate === todayStr) return;
    try {
        await bot.telegram.sendDocument(config.ADMIN_ID, { source: db.DB_PATH, filename: `finance_backup_${todayStr}.db` }, { caption: '💾 Бэкап.' });
        lastBackupDate = todayStr;
    } catch (e) { console.error('Ошибка бэкапа:', e); }
}

cron.schedule('0 2 * * *', async () => {
    try {
        console.log('Running Morning Briefing & Cleanup...');
        
        // 0. Авто-архивация (удаление выполненных)
        await db.dbRun('DELETE FROM todos WHERE is_done = 1');

        const adminId = config.ADMIN_ID;
        const now = new Date();
        
        // 1. Погода
        const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=54.87&longitude=69.14&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto';
        const wRes = await axios.get(weatherUrl);
        const todayWeather = wRes.data.daily;
        const tempMax = todayWeather.temperature_2m_max[0];
        const tempMin = todayWeather.temperature_2m_min[0];
        const precip = todayWeather.precipitation_sum[0]; 
        
        let weatherMsg = `🌤 *Погода:*\nОт ${tempMin}°C до ${tempMax}°C`;
        if (precip > 0.5) weatherMsg += `\n☔ Ожидаются осадки (~${precip} мм). Возьми зонт!`;
        else weatherMsg += `\n☂️ Без существенных осадков.`;

        // 2. Календарь
        const events = await gcal.getEventsForDate(now);
        let agendaMsg = `📅 *План на сегодня:*`;
        if (events.length === 0) {
            agendaMsg += `\nСвободно!`;
        } else {
            events.forEach(e => {
                const time = e.start.dateTime ? e.start.dateTime.slice(11, 16) : 'Весь день';
                agendaMsg += `\n⏰ ${time} — ${escapeMarkdown(e.summary)}`;
            });
        }

        // 3. Дела из БД (Только активные, т.к. выполненные удалили выше)
        const allTodos = await db.getTodos();
        const active = allTodos; // getTodos возвращает всё, но выполненных уже нет в базе
        
        if (active.length > 0) {
            agendaMsg += `\n\n📝 *Дела:*`;
            
            const urgent = active.filter(t => t.period === 'urgent' || (!t.period && t.period !== 'medium' && t.period !== 'later'));
            const medium = active.filter(t => t.period === 'medium');
            const later = active.filter(t => t.period === 'later');

            if(urgent.length) { 
                agendaMsg += `\n❗ СРОЧНО:`; 
                urgent.forEach(t => agendaMsg += `\n• ${escapeMarkdown(t.text)}`); 
            }
            if(medium.length) { 
                agendaMsg += `\n🔸 Средне:`; 
                medium.forEach(t => agendaMsg += `\n• ${escapeMarkdown(t.text)}`); 
            }
            if(later.length) { 
                agendaMsg += `\n💤 Несрочно:`; 
                later.forEach(t => agendaMsg += `\n• ${escapeMarkdown(t.text)}`); 
            }
        } 

        await bot.telegram.sendMessage(adminId, `${agendaMsg}\n\n${weatherMsg}`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error('Ошибка Morning Briefing:', e);
    }
});

setInterval(() => {
    runMonthlyInterestCheck();
    runDailyBackup();
    runCalendarCheck();
}, 60 * 60 * 1000); 

bot.launch().then(() => console.log('Бот работает'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

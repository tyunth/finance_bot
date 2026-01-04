const { Markup } = require('telegraf');
const db = require('../../db');
const ai = require('./sport.ai'); // Подключаем локальный AI

// --- ОТРИСОВКА МЕНЮ ---
async function renderMainMenu(ctx) {
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];
    
    // 1. Проверяем, выходной ли сегодня
    const isRest = await db.isRestDay(userId, today);
    
    if (isRest) {
        return ctx.reply(
            '😴 *Сегодня выходной!*\nОтдыхай и набирайся сил 💪',
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Всё равно тренироваться', 'sport_cancel_rest')],
                    [Markup.button.callback('📅 Управление выходными', 'sport_rest_menu')]
                ])
            }
        );
    }
    
    // 2. Ищем активный план
    const planRow = await db.dbGet('SELECT * FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    
    if (!planRow) {
        return ctx.reply(
            '🏋️‍♂️ План тренировок не найден.\nНапиши мне что-то вроде: "Утром зарядка, а днем 50 подтягиваний"',
            Markup.inlineKeyboard([
                [Markup.button.callback('📝 Создать план', 'sport_new')],
                [Markup.button.callback('📅 Управление выходными', 'sport_rest_menu')]
            ])
        );
    }

    let plan;
    try { plan = JSON.parse(planRow.plan_data); } catch (e) { return ctx.reply('Ошибка данных плана.'); }

    const logs = await db.dbAll('SELECT * FROM sport_logs WHERE user_id = ? AND date = ?', [userId, today]);
    
    let msg = `📅 *${today}* — ${plan.title || 'Тренировка'}\n\n`;
    const inlineButtons = [];

    // --- ПРОХОД ПО БЛОКАМ ---
    if (plan.blocks && Array.isArray(plan.blocks)) {
        plan.blocks.forEach((block, bIndex) => {
            // Заголовок блока
            msg += `🔹 *${block.name}*\n`;
            
            // Считаем прогресс блока для кнопки "Весь блок выполнен"
            let allItemsDone = true;
            let hasCheckItems = false; // Есть ли упражнения-галочки

            if (block.items) {
                block.items.forEach((item, iIndex) => {
                    const log = logs.find(l => l.exercise_name === item.name);
                    const current = log ? log.count : 0;
                    const target = item.target || 1;
                    const isDone = current >= target;
                    
                    if (!isDone) allItemsDone = false;
                    if (item.type === 'check') hasCheckItems = true;

                    // ОТОБРАЖЕНИЕ
                    if (item.type === 'check') {
                        // Обычная строка: ✅ Зарядка
                        const icon = isDone ? '✅' : '⭕️';
                        msg += `${icon} ${item.name}\n`;
                    } else {
                        // Строка со счетчиком: [||||....] 15/50 Отжимания
                        const percent = Math.min(100, Math.round((current / target) * 100));
                        // Рисуем мини-бар из 5 символов
                        const filled = Math.floor(percent / 20); 
                        const bar = '▮'.repeat(filled) + '▯'.repeat(5 - filled);
                        
                        msg += `${isDone ? '✅' : '💪'} *${item.name}*: ${bar} ${current}/${target}\n`;
                        
                        // Добавляем КНОПКУ ПЛЮСА, если не выполнено
                        if (!isDone) {
                            const step = item.step || 1;
                            // Кнопка: sport_inc_БЛОК_УПР_ШАГ
                            inlineButtons.push([
                                Markup.button.callback(`+${step} ${item.name}`, `sport_inc_${bIndex}_${iIndex}_${step}`)
                            ]);
                        }
                    }
                });
            }
            msg += '\n';

            // Если в блоке есть галочки и он не выполнен целиком -> Кнопка "Сделать всё"
            if (hasCheckItems && !allItemsDone) {
                inlineButtons.push([
                    Markup.button.callback(`✅ Выполнить "${block.name}"`, `sport_done_blk_${bIndex}`)
                ]);
            }
        });
    }

    // Управление
    inlineButtons.push([
        Markup.button.callback('🔄 Обновить', 'sport_refresh'),
        Markup.button.callback('⚙️ Новый план', 'sport_new')
    ]);

    // Управление выходными - всегда добавляем
    inlineButtons.push([
        Markup.button.callback('📅 Выходные', 'sport_rest_menu')
    ]);

    try {
        if (ctx.callbackQuery) {
            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(inlineButtons) });
        } else {
            await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(inlineButtons) });
        }
    } catch (e) { 
        console.error('Render error (swallowing):', e.message); 
    }
}

// --- ОБРАБОТКА НАЖАТИЙ ---
async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];

    // 1. Инкремент (+1, +10)
    if (data.startsWith('sport_inc_')) {
        const [_, __, bIndex, iIndex, stepStr] = data.split('_');
        const bIdx = parseInt(bIndex);
        const iIdx = parseInt(iIndex);
        const step = parseInt(stepStr);

        await updateLog(userId, today, bIdx, iIdx, step, false); 
        await ctx.answerCbQuery(`+${step}!`);
    }

    // 2. Выполнить весь блок
    if (data.startsWith('sport_done_blk_')) {
        const bIdx = parseInt(data.split('_')[3]);
        
        const planRow = await db.dbGet('SELECT plan_data FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
        if (planRow) {
            const plan = JSON.parse(planRow.plan_data);
            const block = plan.blocks[bIdx];
            if (block) {
                for (const item of block.items) {
                    const target = item.target || 1; 
                    await setLogDone(userId, today, item.name, target);
                }
            }
        }
        await ctx.answerCbQuery('Блок выполнен!');
    }

    if (data === 'sport_refresh') {
        await ctx.answerCbQuery('Обновлено');
    }

    if (data === 'sport_new') {
        await ctx.reply('✍️ Напиши свой план тренировок.\nПример:\n"Утро: разминка. День: 50 подтягиваний (шаг 5), 100 приседаний. Вечер: растяжка."');
        if(!ctx.session) ctx.session = {};
        ctx.session.state = { step: 'AWAITING_SPORT_PLAN' };
        return ctx.answerCbQuery();
    }

    // Управление выходными днями
    if (data === 'sport_rest_menu') {
        return renderRestMenu(ctx);
    }

    if (data === 'sport_cancel_rest') {
        // Всё равно тренироваться - просто рендерим обычное меню, игнорируя выходной
        await ctx.answerCbQuery('Начинаем тренировку!');
    }

    // --- ОБРАБОТЧИКИ ДЛЯ МЕНЮ ВЫХОДНЫХ ---
    if (data === 'sport_add_rest') {
        await ctx.reply('📅 Введите дату выходного дня в формате ГГГГ-ММ-ДД (например: 2026-01-15).\nИли нажмите "Сегодня" для сегодняшнего дня.');
        if (!ctx.session) ctx.session = {};

        // Клавиатура для быстрого выбора
        const quickKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Сегодня', 'sport_add_rest_today')],
            [Markup.button.callback('Завтра', 'sport_add_rest_tomorrow')]
        ]);

        await ctx.reply('Быстрый выбор:', quickKeyboard);
        ctx.session.state = { step: 'AWAITING_REST_DATE' };
        return;
    }

    if (data === 'sport_add_rest_today') {
        const today = new Date().toISOString().split('T')[0];
        await db.addRestDay(userId, today, 'Выходной');
        await ctx.answerCbQuery(`Выходной добавлен: ${today}`);
        return renderRestMenu(ctx);
    }

    if (data === 'sport_add_rest_tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        await db.addRestDay(userId, tomorrowStr, 'Выходной');
        await ctx.answerCbQuery(`Выходной добавлен: ${tomorrowStr}`);
        return renderRestMenu(ctx);
    }

    if (data === 'sport_auto_sundays') {
        const addedCount = await db.addSundaysAsRestDays(userId, 3);
        await ctx.answerCbQuery(`Добавлено ${addedCount} воскресений как выходные`);
        return renderRestMenu(ctx);
    }

    if (data === 'sport_remove_rest') {
        const restDays = await db.getRestDays(userId);
        if (restDays.length === 0) {
            await ctx.answerCbQuery('Нет выходных для удаления');
            return renderRestMenu(ctx);
        }

        let removeMsg = '📅 Выберите выходной для удаления:\n\n';
        const removeKeyboard = [];

        restDays.slice(0, 8).forEach((day, index) => {
            removeMsg += `${index + 1}. ${day.date} — ${day.reason}\n`;
            removeKeyboard.push([Markup.button.callback(`${index + 1}. Удалить ${day.date}`, `sport_del_rest_${day.date}`)]);
        });

        removeKeyboard.push([Markup.button.callback('⬅️ Назад', 'sport_rest_menu')]);

        await ctx.editMessageText(removeMsg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: removeKeyboard } });
        await ctx.answerCbQuery();
        return;
    }

    if (data.startsWith('sport_del_rest_')) {
        const dateToDelete = data.replace('sport_del_rest_', '');
        await db.removeRestDay(userId, dateToDelete);
        await ctx.answerCbQuery(`Выходной удален: ${dateToDelete}`);
        return renderRestMenu(ctx);
    }

    if (data === 'sport_back_to_main') {
        return renderMainMenu(ctx);
    }

    await renderMainMenu(ctx);
}

// ---- МЕНЮ УПРАВЛЕНИЯ ВЫХОДНЫМИ ----
async function renderRestMenu(ctx) {
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];

    // Получаем ближайшие выходные дни (от сегодня)
    const restDays = await db.getRestDays(userId, today);
    let restDaysText = '';

    if (restDays.length === 0) {
        restDaysText = '😴 Выходных дней нет.';
    } else {
        restDaysText = '📅 *Запланированные выходные:*\n';
        restDays.slice(0, 10).forEach(day => { // Показываем максимум 10 ближайших
            restDaysText += `• ${day.date} — ${day.reason}\n`;
        });
        if (restDays.length > 10) restDaysText += `... и ещё ${restDays.length - 10} дней\n`;
    }

    const msg = `${restDaysText}\n\n*Выберите действие:*`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Добавить выходной', 'sport_add_rest')],
        [Markup.button.callback('➖ Удалить выходной', 'sport_remove_rest')],
        [Markup.button.callback('📅 Авто: воскресенья', 'sport_auto_sundays')],
        [Markup.button.callback('⬅️ Назад', 'sport_back_to_main')]
    ]);

    try {
        if (ctx.callbackQuery) {
            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...keyboard });
        } else {
            await ctx.reply(msg, { parse_mode: 'Markdown', ...keyboard });
        }
    } catch (e) {
        console.error('Rest menu render error:', e.message);
    }

    await ctx.answerCbQuery();
}

// --- ХЕЛПЕРЫ БАЗЫ ДАННЫХ ---

async function updateLog(userId, date, bIdx, iIdx, amount, isSet = false) {
    const planRow = await db.dbGet('SELECT plan_data FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    if (!planRow) return;
    const plan = JSON.parse(planRow.plan_data);
    
    if (!plan.blocks[bIdx] || !plan.blocks[bIdx].items[iIdx]) return;
    const item = plan.blocks[bIdx].items[iIdx];
    const name = item.name;

    const log = await db.dbGet('SELECT * FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, date, name]);
    
    let newCount = 0;
    if (log) newCount = log.count + amount;
    else newCount = amount;

    if (log) await db.dbRun('UPDATE sport_logs SET count = ? WHERE id = ?', [newCount, log.id]);
    else await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, count, is_done) VALUES (?, ?, ?, ?, 0)', [userId, name, date, newCount]);
}

async function setLogDone(userId, date, name, targetVal) {
    const log = await db.dbGet('SELECT id FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, date, name]);
    if (log) await db.dbRun('UPDATE sport_logs SET is_done = 1, count = ? WHERE id = ?', [targetVal, log.id]);
    else await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, is_done, count) VALUES (?, ?, ?, 1, ?)', [userId, name, date, targetVal]);
}

// Обработка загрузки текста
async function handlePlanUpload(ctx) {
    const text = ctx.message.text;
    if (!text) return ctx.reply('Жду текст плана...');
    
    const loadingMsg = await ctx.reply('🤖 Анализирую план...');
    const json = await ai.parseSportPlan(text);
    
    if (!json || !json.blocks) {
        return ctx.editMessageText('❌ Не удалось понять план. Попробуй проще.', { chat_id: ctx.chat.id, message_id: loadingMsg.message_id });
    }

    await db.dbRun('UPDATE sport_plans SET is_active = 0 WHERE user_id = ?', [ctx.from.id]);
    await db.dbRun('INSERT INTO sport_plans (user_id, title, plan_data, created_at) VALUES (?, ?, ?, ?)', [ctx.from.id, json.title, JSON.stringify(json), new Date().toISOString()]);
    
    ctx.session.state = null;
    try { await ctx.deleteMessage(loadingMsg.message_id); } catch(e){}
    await ctx.reply('✅ План сохранен!');
    return renderMainMenu(ctx);
}

// --- ОБРАБОТКА ВВОДА ДАТЫ ВЫХОДНОГО ---
async function handleRestDateInput(ctx) {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    // Валидация формата даты: ГГГГ-ММ-ДД
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(text)) {
        await ctx.reply('❌ Неверный формат даты. Используйте ГГГГ-ММ-ДД (например: 2026-01-15)');
        return;
    }

    // Проверяем, что дата не в прошлом (сегодня или будущее)
    const today = new Date().toISOString().split('T')[0];
    if (text < today) {
        await ctx.reply('❌ Нельзя добавить выходной в прошлое. Выберите сегодняшнюю или будущую дату.');
        return;
    }

    try {
        await db.addRestDay(userId, text, 'Выходной');
        ctx.session.state = null;
        await ctx.reply(`✅ Выходной добавлен: ${text}`);
        return renderRestMenu(ctx);
    } catch (e) {
        console.error('Error adding rest day:', e);
        await ctx.reply('❌ Ошибка при добавлении выходного дня.');
    }
}

// --- СВОДКА ДЛЯ AI (BRIEFING) ---
async function getDailySummary(userId, dateOffset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + dateOffset);
    const dateStr = date.toISOString().split('T')[0];

    const planRow = await db.dbGet('SELECT plan_data FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    if (!planRow) return { percent: 0, blocks: [] };

    const plan = JSON.parse(planRow.plan_data);
    const logs = await db.dbAll('SELECT * FROM sport_logs WHERE user_id = ? AND date = ?', [userId, dateStr]);

    let totalTarget = 0;
    let totalDone = 0;
    const blockNames = [];

    if (plan.blocks) {
        plan.blocks.forEach(block => {
            blockNames.push(block.name || 'Блок');
            if (block.items) {
                block.items.forEach(item => {
                    const log = logs.find(l => l.exercise_name === item.name);
                    const current = log ? log.count : 0;
                    const target = item.target || 1;
                    if (current >= target) totalDone++;
                    totalTarget++;
                });
            }
        });
    }

    return {
        percent: totalTarget > 0 ? Math.round((totalDone / totalTarget) * 100) : 0,
        blocks: blockNames
    };
}

// --- 🔥 УМНОЕ НАПОМИНАНИЕ (ДЛЯ CRON) ---
async function processEveningReminders(bot) {
    console.log('🏃 Проверка вечернего спорта...');
    
    // Берем всех пользователей из базы
    const users = await db.dbAll('SELECT * FROM users');

    for (const user of users) {
        // 1. Проверяем права (modules string: "finance,sport")
        const modules = (user.modules || '').split(',');
        // Если спорта нет в модулях И пользователь не админ
        if (!modules.includes('sport') && !modules.includes('all') && user.role !== 'admin') {
            continue;
        }

        // 2. Проверяем выполнение плана на сегодня
        const summary = await getDailySummary(user.telegram_id, 0);
        
        // Если план есть (summary не null), но выполнен не на 100%
        if (summary && summary.percent < 100) {
            try {
                await bot.telegram.sendMessage(
                    user.telegram_id,
                    `🏋️‍♂️ <b>Вечерняя проверка!</b>\nПлан выполнен на ${summary.percent}%.\nНе забудь отметить тренировку!`,
                    { 
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([[Markup.button.callback('💪 Открыть меню', 'sport_refresh')]])
                    }
                );
            } catch (e) {
                console.error(`Не удалось отправить напоминание юзеру ${user.telegram_id}:`, e.message);
            }
        }
    }
}

module.exports = {
    renderMainMenu,
    handleCallback,
    handlePlanUpload,
    handleRestDateInput,
    getDailySummary,
    processEveningReminders // <-- Экспортируем
};

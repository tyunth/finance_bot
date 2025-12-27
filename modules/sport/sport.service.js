const { Markup } = require('telegraf');
const db = require('../../db');
const ai = require('./sport.ai'); // Подключаем локальный AI (он должен лежать рядом)

// --- ОТРИСОВКА МЕНЮ ---
async function renderMainMenu(ctx) {
    const userId = ctx.from.id;
    
    // 1. Ищем активный план
    const planRow = await db.dbGet('SELECT * FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    
    if (!planRow) {
        return ctx.reply(
            '🏋️‍♂️ План тренировок не найден.\nНапиши мне что-то вроде: "Утром зарядка, а днем 50 подтягиваний"',
            Markup.inlineKeyboard([[Markup.button.callback('📝 Создать план', 'sport_new')]])
        );
    }

    let plan;
    try { plan = JSON.parse(planRow.plan_data); } catch (e) { return ctx.reply('Ошибка данных плана.'); }

    const today = new Date().toISOString().split('T')[0];
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

    try {
        // Редактируем или отправляем новое (чтобы не мигало, пробуем edit)
        if (ctx.callbackQuery) {
            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(inlineButtons) });
        } else {
            await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(inlineButtons) });
        }
    } catch (e) { 
        // Если текст не изменился, телеграм выдаст ошибку, игнорируем её или шлем новое
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

        await updateLog(userId, today, bIdx, iIdx, step, false); // false = прибавляем
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
                // Ставим всем упражнениям в блоке статус "выполнено" (max count)
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

    await renderMainMenu(ctx);
}

// --- ХЕЛПЕРЫ БАЗЫ ДАННЫХ ---

// Инкремент прогресса
async function updateLog(userId, date, bIdx, iIdx, amount, isSet = false) {
    // 1. Достаем название упражнения из плана
    const planRow = await db.dbGet('SELECT plan_data FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    if (!planRow) return;
    const plan = JSON.parse(planRow.plan_data);
    
    if (!plan.blocks[bIdx] || !plan.blocks[bIdx].items[iIdx]) return;
    const item = plan.blocks[bIdx].items[iIdx];
    const name = item.name;

    // 2. Ищем лог
    const log = await db.dbGet('SELECT * FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, date, name]);
    
    let newCount = 0;
    if (log) {
        newCount = log.count + amount;
    } else {
        newCount = amount;
    }

    // 3. Сохраняем
    if (log) {
        await db.dbRun('UPDATE sport_logs SET count = ? WHERE id = ?', [newCount, log.id]);
    } else {
        await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, count, is_done) VALUES (?, ?, ?, ?, 0)', [userId, name, date, newCount]);
    }
}

// Установить "Выполнено" (для блоков)
async function setLogDone(userId, date, name, targetVal) {
    const log = await db.dbGet('SELECT id FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, date, name]);
    if (log) {
        await db.dbRun('UPDATE sport_logs SET is_done = 1, count = ? WHERE id = ?', [targetVal, log.id]);
    } else {
        await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, is_done, count) VALUES (?, ?, ?, 1, ?)', [userId, name, date, targetVal]);
    }
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

    // Архивируем старые
    await db.dbRun('UPDATE sport_plans SET is_active = 0 WHERE user_id = ?', [ctx.from.id]);
    // Сохраняем новый
    await db.dbRun('INSERT INTO sport_plans (user_id, title, plan_data, created_at) VALUES (?, ?, ?, ?)', [ctx.from.id, json.title, JSON.stringify(json), new Date().toISOString()]);
    
    ctx.session.state = null;
    try { await ctx.deleteMessage(loadingMsg.message_id); } catch(e){}
    await ctx.reply('✅ План сохранен!');
    return renderMainMenu(ctx);
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

module.exports = { renderMainMenu, handleCallback, handlePlanUpload, getDailySummary };

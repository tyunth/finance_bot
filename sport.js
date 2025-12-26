const { Markup } = require('telegraf');
const db = require('./db');
const ai = require('./ai');

// --- ГЛАВНОЕ МЕНЮ СПОРТА ---
async function renderMainMenu(ctx) {
    const userId = ctx.from.id;
    
    // 1. Ищем активный план
    const planRow = await db.dbGet('SELECT * FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    
    if (!planRow) {
        return ctx.reply(
            '🏋️‍♂️ План тренировок не найден.\nЗагрузи его (текст/JSON).',
            Markup.inlineKeyboard([[Markup.button.callback('⚙️ Загрузить план', 'sport_new')]])
        );
    }

    let plan;
    try { plan = JSON.parse(planRow.plan_data); } catch (e) { return ctx.reply('Ошибка плана.'); }

    const today = new Date().toISOString().split('T')[0];
    const logs = await db.dbAll('SELECT * FROM sport_logs WHERE user_id = ? AND date = ?', [userId, today]);
    
    let msg = `💪 **${plan.title}**\n📅 ${today}\n\n`;
    const buttons = [];

    // --- ЛОГИКА БЛОКОВ ---
    if (plan.blocks && Array.isArray(plan.blocks)) {
        plan.blocks.forEach((block, bIndex) => {
            const blockName = block.name || `Блок ${bIndex + 1}`;
            
            // Проверяем прогресс блока
            let totalItems = 0;
            let doneItems = 0;
            let blockDetails = '';

            if (block.items && Array.isArray(block.items)) {
                totalItems = block.items.length;
                block.items.forEach(item => {
                    const log = logs.find(l => l.exercise_name === item.name);
                    
                    // Считаем выполненным, если is_done=1 ИЛИ count >= target
                    const isCompleted = log && (log.is_done || (item.type === 'count' && log.count >= item.target));
                    
                    if (isCompleted) doneItems++;

                    // Формируем красивый список для текста сообщения (для инфо)
                    const icon = isCompleted ? '✅' : '•';
                    const targetText = item.type === 'count' ? ` (${item.target} раз)` : '';
                    blockDetails += `${icon} ${item.name}${targetText}\n`;
                });
            }

            const isBlockDone = totalItems > 0 && doneItems === totalItems;
            
            // Заголовок блока
            msg += `🔹 *${blockName}* ${isBlockDone ? '✅' : ''}\n`;
            msg += blockDetails + '\n';

            // Если блок НЕ сделан полностью - добавляем кнопку "Сделать всё"
            if (!isBlockDone && totalItems > 0) {
                // Кнопка: sport_done_BLOCK_INDEX
                buttons.push([
                    Markup.button.callback(`✅ Выполнить "${blockName}"`, `sport_done_block_${bIndex}`)
                ]);
            }
        });
    }

    // Нижние кнопки
    buttons.push([Markup.button.callback('🔄 Обновить', 'sport_refresh')]);
    buttons.push([Markup.button.callback('📝 Загрузить новый план', 'sport_new')]);

    try {
        const extra = { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) };
        if (ctx.callbackQuery) await ctx.editMessageText(msg, extra);
        else await ctx.replyWithMarkdown(msg, extra);
    } catch (e) { console.error(e); }
}

// --- ОБРАБОТКА ДЕЙСТВИЙ ---
async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];

    if (data === 'sport_refresh') {
        await renderMainMenu(ctx);
        return ctx.answerCbQuery('Обновлено');
    }

    if (data === 'sport_new') {
        await ctx.reply('📤 Пришли текст плана.');
        if (!ctx.session) ctx.session = {};
        ctx.session.state = { step: 'AWAITING_SPORT_PLAN' };
        return ctx.answerCbQuery();
    }

    // --- ВЫПОЛНЕНИЕ ВСЕГО БЛОКА ---
    if (data.startsWith('sport_done_block_')) {
        const bIndex = parseInt(data.split('_')[3]);

        // 1. Достаем план
        const planRow = await db.dbGet('SELECT plan_data FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
        if (!planRow) return ctx.answerCbQuery('План не найден');
        
        const plan = JSON.parse(planRow.plan_data);
        const block = plan.blocks[bIndex];

        if (block && block.items) {
            // 2. Проходимся по всем упражнениям блока
            for (const item of block.items) {
                const name = item.name;
                const target = item.target || 1; // Если цель не указана, считаем 1

                // 3. Записываем в базу "Сделано" (UPSERT логика)
                // Сначала ищем, есть ли запись
                const existing = await db.dbGet('SELECT id FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, today, name]);
                
                if (existing) {
                    // Обновляем: ставим галочку и макс кол-во
                    await db.dbRun(
                        'UPDATE sport_logs SET is_done = 1, count = ? WHERE id = ?', 
                        [target, existing.id]
                    );
                } else {
                    // Создаем новую
                    await db.dbRun(
                        'INSERT INTO sport_logs (user_id, exercise_name, date, is_done, count) VALUES (?, ?, ?, 1, ?)', 
                        [userId, name, today, target]
                    );
                }
            }
            await ctx.answerCbQuery(`Блок "${block.name || 'Блок'}" выполнен! 💪`);
        }
    }

    await renderMainMenu(ctx);
}

// --- СВОДКА (Для AI) ---
async function getDailySummary(userId, dateOffset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + dateOffset);
    const dateStr = date.toISOString().split('T')[0];

    const planRow = await db.dbGet('SELECT plan_data FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    if (!planRow) return null;

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
                    const isCompleted = log && (log.is_done || (item.type === 'count' && log.count >= item.target));
                    if (isCompleted) totalDone++;
                    totalTarget++;
                });
            }
        });
    }

    return {
        percent: totalTarget > 0 ? Math.round((totalDone / totalTarget) * 100) : 0,
        blocks: blockNames // Возвращаем список названий блоков
    };
}

// ... handlePlanUpload остался без изменений (можно оставить из прошлого файла) ...
async function handlePlanUpload(ctx) {
    const text = ctx.message.text;
    if (!text) return ctx.reply('Пришли текст.');
    let json = await ai.parseSportPlan(text); // Используем функцию из ai.js
    if (!json || !json.blocks) return ctx.reply('Не понял план.');
    
    await db.dbRun('UPDATE sport_plans SET is_active = 0 WHERE user_id = ?', [ctx.from.id]);
    await db.dbRun('INSERT INTO sport_plans (user_id, title, plan_data, created_at) VALUES (?, ?, ?, ?)', [ctx.from.id, json.title, JSON.stringify(json), new Date().toISOString()]);
    
    await ctx.reply('План обновлен!');
    ctx.session.state = null;
    return renderMainMenu(ctx);
}

module.exports = {
    renderMainMenu,
    handleCallback,
    handlePlanUpload,
    getDailySummary,
};

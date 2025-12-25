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
            '🏋️‍♂️ План тренировок не найден.\n\nНажми кнопку ниже, чтобы загрузить его (можно отправить текст от тренера или JSON).',
            Markup.inlineKeyboard([
                [Markup.button.callback('⚙️ Загрузить новый план', 'sport_new')]
            ])
        );
    }

    let plan;
    try {
        plan = JSON.parse(planRow.plan_data);
    } catch (e) {
        return ctx.reply('Ошибка данных плана. Попробуй загрузить заново.');
    }

    const today = new Date().toISOString().split('T')[0];
    const logs = await db.dbAll('SELECT * FROM sport_logs WHERE user_id = ? AND date = ?', [userId, today]);
    
    let msg = `💪 **${plan.title}**\n📅 ${today}\n\n`;
    const buttons = [];

    // 3. Рисуем блоки
    if (plan.blocks && Array.isArray(plan.blocks)) {
        plan.blocks.forEach((block, bIndex) => {
            const blockName = block.name || block.title || 'Блок';
            msg += `🔹 *${blockName}*\n`;
            
            if (block.items && Array.isArray(block.items)) {
                block.items.forEach((item, iIndex) => {
                    const log = logs.find(l => l.exercise_name === item.name);
                    const current = log ? (item.type === 'count' ? log.count : log.is_done) : 0;
                    const isDone = current >= item.target;
                    const statusIcon = isDone ? '✅' : '⬜';

                    // Используем ИНДЕКСЫ вместо имен, чтобы влезть в лимит 64 байта
                    // Формат: sport_action_bIndex_iIndex_step

                    if (item.type === 'check') {
                        msg += `${statusIcon} ${item.name}\n`;
                        if (!isDone) {
                            buttons.push([Markup.button.callback(`✅ Сделано`, `sport_do_${bIndex}_${iIndex}`)]);
                        }
                    } else {
                        // Счетчик
                        msg += `${statusIcon} ${item.name}: **${current}** / ${item.target}\n`;
                        if (!isDone) {
                            const step = item.step || 1;
                            const btns = [];
                            
                            // Кнопка +step
                            btns.push(Markup.button.callback(`+${step}`, `sport_add_${bIndex}_${iIndex}_${step}`));
                            
                            // Умная кнопка +5 (если цель >= 20 и шаг маленький)
                            if (item.target >= 20 && step < 5) {
                                btns.push(Markup.button.callback(`+5`, `sport_add_${bIndex}_${iIndex}_5`));
                            }
                             // Кнопка +10 (если цель >= 40)
                            if (item.target >= 40 && step <= 10) {
                                btns.push(Markup.button.callback(`+10`, `sport_add_${bIndex}_${iIndex}_10`));
                            }
                            
                            buttons.push(btns);
                        }
                    }
                });
            }
            msg += '\n';
        });
    }

    buttons.push([Markup.button.callback('🔄 Обновить', 'sport_refresh')]);
    buttons.push([Markup.button.callback('⚙️ Загрузить новый план', 'sport_new')]);

    try {
        if (ctx.callbackQuery) {
            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        } else {
            await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
        }
    } catch (e) {
        console.error('Sport render error:', e); // Теперь ошибка будет видна в консоли
        if (!ctx.callbackQuery) ctx.reply('Ошибка отображения меню. Проверь консоль.');
    }
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
        await ctx.reply('📤 Отправь мне текст плана (от тренера) или готовый JSON код.');
        if (!ctx.session) ctx.session = {};
        ctx.session.state = { step: 'AWAITING_SPORT_PLAN' };
        return ctx.answerCbQuery();
    }

    // Вспомогательная функция для получения имени из индексов
    const getExerciseName = async (bIndex, iIndex) => {
        const planRow = await db.dbGet('SELECT plan_data FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
        if (!planRow) return null;
        const plan = JSON.parse(planRow.plan_data);
        if (plan.blocks[bIndex] && plan.blocks[bIndex].items[iIndex]) {
            return plan.blocks[bIndex].items[iIndex].name;
        }
        return null;
    };

    // 1. СДЕЛАТЬ (Чек-лист) -> sport_do_BLOCK_ITEM
    if (data.startsWith('sport_do_')) {
        const parts = data.split('_'); // [sport, do, bIndex, iIndex]
        const bIndex = parts[2];
        const iIndex = parts[3];
        
        const name = await getExerciseName(bIndex, iIndex);
        if (name) {
            const existing = await db.dbGet('SELECT id FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, today, name]);
            if (!existing) {
                await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, is_done, count) VALUES (?, ?, ?, 1, 1)', [userId, name, today]);
            }
        }
    }

    // 2. ДОБАВИТЬ (Счетчик) -> sport_add_BLOCK_ITEM_STEP
    if (data.startsWith('sport_add_')) {
        const parts = data.split('_'); // [sport, add, bIndex, iIndex, step]
        const bIndex = parts[2];
        const iIndex = parts[3];
        const step = parseInt(parts[4]);

        const name = await getExerciseName(bIndex, iIndex);
        if (name) {
            const existing = await db.dbGet('SELECT id, count FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, today, name]);
            if (existing) {
                await db.dbRun('UPDATE sport_logs SET count = count + ? WHERE id = ?', [step, existing.id]);
            } else {
                await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, count, is_done) VALUES (?, ?, ?, ?, 0)', [userId, name, today, step]);
            }
        }
    }

    await renderMainMenu(ctx);
    await ctx.answerCbQuery();
}

// --- ЗАГРУЗКА ПЛАНА ---
async function handlePlanUpload(ctx) {
    const text = ctx.message.text;
    
    if (!text) return ctx.reply('Пришли мне текст или JSON.');

    let json;
    let method = '';

    try {
        json = JSON.parse(text);
        method = 'Direct JSON';
    } catch (e) {
        const msg = await ctx.reply('🧠 Анализирую план через AI...');
        json = await ai.parseSportPlan(text);
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
        method = 'AI';
    }
    
    if (!json || !json.blocks) {
        return ctx.reply('❌ Не удалось распознать структуру плана. Проверь формат.');
    }

    await db.dbRun('UPDATE sport_plans SET is_active = 0 WHERE user_id = ?', [ctx.from.id]);
    
    await db.dbRun(
        'INSERT INTO sport_plans (user_id, title, plan_data, created_at) VALUES (?, ?, ?, ?)',
        [ctx.from.id, json.title || 'Новый план', JSON.stringify(json), new Date().toISOString()]
    );

    await ctx.reply(`✅ План принят (${method})!`);
    
    if (ctx.session) ctx.session.state = null;
    return renderMainMenu(ctx);
}

module.exports = {
    renderMainMenu,
    handleCallback,
    handlePlanUpload
};

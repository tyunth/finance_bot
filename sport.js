const { Markup } = require('telegraf');
const db = require('./db');
const ai = require('./ai');

// --- ГЛАВНОЕ МЕНЮ СПОРТА ---
async function renderMainMenu(ctx) {
    const userId = ctx.from.id;
    
    // 1. Ищем активный план
    const planRow = await db.dbGet('SELECT * FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    
    if (!planRow) {
        return ctx.reply('🏋️‍♂️ План тренировок не найден.\nНажми "Загрузить новый план" и пришли мне текст или JSON.');
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
        plan.blocks.forEach((block) => {
            // ФИКС: Поддержка и 'name', и 'title' (как в твоем JSON)
            const blockName = block.name || block.title || 'Блок';
            msg += `🔹 *${blockName}*\n`;
            
            if (block.items && Array.isArray(block.items)) {
                block.items.forEach((item) => {
                    const log = logs.find(l => l.exercise_name === item.name);
                    const current = log ? (item.type === 'count' ? log.count : log.is_done) : 0;
                    const isDone = current >= item.target;
                    const statusIcon = isDone ? '✅' : '⬜';

                    if (item.type === 'check') {
                        msg += `${statusIcon} ${item.name}\n`;
                        if (!isDone) {
                            buttons.push([Markup.button.callback(`✅ ${item.name}`, `sport_do_${item.name}`)]);
                        }
                    } else {
                        // Счетчик
                        msg += `${statusIcon} ${item.name}: **${current}** / ${item.target}\n`;
                        if (!isDone) {
                            const step = item.step || 1;
                            const btns = [];
                            btns.push(Markup.button.callback(`+${step}`, `sport_add_${item.name}_${step}`));
                            
                            // Умная кнопка +5 (если цель большая)
                            if (item.target >= 20 && step < 5) {
                                btns.push(Markup.button.callback(`+5`, `sport_add_${item.name}_5`));
                            }
                            // Кнопка +10 для отжиманий (если шаг 10 или цель > 40)
                            if (item.target >= 40 && step <= 10) {
                                btns.push(Markup.button.callback(`+10`, `sport_add_${item.name}_10`));
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
        // Игнорируем ошибку "message not modified"
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
        // Устанавливаем состояние сессии!
        if (!ctx.session) ctx.session = {};
        ctx.session.state = { step: 'AWAITING_SPORT_PLAN' };
        return ctx.answerCbQuery();
    }

    // 1. СДЕЛАТЬ (Чек-лист)
    if (data.startsWith('sport_do_')) {
        const name = data.replace('sport_do_', '');
        // Проверяем, есть ли запись. Если нет - создаем. Если есть - обновляем (хотя для check это одно и то же)
        const existing = await db.dbGet('SELECT id FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, today, name]);
        
        if (!existing) {
            await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, is_done, count) VALUES (?, ?, ?, 1, 1)', [userId, name, today]);
        }
    }

    // 2. ДОБАВИТЬ (Счетчик)
    if (data.startsWith('sport_add_')) {
        const parts = data.split('_');
        const count = parseInt(parts.pop());
        const name = parts.slice(2).join('_');

        const existing = await db.dbGet('SELECT id, count FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, today, name]);
        
        if (existing) {
            await db.dbRun('UPDATE sport_logs SET count = count + ? WHERE id = ?', [count, existing.id]);
        } else {
            await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, count, is_done) VALUES (?, ?, ?, ?, 0)', [userId, name, today, count]);
        }
    }

    await renderMainMenu(ctx);
    await ctx.answerCbQuery();
}

// --- ЗАГРУЗКА ПЛАНА (Теперь умная) ---
async function handlePlanUpload(ctx) {
    const text = ctx.message.text;
    
    if (!text) return ctx.reply('Пришли мне текст или JSON.');

    let json;
    let method = '';

    // 1. Пробуем распарсить как готовый JSON
    try {
        json = JSON.parse(text);
        method = 'Direct JSON';
    } catch (e) {
        // 2. Если не вышло — отправляем в AI
        const msg = await ctx.reply('🧠 Анализирую план через AI...');
        json = await ai.parseSportPlan(text);
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
        method = 'AI';
    }
    
    if (!json || !json.blocks) {
        return ctx.reply('❌ Не удалось распознать структуру плана. Проверь формат.');
    }

    // Деактивируем старые
    await db.dbRun('UPDATE sport_plans SET is_active = 0 WHERE user_id = ?', [ctx.from.id]);
    
    // Сохраняем новый
    await db.dbRun(
        'INSERT INTO sport_plans (user_id, title, plan_data, created_at) VALUES (?, ?, ?, ?)',
        [ctx.from.id, json.title || 'Новый план', JSON.stringify(json), new Date().toISOString()]
    );

    await ctx.reply(`✅ План принят (${method})!`);
    
    // Сбрасываем состояние и показываем меню
    if (ctx.session) ctx.session.state = null;
    return renderMainMenu(ctx);
}

module.exports = {
    renderMainMenu,
    handleCallback,
    handlePlanUpload
};

const axios = require('axios');
const cheerio = require('cheerio'); // Не забудь npm install cheerio
const db = require('../../db');
const { Markup } = require('telegraf');

// --- ГЛАВНОЕ МЕНЮ ---
async function renderMainMenu(ctx) {
    const list = await db.getParcels(ctx.from.id);
    
    if (list.length === 0) {
        return ctx.reply('📦 У тебя нет отслеживаемых посылок.\nДобавь первую: /track [номер] [описание]');
    }

    let msg = '📦 *Твои посылки:*\n\n';
    const buttons = [];

    list.forEach(p => {
        const status = p.last_status || 'Ожидание...';
        const loc = p.last_location ? `(${p.last_location})` : '';
        const desc = p.description ? `— ${p.description}` : '';
        
        msg += `🔹 *${p.track_number}* ${desc}\nStatus: ${status} ${loc}\n\n`;
        
        buttons.push([
            Markup.button.callback(`🔄 ${p.track_number}`, `track_upd_${p.id}`),
            Markup.button.callback(`❌ Удалить`, `track_del_${p.id}`)
        ]);
    });

    buttons.push([Markup.button.callback('➕ Добавить трек', 'track_add')]);

    await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

// --- ПАРСЕР (СЕРДЦЕ МОДУЛЯ) ---
async function fetchTrackingInfo(trackNumber) {
    // ⚠️ Тут может потребоваться подгонка под реальный сайт
    // QazPost часто грузит данные скриптами.
    // Попробуем универсальный API (например, 17track или похожие, если QazPost закрыт)
    // Но пока попробуем сымитировать заход на их сайт или использовать публичный API.
    
    try {
        // ВАРИАНТ 1: Прямой парсинг (Если сайт отдает HTML сразу)
        // const url = `https://qazpost.kz/en/t/${trackNumber}`;
        // const { data } = await axios.get(url);
        // const $ = cheerio.load(data);
        // const status = $('.tracking-status').text().trim(); // Класс выдуман, надо смотреть реальный
        
        // ВАРИАНТ 2: Использование стороннего бесплатного API (более надежно для бота)
        // Для примера используем заглушку, так как реальный парсинг QazPost требует анализа их Network Tab
        
        // Давай пока сделаем эмуляцию, чтобы ты проверил работу бота, 
        // а потом мы вставим сюда реальный запрос к API QazPost.
        
        // ЭМУЛЯЦИЯ (УДАЛИТЬ ПОТОМ):
        const mockStatuses = ['В пути', 'Прибыло в сортировочный центр', 'Таможенная очистка', 'Выдано курьеру'];
        const randomStatus = mockStatuses[Math.floor(Math.random() * mockStatuses.length)];
        
        return {
            status: randomStatus, // Тут должен быть реальный парсинг
            location: 'Almaty, Kazpost',
            isDelivered: false
        };

    } catch (e) {
        console.error(`Tracking Error (${trackNumber}):`, e.message);
        return null;
    }
}

// --- ОБНОВЛЕНИЕ СТАТУСОВ (ДЛЯ КРОНА И КНОПКИ) ---
async function checkParcel(bot, parcelId) {
    // Получаем посылку из БД (нам нужен номер)
    // Т.к. функции getParcelById нет, схитрим и получим список (оптимизируй потом)
    // В идеале добавить db.getParcel(id)
    const row = await db.dbGet('SELECT * FROM parcels WHERE id = ?', [parcelId]);
    if (!row) return;

    const info = await fetchTrackingInfo(row.track_number);
    if (!info) return; // Не удалось получить данные

    // Если статус изменился - уведомляем
    if (info.status !== row.last_status) {
        await db.updateParcelStatus(row.id, info.status, info.location, info.isDelivered);
        
        // Шлем уведомление
        try {
            await bot.telegram.sendMessage(row.user_id, 
                `🔔 *Обновление статуса посылки!*\n\n📦 ${row.track_number} (${row.description})\n🆕 Статус: ${info.status}\n📍 ${info.location}`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) { console.error('Send notify error:', e.message); }
    }
}

async function checkAllParcels(bot) {
    console.log('📦 Запуск проверки посылок...');
    const parcels = await db.dbAll('SELECT * FROM parcels WHERE is_delivered = 0');
    for (const p of parcels) {
        await checkParcel(bot, p.id);
        // Пауза 2 сек, чтобы не забанили
        await new Promise(r => setTimeout(r, 2000));
    }
}

// --- ОБРАБОТЧИКИ ---
async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    
    if (data === 'track_add') {
        ctx.session.state = { step: 'AWAITING_TRACK' };
        return ctx.reply('✍️ Введите трек-номер и описание через пробел.\nПример: `LM123456789CN Чехол на айфон`', { parse_mode: 'Markdown' });
    }

    if (data.startsWith('track_del_')) {
        const id = data.split('_')[2];
        await db.deleteParcel(id);
        await ctx.answerCbQuery('Удалено');
        return renderMainMenu(ctx);
    }

    if (data.startsWith('track_upd_')) {
        const id = data.split('_')[2];
        await ctx.answerCbQuery('Проверяю...');
        // Тут нужен инстанс бота, но у нас ctx.telegram работает
        await checkParcel({ telegram: ctx.telegram }, id); 
        return renderMainMenu(ctx);
    }
}

async function handleTrackUpload(ctx) {
    const text = ctx.message.text;
    const parts = text.split(' ');
    const track = parts[0];
    const desc = parts.slice(1).join(' ') || 'Посылка';

    if (track.length < 5) return ctx.reply('❌ Слишком короткий номер.');

    await db.addParcel(ctx.from.id, track, desc);
    ctx.session.state = {};
    await ctx.reply(`✅ Трек ${track} добавлен! Буду следить.`);
}

module.exports = { renderMainMenu, handleCallback, handleTrackUpload, checkAllParcels };

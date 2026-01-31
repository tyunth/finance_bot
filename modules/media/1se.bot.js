const { Composer } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const db = require('../../db');

const bot = new Composer();

// Папка для хранения видео
const VIDEO_DIR = path.resolve(__dirname, '../../media/1se');
if (!fs.existsSync(VIDEO_DIR)) {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

// Папка для черного видео
const BLACK_VIDEO_PATH = path.join(VIDEO_DIR, 'black_1sec.mp4');

// 1. ПРИЕМ ВИДЕО
bot.on('video', async (ctx) => {
    const video = ctx.message.video;
    
    // Проверка длительности (Telegram отдает целое число, например 3 или 4)
    // Если строго > 3, то отклоняем. (3.9 сек телеграм может показать как 4, поэтому можно поставить порог 4, если хочешь мягче)
    if (video.duration > 3) {
        return ctx.reply(`⏳ Слишком длинное видео (${video.duration} сек). Принимаю только до 3 секунд!`);
    }

    const msg = await ctx.reply('📥 Скачиваю кусочек дня...');
    
    try {
        // Получаем ссылку
        const fileLink = await ctx.telegram.getFileLink(video.file_id);
        
        // Генерируем имя файла: YYYY-MM-DD_TIMESTAMP.mp4
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `${dateStr}_${Date.now()}.mp4`;
        const filePath = path.join(VIDEO_DIR, fileName);

        // Скачиваем стримом
        const writer = fs.createWriteStream(filePath);
        const response = await axios({
            url: fileLink.href,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        // Ждем окончания записи
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // Сохраняем в БД
        await db.dbRun(
            'INSERT INTO one_second_videos (user_id, file_path, date) VALUES (?, ?, ?)',
            [ctx.from.id, filePath, dateStr]
        );

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `✅ Сохранил! Это твой ${dateStr}.`);

    } catch (e) {
        console.error(e);
        ctx.reply('Ошибка сохранения видео: ' + e.message);
    }
});

// 2. СКЛЕЙКА ФИЛЬМА (/movie)
bot.command('movie', async (ctx) => {
    const msg = await ctx.reply('🎬 Начинаю монтаж... Это займет время.');
    
    try {
        // Берем все видео пользователя, сортируем по дате
        const rows = await db.dbAll(
            'SELECT file_path FROM one_second_videos WHERE user_id = ? ORDER BY date ASC', 
            [ctx.from.id]
        );

        if (rows.length < 2) {
            return ctx.reply('⚠️ Нужно минимум 2 видео для создания фильма.');
        }

        // Создаем временный файл-список для FFmpeg (concat demuxer)
        // Формат: file '/path/to/file.mp4'
        const listFileName = path.join(VIDEO_DIR, `list_${ctx.from.id}.txt`);
        const outputFileName = path.join(VIDEO_DIR, `movie_${ctx.from.id}_${Date.now()}.mp4`);
        
        const fileContent = rows.map(r => `file '${r.file_path}'`).join('\n');
        fs.writeFileSync(listFileName, fileContent);

        // Запускаем FFmpeg
        // Перекодируем видео для сохранения пропорций вертикальных видео (1080x1920)
        
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(listFileName)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions([
                    '-c:v libx264',                    // Перекодировать видео в H.264
                    '-preset fast',                   // Быстрая перекодировка
                    '-crf 23',                       // Качество (23 = сбалансированное)
                    '-vf "scale=1080:1920"',         // Простое масштабирование для вертикального видео
                    '-c:a aac',                      // Аудио в AAC
                    '-b:a 128k',                     // Битрейт аудио
                    '-movflags +faststart'           // Для лучшей веб-совместимости
                ])
                .save(outputFileName)
                .on('end', resolve)
                .on('error', reject);
        });

        // Отправляем результат
        await ctx.replyWithVideo({ source: outputFileName }, { caption: '🎥 Твой фильм 1 Second Everyday!' });
        
        // Удаляем список и итоговый файл (исходники оставляем!)
        fs.unlinkSync(listFileName);
        fs.unlinkSync(outputFileName);

    } catch (e) {
        console.error(e);
        ctx.reply('Ошибка монтажа: ' + e.message);
    }
});

// --- ФУНКЦИИ ДЛЯ ВЕЧЕРНЕГО НАПОМИНАНИЯ ---

// Проверка, есть ли видео за сегодня у пользователя
async function checkVideoForToday(userId) {
    const today = new Date().toISOString().split('T')[0];
    const row = await db.dbGet(
        'SELECT id FROM one_second_videos WHERE user_id = ? AND date = ? AND is_automatic = 0',
        [userId, today]
    );
    return !!row; // true если есть реальное видео, false если нет
}

// Отправка вечернего напоминания
async function sendEveningReminder(bot, userId) {
    const hasVideo = await checkVideoForToday(userId);
    
    if (!hasVideo) {
        try {
            await bot.telegram.sendMessage(
                userId,
                '🎬 *Вечернее напоминание!*\nНе забудь загрузить свой кусочек дня!\nВидео должно быть не дольше 3 секунд.\nЕсли не успеешь — вместо него загрузится черное видео.',
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            console.error(`Не удалось отправить напоминание юзеру ${userId}:`, e.message);
        }
    }
}

// Автоматическая загрузка черного видео
async function uploadBlackVideo(userId) {
    const today = new Date().toISOString().split('T')[0];
    
    // Проверяем, существует ли черное видео
    if (!fs.existsSync(BLACK_VIDEO_PATH)) {
        console.error('Черное видео не найдено:', BLACK_VIDEO_PATH);
        return false;
    }
    
    // Проверяем, есть ли уже видео за сегодня (реальное или автоматическое)
    const existingRow = await db.dbGet(
        'SELECT id FROM one_second_videos WHERE user_id = ? AND date = ?',
        [userId, today]
    );
    
    if (existingRow) {
        console.log(`Видео за ${today} уже существует для пользователя ${userId}`);
        return false;
    }
    
    try {
        // Копируем черное видео в папку с видео пользователя
        const fileName = `${today}_${Date.now()}_black.mp4`;
        const filePath = path.join(VIDEO_DIR, fileName);
        fs.copyFileSync(BLACK_VIDEO_PATH, filePath);
        
        // Сохраняем в БД как автоматическое
        await db.dbRun(
            'INSERT INTO one_second_videos (user_id, file_path, date, is_automatic) VALUES (?, ?, ?, 1)',
            [userId, filePath, today]
        );
        
        console.log(`Черное видео загружено для пользователя ${userId} за ${today}`);
        return true;
    } catch (e) {
        console.error('Ошибка загрузки черного видео:', e);
        return false;
    }
}

// Экспортируем bot для телеграм-обработчика
module.exports = bot;

// Экспортируем функции для cron-задач
module.exports.checkVideoForToday = checkVideoForToday;
module.exports.sendEveningReminder = sendEveningReminder;
module.exports.uploadBlackVideo = uploadBlackVideo;

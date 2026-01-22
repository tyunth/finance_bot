const { Composer, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { getMainMenu } = require('../utilities/keyboard.js');

const bot = new Composer();

// Создаем директорию для файлов, если не существует
const filesDir = path.join(__dirname, '../../files');
if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(filesDir, { recursive: true });
}

// Команда для загрузки файла
bot.command('sendfile', async (ctx) => {
    await ctx.reply('📁 Отправьте файл (docx или pdf, до 10MB). Файл будет сохранен и доступен для скачивания через веб-интерфейс.');
});

// Обработка входящих документов
bot.on('document', async (ctx) => {
    const file = ctx.message.document;
    if (!file) return;

    // Проверяем тип файла
    const allowedMimes = [
        // PDF
        'application/pdf',
        // Word
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // Excel
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // PowerPoint
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        // Текстовые
        'text/plain',
        'text/rtf',
        'application/rtf'
    ];
    if (!allowedMimes.includes(file.mime_type)) {
        return ctx.reply('❌ Поддерживаются офисные документы и текстовые файлы.');
    }

    // Проверяем размер (10MB = 10 * 1024 * 1024 байт)
    const maxSize = 10 * 1024 * 1024;
    if (file.file_size > maxSize) {
        return ctx.reply('❌ Файл слишком большой. Максимум 10MB.');
    }

    try {
        // Получаем ссылку на файл
        const fileLink = await ctx.telegram.getFileLink(file.file_id);
        const response = await fetch(fileLink.href);
        const buffer = await response.buffer();

        // Генерируем уникальное имя файла
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.file_name);
        const filePath = path.join(filesDir, uniqueName);

        // Сохраняем файл
        fs.writeFileSync(filePath, buffer);

        // Сохраняем в БД
        const uploadDate = new Date().toISOString();
        const result = await db.dbRun(
            'INSERT INTO files (user_id, filename, original_name, upload_date, file_path) VALUES (?, ?, ?, ?, ?)',
            [ctx.from.id, uniqueName, file.file_name, uploadDate, filePath]
        );

        await ctx.reply(`✅ Файл "${file.file_name}" успешно загружен!\n📥 Скачать: /budzet/files/${result.lastID}`);

    } catch (e) {
        console.error('File upload error:', e);
        await ctx.reply('❌ Ошибка при загрузке файла. Попробуйте еще раз.');
    }
});

// Команда для просмотра списка файлов
bot.hears(['📁 Файлы', '/files'], async (ctx) => {
    try {
        const files = await db.dbAll(
            'SELECT id, filename, original_name, upload_date FROM files WHERE user_id = ? ORDER BY upload_date DESC LIMIT 10',
            [ctx.from.id]
        );

        if (files.length === 0) {
            return ctx.reply('📁 У вас нет загруженных файлов.');
        }

        let msg = '📁 *Ваши файлы:*\n\n';
        files.forEach(f => {
            const date = new Date(f.upload_date).toLocaleDateString('ru-RU');
            msg += `📄 ${f.original_name}\n📅 ${date}\n📥 Скачать: /budzet/files/${f.id}\n\n`;
        });

        await ctx.replyWithMarkdown(msg);
    } catch (e) {
        console.error('Files list error:', e);
        await ctx.reply('❌ Ошибка при получении списка файлов.');
    }
});

module.exports = bot;

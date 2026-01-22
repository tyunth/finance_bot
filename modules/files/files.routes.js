const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../../db');

// Создаем директорию для файлов, если не существует
const filesDir = path.join(__dirname, '../../files');
if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(filesDir, { recursive: true });
}

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, filesDir);
    },
    filename: (req, file, cb) => {
        // Генерируем уникальное имя файла
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

// Фильтр файлов (офисные документы и текстовые файлы)
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
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
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Недопустимый тип файла. Разрешены офисные документы и текстовые файлы.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit для офисных документов
    }
});

// --- МАРШРУТЫ ---

// Загрузка файла (требует аутентификации)
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }

        // Исправляем кодировку имени файла
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const { filename } = req.file;
        const userId = req.userId;
        const uploadDate = new Date().toISOString();
        const filePath = path.join(filesDir, filename);

        // Сохраняем в БД
        const result = await db.dbRun(
            'INSERT INTO files (user_id, filename, original_name, upload_date, file_path) VALUES (?, ?, ?, ?, ?)',
            [userId, filename, originalName, uploadDate, filePath]
        );

        res.json({
            id: result.lastID,
            filename: filename,
            original_name: originalName,
            upload_date: uploadDate
        });
    } catch (e) {
        console.error('Upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Получить список файлов пользователя (требует аутентификации)
router.get('/', async (req, res) => {
    try {
        const userId = req.userId;
        const files = await db.dbAll(
            'SELECT id, filename, original_name, upload_date FROM files WHERE user_id = ? ORDER BY upload_date DESC',
            [userId]
        );
        res.json(files);
    } catch (e) {
        console.error('Get files error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Скачивание файла (открыто для всех, по ID)
router.get('/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        const file = await db.dbGet('SELECT * FROM files WHERE id = ?', [fileId]);

        if (!file) {
            return res.status(404).json({ error: 'Файл не найден' });
        }

        // Проверяем, существует ли файл на диске
        if (!fs.existsSync(file.file_path)) {
            return res.status(404).json({ error: 'Файл не найден на сервере' });
        }

        // Отправляем файл с правильной кодировкой имени
        const encodedFilename = encodeURIComponent(file.original_name);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
        res.sendFile(file.file_path);
    } catch (e) {
        console.error('Download error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Удаление файла (требует аутентификации и владения)
router.delete('/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        const userId = req.userId;

        const file = await db.dbGet('SELECT * FROM files WHERE id = ? AND user_id = ?', [fileId, userId]);

        if (!file) {
            return res.status(404).json({ error: 'Файл не найден или нет доступа' });
        }

        // Удаляем файл с диска
        if (fs.existsSync(file.file_path)) {
            fs.unlinkSync(file.file_path);
        }

        // Удаляем из БД
        await db.dbRun('DELETE FROM files WHERE id = ?', [fileId]);

        res.json({ success: true });
    } catch (e) {
        console.error('Delete file error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;

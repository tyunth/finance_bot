const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const { open } = sqlite;

// Имя файла базы данных SQLite
const DATABASE_FILE = 'finance.db';

let db;

/**
 * Инициализирует соединение с базой данных и создает таблицы, если они не существуют.
 * Должна быть вызвана перед любыми другими операциями с БД.
 */
async function initializeDb() {
    try {
        db = await open({
            filename: DATABASE_FILE,
            driver: sqlite3.Database
        });

        // Таблица транзакций
        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                type TEXT, -- 'income', 'expense', 'transfer'
                amount REAL,
                category TEXT,
                tags TEXT,
                source_account_id INTEGER,
                target_account_id INTEGER,
                date TEXT,
                description TEXT
            );
        `);

        // Таблица счетов
        await db.exec(`
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                name TEXT UNIQUE,
                balance REAL,
                is_deposit INTEGER,
                interest_rate REAL,
                created_at TEXT
            );
        `);

        // Таблица для управления категориями (Задача 5)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER DEFAULT 1,
                name TEXT UNIQUE NOT NULL,
                type TEXT CHECK(type IN ('income', 'expense'))
            );
        `);
        
        console.log("База данных и необходимые таблицы инициализированы.");
    } catch (e) {
        console.error("Ошибка при инициализации базы данных:", e);
        // Не выбрасываем ошибку, чтобы не сломать main.js бота при неудаче инициализации
    }
}

// --- UTILITY ФУНКЦИИ ---

function formatTransactionRow(transaction) {
    const amountStr = transaction.amount.toFixed(2);
    // Определяем направление
    const direction = transaction.type === 'income' ? '+' : (transaction.type === 'expense' ? '-' : '->');
    
    return (
        `ID: ${transaction.id} | ` +
        `Сумма: ${direction}${amountStr} | ` +
        `Категория: ${transaction.category} | ` +
        `Комментарий: ${transaction.description || 'Нет'}`
    );
}

// --- ФУНКЦИИ ПРОСМОТРА (Задачи 2 и 3) ---

/**
 * Задача 2: Возвращает список из N последних транзакций.
 * @param {number} limit - Количество транзакций.
 * @returns {Promise<string>}
 */
async function getLatestTransactions(limit = 10) {
    try {
        if (!db) await initializeDb();
        
        const transactions = await db.all(`
            SELECT id, type, amount, category, description, date 
            FROM transactions 
            ORDER BY date DESC 
            LIMIT ?
        `, limit);
        
        if (transactions.length === 0) {
            return "Транзакции не найдены.";
        }
            
        const output = transactions.map(formatTransactionRow);
        return "**Последние транзакции:**\n" + output.join("\n");

    } catch (e) {
        return `Ошибка базы данных: ${e.message}`;
    }
}

/**
 * Задача 3: Возвращает список транзакций за указанную дату (YYYY-MM-DD).
 * @param {string} dateStr - Дата в формате YYYY-MM-DD.
 * @returns {Promise<string>}
 */
async function getTransactionsByDate(dateStr) {
    // Проверка формата даты
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return "Неверный формат даты. Используйте YYYY-MM-DD (например, 2025-12-05).";
    }

    const searchPattern = `${dateStr}%`;
    
    try {
        if (!db) await initializeDb();
        
        const transactions = await db.all(`
            SELECT id, type, amount, category, description, date 
            FROM transactions 
            WHERE date LIKE ? 
            ORDER BY date DESC
        `, searchPattern);
        
        if (transactions.length === 0) {
            return `Транзакции за ${dateStr} не найдены.`;
        }
            
        const output = transactions.map(formatTransactionRow);
        return `**Транзакции за ${dateStr}:**\n` + output.join("\n");

    } catch (e) {
        return `Ошибка базы данных: ${e.message}`;
    }
}

// --- ФУНКЦИИ РЕДАКТИРОВАНИЯ/УДАЛЕНИЯ (Задача 4) ---

/**
 * Задача 4: Обновляет поля транзакции по ID.
 * Команда: /управление_записью (или /tx_edit)
 * @param {number} txId - ID транзакции.
 * @param {Object} updates - Объект с полями для обновления: {поле: значение}.
 * @returns {Promise<string>}
 */
async function updateTransaction(txId, updates) {
    if (!updates || Object.keys(updates).length === 0) {
        return "Необходимо указать поля для обновления.";
    }

    const setClauses = [];
    const values = [];
    
    const allowedFields = ['type', 'amount', 'category', 'description', 'tags', 'source_account_id', 'target_account_id', 'date'];

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            setClauses.push(`${key} = ?`);
            values.push(value);
        }
    }
        
    if (setClauses.length === 0) {
        return "Неверные поля для обновления.";
    }

    values.push(txId);
    const query = `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = ?`;
    
    try {
        if (!db) await initializeDb();
        
        const result = await db.run(query, values);
        
        if (result.changes === 0) {
            return `Транзакция с ID ${txId} не найдена.`;
        }
            
        return `Транзакция ID ${txId} успешно обновлена.`;
    } catch (e) {
        return `Ошибка базы данных при обновлении: ${e.message}`;
    }
}

/**
 * Задача 4: Удаляет транзакцию по ID.
 * @param {number} txId - ID транзакции.
 * @returns {Promise<string>}
 */
async function deleteTransaction(txId) {
    try {
        if (!db) await initializeDb();
        
        const result = await db.run("DELETE FROM transactions WHERE id = ?", txId);
        
        if (result.changes === 0) {
            return `Транзакция с ID ${txId} не найдена.`;
        }
            
        return `Транзакция ID ${txId} успешно удалена.`;
    } catch (e) {
        return `Ошибка базы данных при удалении: ${e.message}`;
    }
}

// --- ФУНКЦИИ УПРАВЛЕНИЯ КАТЕГОРИЯМИ (Задача 5) ---

/**
 * Задача 5: Добавляет новую категорию ('income' или 'expense').
 * Команда: /categories добавить <имя> <тип>
 * @param {string} name - Имя категории.
 * @param {string} catType - Тип: 'income' или 'expense'.
 * @returns {Promise<string>}
 */
async function addCategory(name, catType) {
    if (!['income', 'expense'].includes(catType)) {
        return "Тип категории должен быть 'income' (доход) или 'expense' (расход).";
    }
        
    try {
        if (!db) await initializeDb();
        
        await db.run("INSERT INTO categories (name, type) VALUES (?, ?)", name, catType);
        return `Категория '${name}' (${catType}) успешно добавлена.`;
    } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) {
            return `Категория '${name}' уже существует.`;
        }
        return `Ошибка базы данных при добавлении категории: ${e.message}`;
    }
}

/**
 * Задача 5: Удаляет категорию по имени.
 * Команда: /categories удалить <имя>
 * @param {string} name - Имя категории.
 * @returns {Promise<string>}
 */
async function deleteCategory(name) {
    try {
        if (!db) await initializeDb();
        
        const result = await db.run("DELETE FROM categories WHERE name = ?", name);
        
        if (result.changes === 0) {
            return `Категория '${name}' не найдена.`;
        }
            
        return `Категория '${name}' успешно удалена.`;
    } catch (e) {
        return `Ошибка базы данных при удалении категории: ${e.message}`;
    }
}

/**
 * Задача 5: Возвращает список всех существующих категорий.
 * Команда: /categories список
 * @returns {Promise<string>}
 */
async function listCategories() {
    try {
        if (!db) await initializeDb();
        
        const categories = await db.all("SELECT name, type FROM categories ORDER BY type, name");
        
        if (categories.length === 0) {
            return "Категории не найдены. Используйте /categories добавить <имя> <тип>.";
        }
            
        const output = ["**Список категорий:**"];
        for (const cat of categories) {
            const catType = cat.type === 'income' ? "Доход" : "Расход";
            output.push(`- ${cat.name} (${catType})`);
        }
        return output.join("\n");
    } catch (e) {
        return `Ошибка базы данных: ${e.message}`;
    }
}

// Экспорт функций для использования в основном файле бота
module.exports = {
    initializeDb,
    getLatestTransactions,
    getTransactionsByDate,
    updateTransaction,
    deleteTransaction,
    addCategory,
    deleteCategory,
    listCategories,
};
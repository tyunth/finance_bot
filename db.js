const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.resolve(__dirname, 'finance.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('Подключение к SQLite успешно.');
        initializeTables();
    }
});

function initializeTables() {
    db.serialize(() => {
        // --- 1. Создание таблиц ---
        
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount REAL, category TEXT, tag TEXT, comment TEXT, date TEXT, source_account TEXT, target_account TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, balance REAL DEFAULT 0, is_deposit INTEGER DEFAULT 0, rate REAL DEFAULT 0, term_date TEXT, bank_name TEXT, start_date TEXT, UNIQUE(user_id, name)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS processed_events (
            event_id TEXT PRIMARY KEY, summary TEXT, date TEXT, status TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, student_name TEXT, subject TEXT, amount REAL, date TEXT, event_id TEXT, is_paid INTEGER DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS receipt_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_id INTEGER, product_name TEXT, quantity REAL, price REAL, amount REAL, category TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, subject TEXT, parents TEXT, school TEXT, grade TEXT, teacher TEXT, phone TEXT, address TEXT, notes TEXT, parent_phone TEXT, lessons_per_week INTEGER DEFAULT 0, schedule_days TEXT DEFAULT ''
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS shopping_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT, is_bought INTEGER DEFAULT 0, type TEXT DEFAULT 'buy', price_estimate REAL DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS utility_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, service_name TEXT, value_read REAL, amount_paid REAL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS lesson_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_name TEXT, date TEXT, status TEXT, reason TEXT, lost_income REAL DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, is_done INTEGER DEFAULT 0, period TEXT DEFAULT 'urgent'
        )`);


        // --- 2. Миграции (ЛЕЧИМ БАЗУ) ---

        // Список всех колонок, которые могли потеряться или новые
        const tablesToUpdate = {
            'shopping_list': [
                "is_bought INTEGER DEFAULT 0", // <--- ВОТ ЛЕКАРСТВО ОТ ТВОЕЙ ОШИБКИ
                "type TEXT DEFAULT 'buy'",
                "created_at TEXT", 
                "completed_at TEXT", 
                "deleted_at TEXT",
                "sort_order INTEGER DEFAULT 0"
            ],
            'todos': [
                "period TEXT DEFAULT 'urgent'",
                "created_at TEXT", 
                "completed_at TEXT", 
                "deleted_at TEXT"
            ],
            'students': [
                "schedule_days TEXT DEFAULT ''"
            ]
        };

        // Проходим по всем таблицам и пытаемся добавить колонки
        for (const [table, columns] of Object.entries(tablesToUpdate)) {
            columns.forEach(colDefinition => {
                db.run(`ALTER TABLE ${table} ADD COLUMN ${colDefinition}`, (err) => {
                    // Игнорируем ошибку, если колонка уже есть (duplicate column)
                });
            });
        }
    });
}

// Обертки
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(e) { e ? reject(e) : resolve(this) }));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, r) => e ? reject(e) : resolve(r)));
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (e, r) => e ? reject(e) : resolve(r)));

// --- БИЗНЕС-ЛОГИКА ---

// Счета
async function ensureMainAccount(userId) {
    try { await dbRun('INSERT OR IGNORE INTO accounts (user_id, name, balance) VALUES (?, ?, ?)', [userId, 'Основной', 0]); } catch (e) {}
}

async function getBalances(userId) {
    const accountsList = await dbAll('SELECT name, is_deposit, rate, term_date, bank_name, start_date FROM accounts WHERE user_id = ?', [userId]);
    const balances = {};
    accountsList.forEach(a => balances[a.name] = 0);
    if (!balances['Основной']) balances['Основной'] = 0;

    const transactions = await dbAll('SELECT type, amount, source_account, target_account FROM transactions WHERE user_id = ?', [userId]);
    transactions.forEach(t => {
        if (t.type === 'income' && t.target_account) balances[t.target_account] = (balances[t.target_account] || 0) + t.amount;
        else if (t.type === 'expense' && t.source_account) balances[t.source_account] = (balances[t.source_account] || 0) - t.amount;
        else if (t.type === 'transfer') {
            if (t.source_account) balances[t.source_account] = (balances[t.source_account] || 0) - t.amount;
            if (t.target_account) balances[t.target_account] = (balances[t.target_account] || 0) + t.amount;
        }
    });
    return { balances, accountsList };
}

// Транзакции
async function addTransaction(data) {
    const { 
        userId, type, amount, category, tag, comment, 
        sourceAccount, targetAccount, lesson_type,
        receipt_id = null 
        // date отсюда убрали, чтобы не мешался
    } = data;

    // Создаем переменную txDate (которую ты используешь в массиве ниже)
    // Берем либо дату из объекта data, либо текущую
    const txDate = data.date || new Date().toISOString();

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, category, tag, comment, source_account, target_account, lesson_type, receipt_id, date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [
                userId, type, amount, category, tag, comment, 
                sourceAccount, targetAccount, lesson_type, 
                receipt_id, 
                txDate // <--- Теперь эта переменная существует и она правильная
            ], 
            function (err) {
                if (err) return reject(err);
                // Тут у тебя должен быть вызов updateBalance, не забудь его раскомментить в реальном коде
                resolve({ lastID: this.lastID });
            }
        );
    });
}

// Статистика
async function getPeriodStats(userId, startDate) {
    const rows = await dbAll(`SELECT type, amount FROM transactions WHERE user_id = ? AND type IN ('income', 'expense') AND date >= ?`, [userId, startDate]);
    let income = 0, expense = 0;
    rows.forEach(t => {
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
    });
    return { income, expense };
}

async function getCategoryStats(userId, startDate) {
    const rows = await dbAll(`SELECT category, amount FROM transactions WHERE user_id = ? AND type = 'expense' AND date >= ?`, [userId, startDate]);
    const stats = {};
    rows.forEach(r => {
        stats[r.category] = (stats[r.category] || 0) + r.amount;
    });
    return stats;
}

// Календарь и Долги
async function isEventProcessed(eventId) {
    const row = await dbGet('SELECT event_id FROM processed_events WHERE event_id = ?', [eventId]);
    return !!row;
}
async function markEventProcessed(eventId, summary, status) {
    const date = new Date().toISOString();
    await dbRun('INSERT OR REPLACE INTO processed_events (event_id, summary, date, status) VALUES (?, ?, ?, ?)', [eventId, summary, date, status]);
}
async function addDebt(userId, studentName, subject, amount, eventId) {
    const date = new Date().toISOString();
    await dbRun('INSERT INTO debts (user_id, student_name, subject, amount, date, event_id) VALUES (?, ?, ?, ?, ?, ?)', 
        [userId, studentName, subject, amount, date, eventId]);
}
async function getDebts(userId) {
    return dbAll('SELECT * FROM debts WHERE user_id = ? AND is_paid = 0', [userId]);
}

// Чеки и Категоризация
async function getProductCategory(rawName) {
    const cleanName = rawName.trim(); 
    const row = await dbGet('SELECT category FROM product_mappings WHERE raw_name = ?', [cleanName]);
    return row ? row.category : null;
}
async function learnProductCategory(rawName, category) {
    const cleanName = rawName.trim();
    await dbRun('INSERT OR REPLACE INTO product_mappings (raw_name, category) VALUES (?, ?)', [cleanName, category]);
}
async function saveReceiptItems(transactionId, shopName, items, dateStr) {
    const date = dateStr || new Date().toISOString();
    for (const item of items) {
        await dbRun(
            `INSERT INTO receipt_items (transaction_id, item_name, price, quantity, shop_name, date) VALUES (?, ?, ?, ?, ?, ?)`,
            [transactionId, item.name, item.price, 1, shopName, date]
        );
    }
}
async function getCategoryByComment(comment) {
    if (!comment) return null;
    const cleanComment = comment.trim().toLowerCase();
    const row = await dbGet('SELECT category FROM keywords WHERE keyword = ?', [cleanComment]);
    return row ? row.category : null;
}
async function learnKeyword(comment, category) {
    if (!comment) return;
    const cleanComment = comment.trim().toLowerCase();
    if (cleanComment.length > 50) return;
    await dbRun('INSERT OR REPLACE INTO keywords (keyword, category) VALUES (?, ?)', [cleanComment, category]);
}
async function wasInterestPaidThisMonth(userId, accountName) {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); 
    const row = await dbGet(
        `SELECT id FROM transactions WHERE user_id = ? AND category = 'Проценты' AND target_account = ? AND date LIKE ?`, 
        [userId, accountName, `${currentMonth}%`]
    );
    return !!row;
}

// --- УЧЕНИКИ ---
async function getStudents() {
    return dbAll('SELECT * FROM students ORDER BY name ASC');
}
async function addStudent(data) {
    const { name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week } = data;
    return dbRun(
        `INSERT INTO students (name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week || 0]
    );
}
async function updateStudent(data) {
    const { id, name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week, schedule_days } = data;
    return dbRun(
        `UPDATE students SET name=?, subject=?, parents=?, school=?, grade=?, teacher=?, phone=?, address=?, notes=?, parent_phone=?, lessons_per_week=?, schedule_days=?
         WHERE id=?`,
        [name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week || 0, schedule_days || '', id]
    );
}
async function deleteStudent(id) {
    return dbRun('DELETE FROM students WHERE id = ?', [id]);
}
async function getStudentStats(studentName) {
    return dbAll(
        `SELECT * FROM transactions WHERE type = 'income' AND tag = ? ORDER BY date DESC`, 
        [`Ученик: ${studentName}`]
    );
}

// --- СПИСОК ПОКУПОК ---

async function getShoppingList() {
    return new Promise((resolve, reject) => {
        // ИЗМЕНЕНИЕ В SQL:
        // Пишем "SELECT *, item_name AS title ...", чтобы получить и старые поля, и новое title
        db.all("SELECT *, item_name AS title FROM shopping_list WHERE deleted_at IS NULL ORDER BY sort_order ASC, id DESC", [], (err, rows) => {
            if (err) reject(err);
            else {
                // Оставляем твою логику маппинга, она правильная и нужна для фронтенда
                const fixedRows = rows.map(r => ({
                    ...r,
                    // Гарантируем, что title есть (хотя SQL выше это уже сделал)
                    title: r.title || r.item_name, 
                    
                    // Поля совместимости (не трогаем)
                    is_bought: r.is_bought, 
                    is_done: r.is_bought,           
                    checked: !!r.is_bought,       
                    status: r.is_bought ? 'bought' : 'active' 
                }));
                resolve(fixedRows);
            }
        });
    });
}

// Функция принимает объект, так как сервер шлет объект data
async function addShoppingItem(data) {
    // Принимаем title или text (для совместимости), или по старинке item_name
    const title = data.title || data.text || data.item_name; 
    const type = data.type || 'buy';
    const price = data.price_estimate || 0;

    if (!title) {
        console.error('❌ addShoppingItem: Нет названия (title)!', data);
        return;
    }

    const now = new Date().toISOString();
    // В базу пишем в колонку item_name, но берем из переменной title
    return dbRun(
        'INSERT INTO shopping_list (item_name, is_bought, type, price_estimate, created_at) VALUES (?, 0, ?, ?, ?)', 
        [title, type, price, now]
    );
}

async function updateShoppingStatus(id, isBought) {
    const now = new Date().toISOString();
    const completedAt = isBought ? now : null;
    
    // Принудительно приводим к числу (0 или 1), чтобы SQLite не тупил
    const val = isBought ? 1 : 0;

    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE shopping_list SET is_bought = ?, completed_at = ? WHERE id = ?', 
            [val, completedAt, id],
            function (err) {
                if (err) {
                    console.error('❌ DB Update Error:', err);
                    reject(err);
                } else {
                    console.log(`✅ Updated ID ${id}: set is_bought = ${val}, changed: ${this.changes}`);
                    resolve({ id: this.lastID, changes: this.changes });
                }
            }
        );
    });
}

async function deleteShoppingItem(id) {
    const now = new Date().toISOString();
    return dbRun('UPDATE shopping_list SET deleted_at = ? WHERE id = ?', [now, id]);
}

async function reorderShoppingList(ids) {
    const promises = ids.map((id, index) => {
        return dbRun("UPDATE shopping_list SET sort_order = ? WHERE id = ?", [index, id]);
    });
    return Promise.all(promises);
}

// --- КОММУНАЛКА ---
async function getUtilityReadings() {
    return dbAll("SELECT * FROM utility_readings ORDER BY date DESC");
}
async function addUtilityReading(data) {
    const { date, service, reading, amount, comment } = data;
    return dbRun(
        `INSERT INTO utility_readings (date, service, reading, amount, comment) VALUES (?, ?, ?, ?, ?)`,
        [date, service, reading || 0, amount, comment]
    );
}
async function deleteUtilityReading(id) {
    return dbRun("DELETE FROM utility_readings WHERE id = ?", [id]);
}

// --- ПРОЧЕЕ ---
async function getLessonCount(monthStr) {
    const result = await dbGet(
        `SELECT COUNT(*) as count FROM transactions 
         WHERE type = 'income' AND category = 'Репетиторство' AND date LIKE ?`, 
        [`${monthStr}%`]
    );
    return result ? result.count : 0;
}

async function payDebt(debtId) {
    const debt = await dbGet('SELECT * FROM debts WHERE id = ?', [debtId]);
    if (!debt) throw new Error('Долг не найден');
    await addTransaction({
        userId: debt.user_id,
        type: 'income',
        amount: debt.amount,
        category: 'Репетиторство',
        tag: `Ученик: ${debt.student_name}`,
        comment: `Оплата долга (${debt.subject}) от ${debt.date.slice(0, 10)}`,
        sourceAccount: null,
        targetAccount: 'Основной'
    });
    await dbRun('UPDATE debts SET is_paid = 1 WHERE id = ?', [debtId]);
    return true;
}

// --- СПИСОК ДЕЛ (TO-DO) ---
async function getTodos() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM todos WHERE deleted_at IS NULL", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function addTodo(text, period) {
    const p = period || 'urgent';
    const now = new Date().toISOString();
    return dbRun(
        'INSERT INTO todos (text, is_done, period, created_at) VALUES (?, 0, ?, ?)', 
        [text, p, now]
    );
}

async function toggleTodo(id, isDone) {
    const now = new Date().toISOString();
    const completedAt = isDone ? now : null;
    return dbRun(
        'UPDATE todos SET is_done = ?, completed_at = ? WHERE id = ?', 
        [isDone, completedAt, id]
    );
}

async function deleteTodo(id) {
    const now = new Date().toISOString();
    return dbRun('UPDATE todos SET deleted_at = ? WHERE id = ?', [now, id]);
}

// --- ИСТОРИЯ УРОКОВ ---
async function addLessonHistory(data) {
    const { studentId, studentName, date, status, reason, lostIncome } = data;
    return dbRun(
        `INSERT INTO lesson_history (student_id, student_name, date, status, reason, lost_income) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [studentId, studentName, date, status, reason, lostIncome || 0]
    );
}

async function checkLessonHistoryExists(studentName, dateStr) {
    const row = await dbGet(
        `SELECT id FROM lesson_history WHERE student_name = ? AND date LIKE ?`, 
        [studentName, `${dateStr}%`]
    );
    return !!row;
}

async function createReceipt(userId, data, photoFileId) {
    const created = new Date().toISOString();
    
    // 1. Создаем запись чека
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO receipts (user_id, shop_name, shop_address, date, total_sum, calculated_sum, item_count, discount, raw_json, photo_file_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, 
                data.shop.name || 'Магазин', 
                data.shop.address || '', 
                data.date, 
                data.meta.total_receipt, 
                data.meta.total_calculated, 
                data.items.length, 
                data.meta.discount || 0, 
                JSON.stringify(data), 
                photoFileId, 
                created
            ],
            async function (err) {
                if (err) return reject(err);
                
                const receiptId = this.lastID;

                // 2. Создаем транзакции для каждого товара
                // (Используем нашу же функцию addTransaction, чтобы обновились балансы!)
                try {
                    for (const item of data.items) {
                        // Тут можно подключить getUserSettings, когда сделаем его
                        // Пока хардкод или передача извне, но упростим:
                        const tag = 'Покупка'; // Или передавай маппинг тегов сюда
                        
                        await addTransaction({
                            userId,
                            type: 'expense',
                            amount: item.sum,
                            category: item.category,
                            tag: tag,
                            comment: `${item.name} (${item.qty} шт)`,
                            sourceAccount: 'Основной', // Хардкод пока, потом параметризуем
                            targetAccount: null,
                            date: data.date,
                            receipt_id: receiptId // <--- ВОТ ОНО, СВЯЗЫВАНИЕ
                        });
                    }
                    resolve(receiptId);
                } catch (txErr) {
                    reject(txErr);
                }
            }
        );
    });
}

// Получить категории пользователя (возвращает простой массив строк)
async function getUserCategories(userId, type = 'expense') {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT name FROM categories WHERE user_id = ? AND type = ?", 
            [userId, type], 
            (err, rows) => {
                if (err) reject(err);
                // Превращаем [{name: 'Еда'}, {name: 'Дом'}] -> ['Еда', 'Дом']
                else resolve(rows.map(r => r.name)); 
            }
        );
    });
}

// (На будущее) Добавить новую категорию
async function addCategory(userId, name, type = 'expense') {
    return dbRun(
        "INSERT INTO categories (user_id, name, type, created_at) VALUES (?, ?, ?, ?)",
        [userId, name, type, new Date().toISOString()]
    );
}

// Получить последние удаленные элементы (Дела + Покупки)
async function getArchivedItems(limit = 15) {
    return new Promise((resolve, reject) => {
        // Объединяем две таблицы. 
        // В todos поле называется text, в shopping_list — item_name.
        // Приводим всё к общему знаменателю "title".
        const sql = `
            SELECT id, text AS title, 'todo' AS type, deleted_at FROM todos WHERE deleted_at IS NOT NULL
            UNION ALL
            SELECT id, item_name AS title, 'shop' AS type, deleted_at FROM shopping_list WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC LIMIT ?
        `;
        
        db.all(sql, [limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Восстановить элемент
async function restoreItem(type, id) {
    if (type === 'todo') {
        // Убираем метку удаления
        return dbRun('UPDATE todos SET deleted_at = NULL WHERE id = ?', [id]);
    }
    if (type === 'shop') {
        // Восстанавливаем и сразу ставим статус "Не куплено" (is_bought = 0)
        return dbRun('UPDATE shopping_list SET deleted_at = NULL, is_bought = 0 WHERE id = ?', [id]);
    }
}

// --- EXPORTS ---
module.exports = {
    db, dbRun, dbAll, dbGet,
    ensureMainAccount, addTransaction, getBalances, getPeriodStats, getCategoryStats,
    isEventProcessed, markEventProcessed, addDebt, getDebts,
    getProductCategory, learnProductCategory, saveReceiptItems,
    getCategoryByComment, learnKeyword, wasInterestPaidThisMonth,
    getStudents, addStudent, updateStudent, deleteStudent, getStudentStats,
    
    // Покупки
    getShoppingList, 
    addShoppingItem, 
    updateShoppingStatus, 
    deleteShoppingItem, 
    reorderShoppingList,

    getUtilityReadings, addUtilityReading, deleteUtilityReading, 
    getLessonCount, payDebt,
    getTodos, addTodo, toggleTodo, deleteTodo, 
    addLessonHistory, checkLessonHistoryExists, 
    createReceipt,
    getUserCategories, addCategory,
    getArchivedItems, restoreItem,
    DB_PATH
};

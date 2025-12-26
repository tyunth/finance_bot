// public/js/api.js

// 1. Определение User ID
const TG = window.Telegram?.WebApp;
let CURRENT_USER_ID = null;

if (TG && TG.initDataUnsafe && TG.initDataUnsafe.user) {
    CURRENT_USER_ID = TG.initDataUnsafe.user.id;
    TG.expand();
} else {
    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('userId');
    if (paramId) CURRENT_USER_ID = parseInt(paramId);
}

// 2. Базовая функция запроса
const BASE_URL = ''; // Если сервер там же, где и сайт. Если нет - укажи полный URL

async function request(endpoint, method = 'GET', body = null) {
    const headers = {
        'Content-Type': 'application/json' // <--- ВОТ ЭТО ИСПРАВЛЯЕТ ОШИБКУ СЕРВЕРА
    };

    if (CURRENT_USER_ID) {
        headers['X-User-Id'] = CURRENT_USER_ID;
    }

    const config = {
        method,
        headers
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    try {
        const res = await fetch(`${BASE_URL}${endpoint}`, config);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`Request failed: ${endpoint}`, e);
        throw e;
    }
}

// 3. Экспорт методов API по модулям

export const API = {
    // Пользователь
    user: {
        getMe: () => request('/users/me'),
        getConfig: () => request('/config')
    },
    
    // Финансы
    finance: {
        getTransactions: () => request('/transactions'),
        getBalances: () => request('/balances'),
        getCategories: () => request('/categories'),
        addTransaction: (data) => request('/transactions/add', 'POST', data),
        editTransaction: (data) => request('/transactions/edit', 'POST', data)
    },

    // Ученики
    students: {
        getAll: () => request('/students'),
        getStats: (id) => request(`/students/stats?id=${id}`),
        action: (data) => request('/students/action', 'POST', data), // add, edit, delete
        getDebts: () => request('/debts'),
        payDebt: (id) => request('/debts/pay', 'POST', { id })
    },

    // Покупки
    shopping: {
        getAll: () => request('/shopping'),
        action: (data) => request('/shopping/action', 'POST', data) // add, status, reorder...
    },

    // Задачи (Todo)
    todos: {
        getAll: () => request('/todos'),
        // add, toggle, delete, update_period
        action: (data) => request('/todos/action', 'POST', data) 
    },

    // Коммуналка
    utilities: {
        getAll: () => request('/utilities'),
        action: (data) => request('/utilities/action', 'POST', data)
    },

    // Корзина
    trash: {
        getAll: () => request('/trash'),
        restore: (type, id) => request('/trash/restore', 'POST', { type, id })
    },
    
    // KPI и Прочее
    stats: {
        getKPI: (month) => request(`/stats/kpi?month=${month}`)
    },
    
    admin: {
        getUsers: () => request('/admin/users'),
        updateModules: (telegramId, modules) => request('/admin/users/modules', 'POST', { telegramId, modules })
    }
};

export const getUserId = () => CURRENT_USER_ID;

// api.js

const TG = window.Telegram?.WebApp;
let CURRENT_USER_ID = null;

// 1. Инициализация ID пользователя
if (TG && TG.initDataUnsafe && TG.initDataUnsafe.user) {
    CURRENT_USER_ID = TG.initDataUnsafe.user.id;
    TG.expand();
} else {
    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('userId');
    if (paramId) CURRENT_USER_ID = parseInt(paramId);
}

const BASE_URL = '/budzet';

// 2. Универсальная функция fetch с проверкой авторизации
export async function fetchWithAuth(url, options = {}) {
    // Если заголовков нет, создаем объект
    if (!options.headers) options.headers = {};
    
    // Добавляем ID пользователя во все запросы
    if (CURRENT_USER_ID) {
        options.headers['X-User-Id'] = CURRENT_USER_ID;
    }

    const res = await fetch(url, options);
    
    if (res.status === 401) {
        // Если протух токен или нет доступа
        window.location.href = '/budzet/login.html';
        throw new Error('Unauthorized');
    }
    
    return res;
}

// 3. Обертка для JSON-запросов
async function request(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    
    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    try {
        // ВАЖНО: Используем fetchWithAuth вместо обычного fetch
        const res = await fetchWithAuth(`${BASE_URL}${endpoint}`, config);
        
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`Request failed: ${endpoint}`, e);
        throw e;
    }
}

// 4. Объект API
export const API = {
    getUserId: () => CURRENT_USER_ID,
    
    finance: {
        getTransactions: () => request('/transactions'),
        getBalances: () => request('/balances'),
        getCategories: () => request('/categories'),
        addTransaction: (data) => request('/transactions/add', 'POST', data),
        editTransaction: (data) => request('/transactions/edit', 'POST', data)
    },
    students: {
        getAll: () => request('/students'),
        getStats: (id) => request(`/students/stats?id=${id}`),
        action: (data) => request('/students/action', 'POST', data),
        getDebts: () => request('/debts'),
        payDebt: (id) => request('/debts/pay', 'POST', { id })
    },
    shopping: {
        getAll: () => request('/shopping'),
        action: (data) => request('/shopping/action', 'POST', data)
    },
    todos: {
        getAll: () => request('/todos'),
        action: (data) => request('/todos/action', 'POST', data)
    },
    utilities: {
        getAll: () => request('/utilities'),
        action: (data) => request('/utilities/action', 'POST', data)
    },
    words: {
        getAll: () => request('/words'),
        delete: (id) => request('/words/delete', 'POST', { id })
    },
    trash: {
        getAll: () => request('/trash'),
        restore: (type, id) => request('/trash/restore', 'POST', { type, id })
    },
    system: {
        getConfig: () => request('/config'),
        getKPI: (month) => request(`/stats/kpi?month=${month}`),
        getUsers: () => request('/admin/users'),
        updateModules: (telegramId, modules) => request('/admin/users/modules', 'POST', { telegramId, modules }),
        getMe: () => request('/users/me'),
        getSettings: () => request('/settings'),
        saveSetting: (key, value) => request('/settings', 'POST', { key, value })
    },
    usage: {
        getMyStats: () => request('/usage/me'),
        getAverageStats: (type, startDate, endDate) => {
            const params = new URLSearchParams();
            if (type) params.append('type', type);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            return request(`/admin/usage/average?${params}`);
        },
        getAllStats: (type, startDate, endDate) => {
            const params = new URLSearchParams();
            if (type) params.append('type', type);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            return request(`/admin/usage/all?${params}`);
        }
    },
    files: {
        getAll: () => request('/files'),
        upload: async (formData) => {
            const res = await fetchWithAuth(`${BASE_URL}/files/upload`, {
                method: 'POST',
                body: formData
            });
            if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
            return await res.json();
        },
        delete: (id) => request(`/files/${id}`, 'DELETE')
    }
};

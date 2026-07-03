class StorageService {

    static get(key) {
        return JSON.parse(localStorage.getItem(key) || "[]");
    }

    static save(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    static clear(key) {
        localStorage.removeItem(key);
    }

}
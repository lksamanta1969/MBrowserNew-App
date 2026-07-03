class CrudEngine {

    constructor(storageKey) {
        this.storageKey = storageKey;
    }

    getAll() {
        return StorageService.get(this.storageKey);
    }

    add(item) {
        const data = this.getAll();
        item.id = Date.now();
        data.push(item);
        StorageService.save(this.storageKey, data);
    }

    delete(id) {
        const data = this.getAll().filter(x => x.id !== id);
        StorageService.save(this.storageKey, data);
    }

    update(id, newItem) {
        const data = this.getAll();

        const index = data.findIndex(x => x.id === id);

        if(index >= 0){
            data[index] = newItem;
            data[index].id = id;
        }

        StorageService.save(this.storageKey, data);
    }

}
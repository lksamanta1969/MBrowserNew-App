class Events {

    constructor() {
        this.engine = new CrudEngine("mcal_events");
    }

    getAll() {
        return this.engine.getAll();
    }

    add(title, date, time, location) {

        const event = new EventModel(
            title,
            date,
            time,
            location
        );

        this.engine.add(event);
    }

    delete(id) {
        this.engine.delete(id);
    }

    update(id, title, date, time, location) {

        const event = new EventModel(
            title,
            date,
            time,
            location
        );

        this.engine.update(id, event);
    }

}
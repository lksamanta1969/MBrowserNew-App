const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createMNotesStore } = require("./MNotesStore");

const testDbPath = path.join(__dirname, "mnotes.test.json");

function cleanup() {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
}

function runStoreTests() {
    cleanup();
    const store = createMNotesStore(testDbPath);

    let list = store.listNotes();
    assert.deepStrictEqual(list, []);

    const legacy = store.importLegacyContent("First legacy line\nMore text");
    assert.strictEqual(legacy.success, true);
    assert.strictEqual(legacy.note.title, "First legacy line");
    assert.match(legacy.note.content, /More text/);

    const blocked = store.importLegacyContent("Should not import");
    assert.strictEqual(blocked.success, false);

    list = store.listNotes();
    assert.strictEqual(list.length, 1);

    const created = store.createNote({ title: "Second", content: "Body text" });
    assert.strictEqual(created.title, "Second");

    const updated = store.updateNote(created.id, {
        title: "Updated Second",
        content: "Changed body"
    });
    assert.strictEqual(updated.title, "Updated Second");
    assert.strictEqual(updated.content, "Changed body");
    assert.ok(updated.updatedAt >= updated.createdAt);

    const missing = store.updateNote("missing-id", { title: "Nope" });
    assert.strictEqual(missing, null);

    assert.ok(fs.existsSync(testDbPath));
    const saved = JSON.parse(fs.readFileSync(testDbPath, "utf8"));
    assert.strictEqual(saved.notes.length, 2);

    list = store.listNotes();
    assert.strictEqual(list.length, 2);
    assert.ok(list[0].updatedAt >= list[1].updatedAt);

    cleanup();
    console.log("MNotesStore tests passed.");
}

runStoreTests();

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    createMTubeStore,
    extractYouTubeVideoId,
    buildYouTubeEmbedUrl,
    buildYouTubeSearchUrl
} = require("./MTubeStore");

const testDbPath = path.join(__dirname, "mtube.test.json");
const testMediaPath = path.join(__dirname, "mtube.test.txt");

function cleanup() {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testMediaPath)) fs.unlinkSync(testMediaPath);
    if (fs.existsSync(`${testMediaPath}.bak`)) fs.unlinkSync(`${testMediaPath}.bak`);
}

function runStoreTests() {
    cleanup();
    fs.writeFileSync(testMediaPath, "local media fixture", "utf8");

    const store = createMTubeStore(testDbPath);
    const state = store.getState();
    assert.deepStrictEqual(state.searchHistory, []);
    assert.deepStrictEqual(state.recentlyOpened, []);
    assert.deepStrictEqual(state.savedVideos, []);
    assert.deepStrictEqual(state.localLibrary, []);

    assert.strictEqual(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.strictEqual(buildYouTubeSearchUrl("cats").includes("search_query=cats"), true);
    assert.match(buildYouTubeEmbedUrl("dQw4w9WgXcQ"), /embed\/dQw4w9WgXcQ/);

    const search = store.addSearchHistory("electron apps");
    assert.strictEqual(search.success, true);
    assert.strictEqual(search.entry.query, "electron apps");

    store.addSearchHistory("mbrowser");
    store.addSearchHistory("electron apps");
    assert.strictEqual(store.getState().searchHistory.length, 2);
    assert.strictEqual(store.getState().searchHistory[0].query, "electron apps");

    const recentSearch = store.addRecentlyOpened({ type: "search", query: "electron apps" });
    assert.strictEqual(recentSearch.success, true);

    const recentVideo = store.addRecentlyOpened({
        type: "youtube",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "Sample Video"
    });
    assert.strictEqual(recentVideo.success, true);
    assert.strictEqual(recentVideo.entry.videoId, "dQw4w9WgXcQ");

    const saved = store.addSavedVideo({
        url: "https://youtu.be/dQw4w9WgXcQ",
        title: "Saved Sample"
    });
    assert.strictEqual(saved.success, true);
    assert.strictEqual(saved.item.title, "Saved Sample");

    const savedAgain = store.addSavedVideo({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "Saved Updated"
    });
    assert.strictEqual(savedAgain.updated, true);
    assert.strictEqual(savedAgain.item.title, "Saved Updated");

    const badMedia = store.addLibraryItem({ path: testMediaPath });
    assert.strictEqual(badMedia.success, false);

    const mediaPath = path.join(__dirname, "mtube.test.mp3");
    fs.writeFileSync(mediaPath, "fake audio", "utf8");
    const library = store.addLibraryItem({ path: mediaPath, displayName: "Test Track" });
    assert.strictEqual(library.success, true);
    assert.strictEqual(library.item.available, true);

    const recentLocal = store.addRecentlyOpened({
        type: "local",
        libraryId: library.item.id,
        title: "Test Track"
    });
    assert.strictEqual(recentLocal.success, true);

    const stream = store.getLibraryStreamInfo(library.item.id);
    assert.strictEqual(stream.success, true);
    assert.ok(stream.size > 0);

    fs.unlinkSync(mediaPath);
    const missing = store.getLibraryStreamInfo(library.item.id);
    assert.strictEqual(missing.success, false);
    assert.match(missing.error, /unavailable/i);

    store.clearSearchHistory();
    assert.strictEqual(store.getState().searchHistory.length, 0);

    assert.ok(fs.existsSync(testDbPath));
    cleanup();
    if (fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);

    console.log("MTubeStore tests passed.");
}

runStoreTests();

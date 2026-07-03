const eventService = new Events();

function loadEvents() {

    const events = eventService.getAll();

    const list = document.getElementById("eventList");

    if (!list) return;

    let html = "";

    events.forEach(event => {

        html += `
        <div class="data-item">
            📅 ${event.date}
            |
            🕒 ${formatTime(event.time)}
            |
            📍 ${event.location}
            <br>
            <strong>${event.title}</strong>
        </div>
        `;

    });

    list.innerHTML = html;
}

function saveEvent() {

    const title = document.getElementById("eventTitle").value.trim();
    const date = document.getElementById("eventDate").value;
    const time = document.getElementById("eventTime").value;
    const location = document.getElementById("eventLocation").value.trim();

    if (!title || !date) {
        alert("Please enter Event Title and Date");
        return;
    }

    eventService.add(
        title,
        date,
        time,
        location
    );

    document.getElementById("eventTitle").value = "";
    document.getElementById("eventDate").value = "";
    document.getElementById("eventTime").value = "";
    document.getElementById("eventLocation").value = "";

    loadEvents();

    alert("Event Saved");
}
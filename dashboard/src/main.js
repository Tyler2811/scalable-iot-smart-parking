import './style.css';

const API_URL = 'http://127.0.0.1:3002';

document.querySelector('#app').innerHTML = `
  <div class="dashboard">
    <header class="header">
      <div>
        <h1>Smart Parking Dashboard</h1>
        <p>Car Park CP01 · Real-time IoT Monitoring</p>
      </div>

      <div class="connection">
        <span class="connection-dot"></span>
        <span>System Online</span>
      </div>
    </header>

    <main>
      <section class="summary-grid">
        <div class="summary-card">
          <span>Total Spaces</span>
          <strong id="totalSpaces">-</strong>
        </div>

        <div class="summary-card">
          <span>Occupied</span>
          <strong id="occupiedSpaces">-</strong>
        </div>

        <div class="summary-card">
          <span>Available</span>
          <strong id="availableSpaces">-</strong>
        </div>

        <div class="summary-card">
          <span>Occupancy</span>
          <strong id="occupancyPercentage">-%</strong>
        </div>
      </section>

      <section class="status-section">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h2>Parking Spaces</h2>
              <p>Current occupancy and sensor status</p>
            </div>

            <span id="lastUpdated">Updating...</span>
          </div>

          <div id="parkingSpaces" class="parking-grid"></div>
        </div>

        <div class="side-column">
          <div class="panel">
            <h2>System Status</h2>

            <div class="status-row">
              <span>Alert Level</span>
              <strong id="alertLevel">-</strong>
            </div>

            <div class="status-row">
              <span>Online Sensors</span>
              <strong id="onlineSensors">-</strong>
            </div>

            <div class="status-row">
              <span>Offline Sensors</span>
              <strong id="offlineSensors">-</strong>
            </div>
          </div>

          <div class="panel">
            <h2>Recent Alerts</h2>
            <div id="alerts" class="alerts">
              <p class="empty-message">Loading alerts...</p>
            </div>
          </div>
        </div>
      </section>

      <section class="panel events-panel">
        <div class="panel-header">
          <div>
            <h2>Recent Parking Events</h2>
            <p>Latest sensor activity stored in AWS DynamoDB</p>
          </div>
        </div>

        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Space</th>
                <th>Status</th>
                <th>Sensor</th>
                <th>Sequence</th>
                <th>Time</th>
              </tr>
            </thead>

            <tbody id="events"></tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
`;

async function getJson(path) {
  const response = await fetch(`${API_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '-';
  }

  return new Date(timestamp).toLocaleString();
}

function renderSummary(summary) {
  document.querySelector('#totalSpaces').textContent =
    summary.totalSpaces;

  document.querySelector('#occupiedSpaces').textContent =
    summary.occupiedSpaces;

  document.querySelector('#availableSpaces').textContent =
    summary.availableSpaces;

  document.querySelector('#occupancyPercentage').textContent =
    `${summary.occupancyPercentage}%`;

  document.querySelector('#onlineSensors').textContent =
    summary.onlineSensors;

  document.querySelector('#offlineSensors').textContent =
    summary.offlineSensors;

  const alertElement = document.querySelector('#alertLevel');

  alertElement.textContent =
    summary.alertLevel.replace('_', ' ');

  alertElement.className =
    `alert-level ${summary.alertLevel.toLowerCase()}`;
}

function renderSpaces(spaces) {
  const container = document.querySelector('#parkingSpaces');

  container.innerHTML = spaces.map(space => {
    const occupancyClass =
      space.occupied ? 'occupied' : 'available';

    const occupancyText =
      space.occupied ? 'Occupied' : 'Available';

    const sensorClass =
      space.sensorStatus === 'online'
        ? 'sensor-online'
        : 'sensor-offline';

    return `
      <div class="parking-space ${occupancyClass}">
        <div class="space-top">
          <strong>${space.spaceId}</strong>

          <span class="sensor ${sensorClass}">
            ${space.sensorStatus}
          </span>
        </div>

        <div class="parking-icon">P</div>

        <span class="space-status">
          ${occupancyText}
        </span>
      </div>
    `;
  }).join('');
}

function renderAlerts(alerts) {
  const container = document.querySelector('#alerts');

  if (alerts.length === 0) {
    container.innerHTML =
      '<p class="empty-message">No alerts recorded.</p>';

    return;
  }

  container.innerHTML = alerts.slice(0, 5).map(alert => `
    <div class="alert-item">
      <div>
        <strong>${alert.level.replace('_', ' ')}</strong>
        <span>${alert.occupancyPercentage}% occupancy</span>
      </div>

      <small>${formatTime(alert.timestamp)}</small>
    </div>
  `).join('');
}

function renderEvents(events) {
  const container = document.querySelector('#events');

  container.innerHTML = events.map(event => `
    <tr>
      <td><strong>${event.spaceId}</strong></td>

      <td>
        <span class="event-status ${
          event.occupied ? 'occupied-text' : 'available-text'
        }">
          ${event.occupied ? 'Occupied' : 'Available'}
        </span>
      </td>

      <td>${event.sensorStatus}</td>
      <td>${event.sequenceNumber ?? '-'}</td>
      <td>${formatTime(event.timestamp)}</td>
    </tr>
  `).join('');
}

async function loadDashboard() {
  try {
    const [summary, spaces, alerts, events] =
      await Promise.all([
        getJson('/api/parking/summary'),
        getJson('/api/parking/spaces'),
        getJson('/api/parking/alerts'),
        getJson('/api/parking/events?limit=10')
      ]);

    renderSummary(summary);
    renderSpaces(spaces);
    renderAlerts(alerts);
    renderEvents(events);

    document.querySelector('#lastUpdated').textContent =
      `Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    console.error('Dashboard error:', error);
  }
}

function setConnectionStatus(online) {
  const connection = document.querySelector('.connection');

  if (online) {
    connection.innerHTML = `
      <span class="connection-dot"></span>
      <span>System Online</span>
    `;
  } else {
    connection.innerHTML = `
      <span class="connection-dot offline-dot"></span>
      <span>API Offline</span>
    `;
  }
}

async function checkApiStatus() {
  try {
    const response = await fetch(`${API_URL}/health`, {
      cache: 'no-store'
    });

    setConnectionStatus(response.ok);
  } catch (error) {
    setConnectionStatus(false);
  }
}

loadDashboard();
checkApiStatus();

setInterval(loadDashboard, 5000);
setInterval(checkApiStatus, 5000);
const express = require('express');
const cors = require('cors');

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand
} = require('@aws-sdk/lib-dynamodb');

const app = express();

const PORT = 3002;
const TOTAL_SPACES = 10;

app.use(cors());
app.use(express.json());

const dynamoClient = new DynamoDBClient({
  region: 'ap-southeast-2'
});

const db = DynamoDBDocumentClient.from(dynamoClient);

async function scanTable(tableName) {
  let items = [];
  let lastKey;

  do {
    const result = await db.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey
      })
    );

    items = items.concat(result.Items || []);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'api-service'
  });
});

app.get('/api/parking/summary', async (req, res) => {
  try {
    const spaces = await scanTable('ParkingSpaces');

    const occupiedSpaces = spaces.filter(
      space => space.occupied === true
    ).length;

    const availableSpaces = TOTAL_SPACES - occupiedSpaces;

    const onlineSensors = spaces.filter(
      space => space.sensorStatus === 'online'
    ).length;

    const offlineSensors = spaces.filter(
      space => space.sensorStatus === 'offline'
    ).length;

    const occupancyPercentage =
      Math.round((occupiedSpaces / TOTAL_SPACES) * 100);

    let alertLevel = 'NORMAL';

    if (occupancyPercentage === 100) {
      alertLevel = 'FULL';
    } else if (occupancyPercentage >= 90) {
      alertLevel = 'NEAR_CAPACITY';
    }

    res.json({
      carParkId: 'CP01',
      totalSpaces: TOTAL_SPACES,
      occupiedSpaces,
      availableSpaces,
      occupancyPercentage,
      onlineSensors,
      offlineSensors,
      alertLevel
    });
  } catch (error) {
    console.error('Summary error:', error);

    res.status(500).json({
      error: 'Failed to load parking summary'
    });
  }
});

app.get('/api/parking/spaces', async (req, res) => {
  try {
    const spaces = await scanTable('ParkingSpaces');

    spaces.sort((a, b) =>
      a.spaceId.localeCompare(b.spaceId)
    );

    res.json(spaces);
  } catch (error) {
    console.error('Spaces error:', error);

    res.status(500).json({
      error: 'Failed to load parking spaces'
    });
  }
});

app.get('/api/parking/events', async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit) || 20;

    const limit = Math.min(
      Math.max(requestedLimit, 1),
      100
    );

    const events = await scanTable('ParkingEvents');

    events.sort(
      (a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
    );

    res.json(events.slice(0, limit));
  } catch (error) {
    console.error('Events error:', error);

    res.status(500).json({
      error: 'Failed to load parking events'
    });
  }
});

app.get('/api/parking/alerts', async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit) || 20;

    const limit = Math.min(
      Math.max(requestedLimit, 1),
      100
    );

    const alerts = await scanTable('ParkingAlerts');

    alerts.sort(
      (a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
    );

    res.json(alerts.slice(0, limit));
  } catch (error) {
    console.error('Alerts error:', error);

    res.status(500).json({
      error: 'Failed to load parking alerts'
    });
  }
});

app.listen(PORT, () => {
  console.log(`API Service running on port ${PORT}`);
  console.log('AWS Region: ap-southeast-2');
});
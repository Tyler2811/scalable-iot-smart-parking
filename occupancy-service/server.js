const express = require('express');

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');

const app = express();

const PORT = 3001;
const TOTAL_SPACES = 10;
const SENSOR_TIMEOUT = 60000;

app.use(express.json());

const dynamoClient = new DynamoDBClient({
  region: 'ap-southeast-2'
});

const db = DynamoDBDocumentClient.from(dynamoClient);

const parkingSpaces = {};

let currentAlertLevel = 'NORMAL';

for (let i = 1; i <= TOTAL_SPACES; i++) {
  const spaceId = `S${String(i).padStart(3, '0')}`;

  parkingSpaces[spaceId] = {
    occupied: false,
    sensorStatus: 'unknown',
    sequenceNumber: 0,
    lastUpdated: null
  };
}

function getParkingSummary() {
  const occupiedSpaces = Object.values(parkingSpaces)
    .filter(space => space.occupied).length;

  const availableSpaces = TOTAL_SPACES - occupiedSpaces;

  const occupancyPercentage =
    Math.round((occupiedSpaces / TOTAL_SPACES) * 100);

  return {
    carParkId: 'CP01',
    totalSpaces: TOTAL_SPACES,
    occupiedSpaces,
    availableSpaces,
    occupancyPercentage
  };
}

function getAlertLevel(occupancyPercentage) {
  if (occupancyPercentage === 100) {
    return 'FULL';
  }

  if (occupancyPercentage >= 90) {
    return 'NEAR_CAPACITY';
  }

  return 'NORMAL';
}

async function saveCapacityAlert(level, summary) {
  const timestamp = new Date().toISOString();

  const alert = {
    alertId: `CP01-${level}-${Date.now()}`,
    carParkId: 'CP01',
    alertType: 'CAPACITY',
    level,
    occupancyPercentage: summary.occupancyPercentage,
    occupiedSpaces: summary.occupiedSpaces,
    availableSpaces: summary.availableSpaces,
    timestamp
  };

  await db.send(
    new PutCommand({
      TableName: 'ParkingAlerts',
      Item: alert
    })
  );

  console.log('********************************');
  console.log(`CAPACITY ALERT: ${level}`);
  console.log(`Occupancy: ${summary.occupancyPercentage}%`);
  console.log('Alert saved to DynamoDB');
  console.log('********************************');
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'occupancy-service'
  });
});

app.post('/events', async (req, res) => {
  try {
    const event = req.body;

    if (
      !event.eventId ||
      !event.carParkId ||
      !event.spaceId ||
      typeof event.occupied !== 'boolean' ||
      !event.timestamp
    ) {
      return res.status(400).json({
        error: 'Invalid parking event'
      });
    }

    if (!parkingSpaces[event.spaceId]) {
      return res.status(400).json({
        error: 'Unknown parking space'
      });
    }

    // Store event only if this eventId does not already exist.
    try {
      await db.send(
        new PutCommand({
          TableName: 'ParkingEvents',
          Item: {
            eventId: event.eventId,
            carParkId: event.carParkId,
            spaceId: event.spaceId,
            occupied: event.occupied,
            sensorStatus: event.sensorStatus || 'online',
            sequenceNumber: event.sequenceNumber,
            timestamp: event.timestamp
          },
          ConditionExpression: 'attribute_not_exists(eventId)'
        })
      );
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        console.log('--------------------------------');
        console.log(`Duplicate event ignored: ${event.eventId}`);

        return res.json({
          message: 'Duplicate event ignored',
          eventId: event.eventId,
          duplicate: true
        });
      }

      throw error;
    }

    parkingSpaces[event.spaceId] = {
      occupied: event.occupied,
      sensorStatus: event.sensorStatus || 'online',
      sequenceNumber: event.sequenceNumber || 0,
      lastUpdated: event.timestamp
    };

    await db.send(
      new PutCommand({
        TableName: 'ParkingSpaces',
        Item: {
          spaceId: event.spaceId,
          carParkId: event.carParkId,
          occupied: event.occupied,
          sensorStatus: event.sensorStatus || 'online',
          sequenceNumber: event.sequenceNumber || 0,
          lastUpdated: event.timestamp
        }
      })
    );

    const summary = getParkingSummary();
    const newAlertLevel =
      getAlertLevel(summary.occupancyPercentage);

    if (newAlertLevel !== currentAlertLevel) {
      if (newAlertLevel !== 'NORMAL') {
        await saveCapacityAlert(newAlertLevel, summary);
      } else if (currentAlertLevel !== 'NORMAL') {
        console.log('Capacity returned to normal');
      }

      currentAlertLevel = newAlertLevel;
    }

    console.log('--------------------------------');
    console.log(`Event: ${event.eventId}`);
    console.log(`Space: ${event.spaceId}`);
    console.log(
      `Status: ${event.occupied ? 'OCCUPIED' : 'AVAILABLE'}`
    );
    console.log(`Occupied: ${summary.occupiedSpaces}`);
    console.log(`Available: ${summary.availableSpaces}`);
    console.log(`Occupancy: ${summary.occupancyPercentage}%`);
    console.log('Saved to DynamoDB');

    res.json({
      message: 'Parking event processed',
      event,
      summary,
      alertLevel: currentAlertLevel
    });
  } catch (error) {
    console.error('Error processing event:', error);

    res.status(500).json({
      error: 'Failed to process parking event'
    });
  }
});

app.get('/parking', (req, res) => {
  const summary = getParkingSummary();

  res.json({
    ...summary,
    alertLevel: currentAlertLevel,
    spaces: parkingSpaces
  });
});

// Check periodically for sensors that stopped sending data.
setInterval(async () => {
  const now = Date.now();

  for (const [spaceId, space] of Object.entries(parkingSpaces)) {
    if (!space.lastUpdated) {
      continue;
    }

    const lastSeen = new Date(space.lastUpdated).getTime();

    if (
      now - lastSeen > SENSOR_TIMEOUT &&
      space.sensorStatus !== 'offline'
    ) {
      space.sensorStatus = 'offline';

      console.log('--------------------------------');
      console.log(`Sensor ${spaceId} marked OFFLINE`);

      try {
        await db.send(
          new PutCommand({
            TableName: 'ParkingSpaces',
            Item: {
              spaceId,
              carParkId: 'CP01',
              occupied: space.occupied,
              sensorStatus: 'offline',
              sequenceNumber: space.sequenceNumber,
              lastUpdated: space.lastUpdated
            }
          })
        );
      } catch (error) {
        console.error(
          `Failed to update ${spaceId} sensor status:`,
          error.message
        );
      }
    }
  }
}, 10000);

app.listen(PORT, () => {
  console.log(`Occupancy Service running on port ${PORT}`);
  console.log('AWS Region: ap-southeast-2');
  console.log('Duplicate detection: enabled');
  console.log('Capacity alerts: enabled');
  console.log('Sensor health monitoring: enabled');
});
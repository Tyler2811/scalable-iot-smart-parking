const express = require('express');

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');

const app = express();

const PORT = 3001;
const TOTAL_SPACES = 10;

app.use(express.json());

const dynamoClient = new DynamoDBClient({
  region: 'ap-southeast-2'
});

const db = DynamoDBDocumentClient.from(dynamoClient);

const parkingSpaces = {};

for (let i = 1; i <= TOTAL_SPACES; i++) {
  const spaceId = `S${String(i).padStart(3, '0')}`;

  parkingSpaces[spaceId] = {
    occupied: false,
    sensorStatus: 'online',
    lastUpdated: null
  };
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

    parkingSpaces[event.spaceId] = {
      occupied: event.occupied,
      sensorStatus: event.sensorStatus || 'online',
      lastUpdated: event.timestamp
    };

    const occupiedSpaces = Object.values(parkingSpaces)
      .filter(space => space.occupied).length;

    const availableSpaces = TOTAL_SPACES - occupiedSpaces;

    const occupancyPercentage =
      Math.round((occupiedSpaces / TOTAL_SPACES) * 100);

    const summary = {
      carParkId: event.carParkId,
      totalSpaces: TOTAL_SPACES,
      occupiedSpaces,
      availableSpaces,
      occupancyPercentage
    };

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
        }
      })
    );

    await db.send(
      new PutCommand({
        TableName: 'ParkingSpaces',
        Item: {
          spaceId: event.spaceId,
          carParkId: event.carParkId,
          occupied: event.occupied,
          sensorStatus: event.sensorStatus || 'online',
          sequenceNumber: event.sequenceNumber,
          lastUpdated: event.timestamp
        }
      })
    );

    console.log('--------------------------------');
    console.log(`Event: ${event.eventId}`);
    console.log(`Space: ${event.spaceId}`);
    console.log(
      `Status: ${event.occupied ? 'OCCUPIED' : 'AVAILABLE'}`
    );
    console.log(`Occupied: ${occupiedSpaces}`);
    console.log(`Available: ${availableSpaces}`);
    console.log(`Occupancy: ${occupancyPercentage}%`);
    console.log('Saved to DynamoDB');

    res.json({
      message: 'Parking event processed',
      event,
      summary
    });
  } catch (error) {
    console.error('Error processing event:', error);

    res.status(500).json({
      error: 'Failed to process parking event'
    });
  }
});

app.get('/parking', (req, res) => {
  const occupiedSpaces = Object.values(parkingSpaces)
    .filter(space => space.occupied).length;

  const availableSpaces = TOTAL_SPACES - occupiedSpaces;

  res.json({
    carParkId: 'CP01',
    totalSpaces: TOTAL_SPACES,
    occupiedSpaces,
    availableSpaces,
    occupancyPercentage:
      Math.round((occupiedSpaces / TOTAL_SPACES) * 100),
    spaces: parkingSpaces
  });
});

app.listen(PORT, () => {
  console.log(`Occupancy Service running on port ${PORT}`);
  console.log('AWS Region: ap-southeast-2');
});
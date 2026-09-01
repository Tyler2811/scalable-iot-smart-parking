const express = require('express');

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');

const {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand
} = require('@aws-sdk/client-sqs');

const app = express();

const PORT = 3001;
const TOTAL_SPACES = 10;
const SENSOR_TIMEOUT = 60000;

const AWS_REGION =
  process.env.AWS_REGION || 'ap-southeast-2';

const SQS_QUEUE_URL =
  process.env.SQS_QUEUE_URL;

app.use(express.json());

const dynamoClient = new DynamoDBClient({
  region: AWS_REGION
});

const db = DynamoDBDocumentClient.from(dynamoClient);

const sqs = new SQSClient({
  region: AWS_REGION
});

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

  const availableSpaces =
    TOTAL_SPACES - occupiedSpaces;

  const occupancyPercentage =
    Math.round(
      (occupiedSpaces / TOTAL_SPACES) * 100
    );

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

function validateParkingEvent(event) {
  if (
    !event ||
    !event.eventId ||
    !event.carParkId ||
    !event.spaceId ||
    typeof event.occupied !== 'boolean' ||
    !event.timestamp
  ) {
    return 'Invalid parking event';
  }

  if (!parkingSpaces[event.spaceId]) {
    return 'Unknown parking space';
  }

  return null;
}

async function saveCapacityAlert(level, summary) {
  const timestamp = new Date().toISOString();

  const alert = {
    alertId: `CP01-${level}-${Date.now()}`,
    carParkId: 'CP01',
    alertType: 'CAPACITY',
    level,
    occupancyPercentage:
      summary.occupancyPercentage,
    occupiedSpaces: summary.occupiedSpaces,
    availableSpaces:
      summary.availableSpaces,
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
  console.log(
    `Occupancy: ${summary.occupancyPercentage}%`
  );
  console.log('Alert saved to DynamoDB');
  console.log('********************************');
}

async function processParkingEvent(event) {
  try {
    await db.send(
      new PutCommand({
        TableName: 'ParkingEvents',
        Item: {
          eventId: event.eventId,
          carParkId: event.carParkId,
          spaceId: event.spaceId,
          occupied: event.occupied,
          sensorStatus:
            event.sensorStatus || 'online',
          sequenceNumber:
            event.sequenceNumber || 0,
          timestamp: event.timestamp
        },
        ConditionExpression:
          'attribute_not_exists(eventId)'
      })
    );
  } catch (error) {
    if (
      error.name ===
      'ConditionalCheckFailedException'
    ) {
      console.log('--------------------------------');
      console.log(
        `Duplicate event ignored: ${event.eventId}`
      );

      return {
        duplicate: true,
        eventId: event.eventId
      };
    }

    throw error;
  }

  parkingSpaces[event.spaceId] = {
    occupied: event.occupied,
    sensorStatus:
      event.sensorStatus || 'online',
    sequenceNumber:
      event.sequenceNumber || 0,
    lastUpdated: event.timestamp
  };

  await db.send(
    new PutCommand({
      TableName: 'ParkingSpaces',
      Item: {
        spaceId: event.spaceId,
        carParkId: event.carParkId,
        occupied: event.occupied,
        sensorStatus:
          event.sensorStatus || 'online',
        sequenceNumber:
          event.sequenceNumber || 0,
        lastUpdated: event.timestamp
      }
    })
  );

  const summary = getParkingSummary();

  const newAlertLevel =
    getAlertLevel(
      summary.occupancyPercentage
    );

  if (newAlertLevel !== currentAlertLevel) {
    if (newAlertLevel !== 'NORMAL') {
      await saveCapacityAlert(
        newAlertLevel,
        summary
      );
    } else if (
      currentAlertLevel !== 'NORMAL'
    ) {
      console.log(
        'Capacity returned to normal'
      );
    }

    currentAlertLevel = newAlertLevel;
  }

  console.log('--------------------------------');
  console.log(`Event: ${event.eventId}`);
  console.log(`Space: ${event.spaceId}`);
  console.log(
    `Status: ${
      event.occupied
        ? 'OCCUPIED'
        : 'AVAILABLE'
    }`
  );
  console.log(
    `Occupied: ${summary.occupiedSpaces}`
  );
  console.log(
    `Available: ${summary.availableSpaces}`
  );
  console.log(
    `Occupancy: ${summary.occupancyPercentage}%`
  );
  console.log('Saved to DynamoDB');

  return {
    duplicate: false,
    event,
    summary,
    alertLevel: currentAlertLevel
  };
}

async function consumeMessages() {
  if (!SQS_QUEUE_URL) {
    console.error(
      'SQS_QUEUE_URL is not configured'
    );

    return;
  }

  console.log('SQS consumer started');

  while (true) {
    try {
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: SQS_QUEUE_URL,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 60
        })
      );

      const messages = result.Messages || [];

      for (const message of messages) {
        try {
          const event =
            JSON.parse(message.Body);

          const validationError =
            validateParkingEvent(event);

          if (validationError) {
            console.log(
              `Invalid SQS message discarded: ${validationError}`
            );

            await sqs.send(
              new DeleteMessageCommand({
                QueueUrl:
                  SQS_QUEUE_URL,
                ReceiptHandle:
                  message.ReceiptHandle
              })
            );

            continue;
          }

          await processParkingEvent(event);

          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: SQS_QUEUE_URL,
              ReceiptHandle:
                message.ReceiptHandle
            })
          );

          console.log(
            `SQS message processed and deleted: ${event.eventId}`
          );
        } catch (error) {
          console.error(
            'Failed to process SQS message:',
            error.message
          );
        }
      }
    } catch (error) {
      console.error(
        'SQS receive error:',
        error.message
      );

      await new Promise(resolve =>
        setTimeout(resolve, 5000)
      );
    }
  }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'occupancy-service',
    messageQueue:
      SQS_QUEUE_URL
        ? 'configured'
        : 'not-configured'
  });
});

app.post('/events', async (req, res) => {
  try {
    const event = req.body;

    const validationError =
      validateParkingEvent(event);

    if (validationError) {
      return res.status(400).json({
        error: validationError
      });
    }

    if (!SQS_QUEUE_URL) {
      return res.status(500).json({
        error:
          'SQS queue is not configured'
      });
    }

    const result = await sqs.send(
      new SendMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MessageBody:
          JSON.stringify(event)
      })
    );

    console.log('--------------------------------');
    console.log(
      `Event queued: ${event.eventId}`
    );
    console.log(
      `SQS Message ID: ${result.MessageId}`
    );

    res.status(202).json({
      message: 'Parking event queued',
      eventId: event.eventId,
      messageId: result.MessageId
    });
  } catch (error) {
    console.error(
      'Error queueing event:',
      error
    );

    res.status(500).json({
      error:
        'Failed to queue parking event'
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

setInterval(async () => {
  const now = Date.now();

  for (
    const [spaceId, space]
    of Object.entries(parkingSpaces)
  ) {
    if (!space.lastUpdated) {
      continue;
    }

    const lastSeen =
      new Date(
        space.lastUpdated
      ).getTime();

    if (
      now - lastSeen >
        SENSOR_TIMEOUT &&
      space.sensorStatus !== 'offline'
    ) {
      space.sensorStatus = 'offline';

      console.log('--------------------------------');
      console.log(
        `Sensor ${spaceId} marked OFFLINE`
      );

      try {
        await db.send(
          new PutCommand({
            TableName:
              'ParkingSpaces',
            Item: {
              spaceId,
              carParkId: 'CP01',
              occupied:
                space.occupied,
              sensorStatus:
                'offline',
              sequenceNumber:
                space.sequenceNumber,
              lastUpdated:
                space.lastUpdated
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
  console.log(
    `Occupancy Service running on port ${PORT}`
  );
  console.log(
    `AWS Region: ${AWS_REGION}`
  );
  console.log(
    `Amazon SQS: ${
      SQS_QUEUE_URL
        ? 'enabled'
        : 'not configured'
    }`
  );
  console.log(
    'Duplicate detection: enabled'
  );
  console.log(
    'Capacity alerts: enabled'
  );
  console.log(
    'Sensor health monitoring: enabled'
  );

  consumeMessages();
});
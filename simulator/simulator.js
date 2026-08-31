const numberOfSpaces = 10;

const spaces = [];

for (let i = 1; i <= numberOfSpaces; i++) {
  spaces.push({
    spaceId: `S${String(i).padStart(3, '0')}`,
    occupied: false,
    sequenceNumber: 0
  });
}

console.log('Smart Parking Simulator Started');
console.log('Car Park: CP01');
console.log(`Parking Spaces: ${numberOfSpaces}`);
console.log('--------------------------------');

function generateParkingEvent() {
  const randomIndex = Math.floor(Math.random() * spaces.length);
  const space = spaces[randomIndex];

  space.occupied = !space.occupied;
  space.sequenceNumber++;

  const event = {
    eventId: `CP01-${space.spaceId}-${space.sequenceNumber}`,
    carParkId: 'CP01',
    spaceId: space.spaceId,
    occupied: space.occupied,
    sensorStatus: 'online',
    sequenceNumber: space.sequenceNumber,
    timestamp: new Date().toISOString()
  };

  console.log(event);
}

setInterval(generateParkingEvent, 3000);
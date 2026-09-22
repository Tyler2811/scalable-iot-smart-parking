\# Scalable IoT Smart Parking Management System



A scalable IoT smart parking system developed for SIT314. The project simulates parking sensors, processes parking events through an MQTT and cloud-based pipeline, stores parking data in AWS, and provides a web dashboard for monitoring parking occupancy and sensor status.



\## Architecture



The implemented system uses the following pipeline:



Node.js Parking Simulator  

→ MQTT / HiveMQ  

→ Node-RED Validation  

→ AWS ECS Occupancy Service  

→ Amazon SQS  

→ Event Processing  

→ Amazon DynamoDB  

→ REST API on AWS ECS  

→ Application Load Balancer  

→ Web Dashboard



\## Main Features



\- Simulates 10 IoT parking sensors (S001-S010).

\- Publishes parking events using MQTT.

\- Validates incoming events using Node-RED.

\- Queues events using Amazon SQS for asynchronous processing.

\- Stores parking spaces, events and alerts in Amazon DynamoDB.

\- Detects duplicate events.

\- Monitors sensor online/offline status.

\- Generates capacity alerts.

\- Provides REST API endpoints for parking data.

\- Displays live parking information through a web dashboard.

\- Runs containerised services using Docker and AWS ECS Fargate.

\- Uses an Application Load Balancer for API traffic distribution.

\- Supports ECS Service Auto Scaling from 1 to 3 API tasks.

\- Uses CloudWatch for application logging and monitoring.



\## Project Structure



```text

smart-parking-iot/

├── simulator/            # Node.js parking sensor simulator

├── occupancy-service/    # Event ingestion and SQS processing service

├── api-service/          # REST API

├── dashboard/            # Web dashboard

├── node-red/             # Exported Node-RED parking flow

├── aws/                  # AWS configuration files

├── docker-compose.yml

├── .gitignore

└── README.md


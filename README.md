# Storm Alert Service

The storm alert microservice for the R nineT Scrambler navigation tower implements the *Secret Law of Storms*
set of rules which can be found on [worldstormcentral.co](https://tinyurl.com/48cevfx6).

Data is collected from the MQTT topics `weather/pressure` and `weather/temperature` which is published by the
[Weather Station Service](https://github.com/sailingscally/r9t-weather).

Whenever there is an alert condition, the service will publish it to the MQTT topic `alarm/weather` which may
then be handled by other services. Please see the source code for the detailed format of the alert message.

## Barograph

The service will send the last 24 hours of barograph data (4 data points/hour - 15 minute intervals) to the
MQTT topic `weather/barograph` when requested.

To request barograph data send the message `{ fetch: true }` to the topic `storm/barograph`.

## Endpoints

This service provides the following restful endpoints:

- `/storm/barograph` - returns the last 24 hours of barometric readings (4 data points/hour)

## Dependencies

Persistent data storage for logging atmospheric pressure and temperature is done on a SQLite database and the
Node.JS module [sqlite3](https://www.npmjs.com/package/sqlite3) is used to access it.

The current version of **sqlite3** must be installed from the source on the Raspberry PI Zero and will take a
very long time to complete. To install the database engine and Node.JS module run:

```
sudo apt-get install sqlite3 libsqlite3-dev
npm install sqlite3 --build-from-source --sqlite=/usr/local
```

After installation, the SQLite database schema should be created by running the following command:

```
sqlite3 weather.db < weather.sql
```

## Running the Service

To run the service on system startup, the [PM2](https://pm2.keymetrics.io/) process manager for Node.JS
applications is used. It provides process monitoring capabilities which are great for this application.
To start the service run:

```
pm2 start app.js --name storm --watch --time --ignore-watch="weather.*" -- --port=3000
```

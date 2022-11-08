/*
 * Copyright 2022 Luis Martins <luis.martins@gmail.com>
 * 
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 */

const { WeatherAlert } = require('r9t-commons');

const mqtt = require('mqtt');
const sqlite3 = require('sqlite3');
const express = require('express');
const commons = require('r9t-commons');

const db = new sqlite3.Database('./weather.db');

const app = express();
app.listen(commons.arg('port'));

const data = {
  pressure: undefined,
  temperature: undefined
}

let connected = false;

/**
 * Returns the UNIX time in seconds (number of seconds since Jan 1, 1970 UTC).
 * Since JavaScript returns the number of milliseconds we need to divide by 1000.
 */
const time = () => {
  return Math.floor(Date.now() / 1000);
}

console.log('Starting R nineT storm alert service...');

const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: 'r9t-storm'
});

client.on('connect', () => {
  console.log('Connected to MQTT broker.');
  connected = true;

  client.options.reconnectPeriod = 1000;
  client.subscribe(['weather/pressure', 'weather/temperature', 'storm/barograph']);
});

client.on('close', () => {
  if(connected) {
    console.log('Connection to MQTT broker lost.');
    connected = false;
  }
});

client.on('message', async (topic, message) => {
  switch(topic) {
    case 'weather/temperature':
      data.temperature = parseFloat(message);
      break;
    case 'weather/pressure':
      data.pressure = parseFloat(message);
      break;
    case 'storm/barograph':
      const json = JSON.parse(message);

      if(json.fetch && connected) {
        client.publish('weather/barograph', JSON.stringify(await barograph()));
      }
      break;
  }

  if(data.pressure != undefined && data.temperature != undefined) {
    console.log('Storm [p/t]: ' + data.pressure.toFixed(1) + 'hPa / ' + data.temperature.toFixed(1) + 'º');

    db.run('insert into weather (date, pressure, temperature) values (?, ?, ?)',
        [time(), data.pressure, data.temperature], function(error) {
      if(error) {
        console.log(error);
      }

      data.pressure = undefined;
      data.temperature = undefined;
    });
  }
});

client.on('error', (error) => {
  switch(error.code) {
    case 'ECONNREFUSED':
       console.log(`Unable to connect to MQTT broker on ${error.address}:${error.port}.`);
      break;

    default:
      console.log(error);
      break;
  }
});

/**
 * Increase the time between connection attempts
 */
client.on('reconnect', () => {
  client.options.reconnectPeriod *= 2;
});

/**
 * Returns the atmospheric pressure logged n hours ago
 */
const query = (hours) => {
  const dt = time() - hours * 60 * 60; // now minus n hours

  return new Promise((resolve, reject) => {
    db.get('select pressure from weather where date > ? order by date limit 1;', [dt], (error, row) => {
      if(error) {
        reject(error);
      } else {
        resolve(row.pressure);
      }
    });
  });
}

/**
 * Returs the last atmospheric pressure and temperature logged to the database
 */
const last = () => {
  return new Promise((resolve, reject) => {
    db.get('select pressure, temperature from weather order by date desc limit 1;', [], (error, row) => {
      if(error) {
        reject(error);
      } else {
        resolve({ pressure: row.pressure, temperature: row.temperature });
      }
    });
  });
}

/**
 * Barometer rules taken from https://www.worldstormcentral.co/ (https://tinyurl.com/48cevfx6)
 *
 * Last 3 hours:
 *   - rise of 10 mb -> Gale
 *   - rise of 6 mb -> Strong Wind
 *   - rise of 1.1 to 2.7 mb and pressure > 1015 mb -> Poor Weather
 *   - drop of 1.1 to 2.7 mb and pressure < 1009 mb -> Rain and Wind
 *   - drop of 4 mb and pressure < 1009 mb -> Storm
 *   - drop of 4 mb and pressure > 1009 mb and < 1023 mb -> Rain and Wind
 *   - drop of 6 mb and pressure < 1009 mb -> Storm with Strong Wind
 *   - drop of 7 mb and pressure < 990 mb and temperature > 40º -> Firestorm
 *   - drop of 10 mb and pressure < 1009 mb -> Storm with Gale
 * Last 12 hours:
 *   - Drop of 8 mb and pressure < 1005 mb and storm conditions -> Severe Thunderstorm
 */
const alarm = (delta12h, delta3h, pressure, temperature) => {
  console.log('----------------------------');
  console.log('Delta 12h: ' + delta12h);
  console.log('Delta 3h: ' + delta3h);
  console.log('Pressure: ' + pressure);
  console.log('Temperature: ' + temperature);

  let alert = WeatherAlert.NONE;

  // the following rules could be written in a much more efficient way
  // I deliberately chose to write them in the most explicit way

  if(delta3h >= 10) {
    alert |= WeatherAlert.GALE;
  }
  if(delta3h >= 6) {
    alert |= WeatherAlert.STRONG_WIND;
  }
  if(delta3h >= 1.1 && delta3h <= 2.7 && pressure >= 1015) {
    alert |= WeatherAlert.POOR;
  }

  if(delta3h <= -1.1 && delta3h >= -2.7 && pressure <= 1009) {
    alert |= WeatherAlert.RAIN | WeatherAlert.WIND;
  }
  if(delta3h <= -4 && pressure <= 1009) {
    alert |= WeatherAlert.STORM;
  }
  if(delta3h <= -4 && pressure > 1009 && pressure <= 1023) {
    alert |= WeatherAlert.RAIN | WeatherAlert.WIND;
  }
  if(delta3h <= -6 && pressure <= 1009) {
    alert |= WeatherAlert.STORM | WeatherAlert.STRONG_WIND;
  }
  if(delta3h <= -7 && pressure <= 990 && temperature >= 40) {
    alert |= WeatherAlert.FIRESTORM;
  }
  if(delta3h <= -10 && pressure <= 1009) {
    alert |= WeatherAlert.STORM | WeatherAlert.GALE;
  }

  if(delta12h <= -8 && delta3h <= -4 && pressure <= 1005) {
    alert |= WeatherAlert.SEVERE_THUNDERSTORM;
  }

  console.log('Alert: 0b' + alert.toString(2).padStart(8, 0));
  console.log('----------------------------');

  return alert;
}

/**
 * Checks for an alert condition every 5 minutes
 */
setInterval(async () => {
  const h12 = await query(12);
  const h3 = await query(3);
  const now = await last();

  const alert = alarm(now.pressure - h12, now.pressure - h3, now.pressure, now.temperature);
  
  if(alert != 0 && connected) {
    client.publish('alarm/weather', alert.toString(2).padStart(8, 0));
  }  
}, 5 * 60 * 1000); // run every 5 minutes

/**
 * Deletes all weather logs older than 24 hours
 */
setInterval(async () => {
  const dt = time() - 24 * 60 * 60; // now minus 24 hours

  db.run('delete from weather where date < ?', [dt], function(error) {
    if(error) {
      console.log(error);
    }
  });
}, 60 * 60 * 1000); // run every hour

/**
 * Returns the last 24 hours of barometric readings (4 data points/hour) with all data points available
 * within each 15 minute interval averaged and rounded to one decimal place.
 *
 * The aggregation and filtering in this method could and should be done at the database level but I wanted
 * to learn how to work with the new map() and reduce() methods available in ES6.
 */
const barograph = () => {
  return new Promise((resolve, reject) => {
    db.all('select datetime(date, \'unixepoch\') as t, pressure as p from weather;', [], (error, rows) => {
      if(error) {
        reject(error);
      }
    
      const data = rows.map((row) => {
        row.t = row.t.substr(0, 13) + '/' + Math.floor(parseInt(row.t.substr(14, 2)) / 15);
        return row;
      })
    
      const aggregate = data.reduce((result, row) => {
        if(!result[row.t]) {
          result[row.t] = { time: row.t, sum: row.p, samples: 1 };
        } else {
          result[row.t].sum += row.p;
          result[row.t].samples ++;
        }
    
        return result;
      }, {});
    
      const list = Object.values(aggregate).map((point) => {
        const average = Math.round(10 * point.sum / point.samples) / 10.0;
        return { time: point.time.substr(11, 4), pressure: average };
      });
    
    
      // 24 hours @ 4 samples per hour = 96 samples
      const excess = list.length - 96;
      
      for(let i = 0;  i < excess; i ++) {
        list.shift(); // remove excess samples
      }

      resolve(list);
    });
  });
}

app.get('/storm/barograph', async (request, response) => {
  response.json(await barograph());
});

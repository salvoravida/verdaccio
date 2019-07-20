/* eslint-disable */

import { pad } from './utils';

import pino from 'pino';
import { fillInMsgTemplate } from './logger/parser';
import {calculateLevel, levels, subsystems} from "./logger/levels";

const loggerPino = pino();

// pino.destination('./log.text')

// loggerPino.info('hello world');

const cluster = require('cluster');
const Logger = require('bunyan');
const Error = require('http-errors');
const Stream = require('stream');
const { red, yellow, cyan, magenta, green, white } = require('kleur');
const pkgJSON = require('../../package.json');
const _ = require('lodash');
const dayjs = require('dayjs');


/**
 * A RotatingFileStream that modifes the message first
 */
class VerdaccioRotatingFileStream extends Logger.RotatingFileStream {
  // We depend on mv so that this is there
  write(obj) {
    const msg = fillInMsgTemplate(obj.msg, obj, false);
    super.write(JSON.stringify({ ...obj, msg }, Logger.safeCycles()) + '\n');
  }
}

let logger;

/**
 * Setup the Buyan logger
 * @param {*} logs list of log configuration
 */
function setup(logs) {
  const streams = [];
  if (logs == null) {
    logs = [{ type: 'stdout', format: 'pretty', level: 'http' }];
  }

  logs.forEach(function(target) {
    let level = target.level || 35;
    if (level === 'http') {
      level = 35;
    }

    // create a stream for each log configuration
    if (target.type === 'rotating-file') {
      if (target.format !== 'json') {
        throw new Error('Rotating file streams only work with JSON!');
      }
      if (cluster.isWorker) {
        // https://github.com/trentm/node-bunyan#stream-type-rotating-file
        throw new Error('Cluster mode is not supported for rotating-file!');
      }

      const stream = new VerdaccioRotatingFileStream(
        // @ts-ignore
        _.merge(
          {},
          // Defaults can be found here: https://github.com/trentm/node-bunyan#stream-type-rotating-file
          target.options || {},
          { path: target.path, level }
        )
      );

      streams.push({
        // @ts-ignore
        type: 'raw',
        // @ts-ignore
        level,
        // @ts-ignore
        stream,
      });
    } else {
      const stream = new Stream();
      stream.writable = true;

      let destination;
      let destinationIsTTY = false;
      if (target.type === 'file') {
        // destination stream
        destination = require('fs').createWriteStream(target.path, { flags: 'a', encoding: 'utf8' });
        destination.on('error', function(err) {
          stream.emit('error', err);
        });
      } else if (target.type === 'stdout' || target.type === 'stderr') {
        destination = target.type === 'stdout' ? process.stdout : process.stderr;
        destinationIsTTY = destination.isTTY;
      } else {
        throw Error('wrong target type for a log');
      }

      if (target.format === 'pretty') {
        // making fake stream for pretty printing
        stream.write = obj => {
          destination.write(`${print(obj.level, obj.msg, obj, destinationIsTTY)}\n`);
        };
      } else if (target.format === 'pretty-timestamped') {
        // making fake stream for pretty printing
        stream.write = obj => {
          destination.write(`[${dayjs(obj.time).format('YYYY-MM-DD HH:mm:ss')}] ${print(obj.level, obj.msg, obj, destinationIsTTY)}\n`);
        };
      } else {
        stream.write = obj => {
          const msg = fillInMsgTemplate(obj.msg, obj, destinationIsTTY);
          destination.write(`${JSON.stringify({ ...obj, msg }, Logger.safeCycles())}\n`);
        };
      }

      streams.push({
        // @ts-ignore
        type: 'raw',
        // @ts-ignore
        level,
        // @ts-ignore
        stream: stream,
      });
    }
  });

  // buyan default configuration
  logger = new Logger({
    name: pkgJSON.name,
    streams: streams,
    serializers: {
      err: Logger.stdSerializers.err,
      req: Logger.stdSerializers.req,
      res: Logger.stdSerializers.res,
    },
  });

  process.on('SIGUSR2', function() {
    Logger.reopenFileStreams();
  });
}

// adopted from socket.io
// this part was converted to coffee-script and back again over the years,
// so it might look weird

let max = 0;
for (const l in levels) {
  if (Object.prototype.hasOwnProperty.call(levels, l)) {
    max = Math.max(max, l.length);
  }
}

/**
 * Apply colors to a string based on level parameters.
 * @param {*} type
 * @param {*} msg
 * @param {*} obj
 * @param {*} colors
 * @return {String}
 */
  function print(type, msg, obj, colors) {
  if (typeof type === 'number') {
    type = calculateLevel(type);
  }
  const finalMessage = fillInMsgTemplate(msg, obj, colors);



  const sub = subsystems[colors ? 0 : 1][obj.sub] || subsystems[+!colors].default;
  if (colors) {
    return ` ${levels[type](pad(type, max))}${white(`${sub} ${finalMessage}`)}`;
  } else {
    return ` ${pad(type, max)}${sub} ${finalMessage}`;
  }
}

export { setup, logger };
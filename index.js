'use strict';
const { getHandler } = require('./resources');

const enableLoggingDebug = process.env.EnableLoggingDebug === 'true';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

exports.handler = async (event, context) => {
  enableLoggingDebug && console.debug('Running event: ', JSON.stringify(event));
  let returnValue = {};

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    const resourceHandler = await getHandler(event);
    returnValue = await resourceHandler(event, context);
  } catch (e) {
    console.error('Error trapped', e);
    returnValue = {
      statusCode: e.statusCode || 500,
      body: JSON.stringify({ error: e.message || 'Internal Server Error' }),
      headers: CORS_HEADERS
    };
  }

  // Ensure CORS headers are always included
  returnValue.headers = {
    ...(returnValue.headers || {}),
    ...CORS_HEADERS
  };

  enableLoggingDebug && console.debug('Returning: ', JSON.stringify(returnValue));
  return returnValue;
};

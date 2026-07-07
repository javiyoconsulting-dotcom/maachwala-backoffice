const http = require('node:http');
const { triggerGithubDispatch } = require('./githubDispatch');
const { createOrganization } = require('./organizationRepository');

const MAX_BODY_BYTES = 1024 * 1024;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendNoContent(res, statusCode = 204) {
  res.writeHead(statusCode, CORS_HEADERS);
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;

      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body.trim()) {
        reject(Object.assign(new Error('Request body is required'), { statusCode: 400 }));
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 }));
      }
    });

    req.on('error', reject);
  });
}

function validateOnboardOrgPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['Request body must be a JSON object'];
  }

  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    errors.push('name must be a non-empty string');
  }

  if (!Number.isInteger(payload.headcount) || payload.headcount < 0) {
    errors.push('headcount must be a non-negative integer');
  }

  if (typeof payload.businessregion !== 'number' || !Number.isFinite(payload.businessregion)) {
    errors.push('businessregion must be a number');
  }

  if (typeof payload.businesstype !== 'number' || !Number.isFinite(payload.businesstype)) {
    errors.push('businesstype must be a number');
  }

  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    errors.push('data must be an object');
    return errors;
  }

  if (typeof payload.data.owner !== 'string' || payload.data.owner.trim().length === 0) {
    errors.push('data.owner must be a non-empty string');
  }

  const ownerPhoneType = typeof payload.data.ownerphone;
  if (ownerPhoneType !== 'number' && ownerPhoneType !== 'string') {
    errors.push('data.ownerphone must be a number or string');
  }

  return errors;
}

function normalizeOrganizationPayload(payload) {
  return {
    name: payload.name.trim(),
    headcount: payload.headcount,
    businessregion: payload.businessregion,
    businesstype: payload.businesstype,
    data: {
      owner: payload.data.owner.trim(),
      ownerphone: payload.data.ownerphone,
    },
  };
}

async function handleOnboardOrg(req, res, repository) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    sendJson(res, 415, { error: 'Content-Type must be application/json' });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const validationErrors = validateOnboardOrgPayload(payload);

    if (validationErrors.length > 0) {
      sendJson(res, 400, {
        error: 'Invalid request payload',
        details: validationErrors,
      });
      return;
    }

    const organization = await repository.createOrganization(normalizeOrganizationPayload(payload));
    sendJson(res, 201, {
      message: 'Organization onboarded successfully',
      organization,
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Internal server error',
    });
  }
}

function decodePubSubMessage(pubSubBody) {
  if (!pubSubBody || typeof pubSubBody !== 'object' || Array.isArray(pubSubBody)) {
    throw Object.assign(new Error('Pub/Sub push body must be a JSON object'), { statusCode: 400 });
  }

  if (!pubSubBody.message || typeof pubSubBody.message !== 'object') {
    throw Object.assign(new Error('Pub/Sub message is required'), { statusCode: 400 });
  }

  const encodedData = pubSubBody.message.data;
  let decodedData;

  if (typeof encodedData === 'string' && encodedData.length > 0) {
    const decodedText = Buffer.from(encodedData, 'base64').toString('utf8');

    try {
      decodedData = JSON.parse(decodedText);
    } catch (error) {
      decodedData = decodedText;
    }
  }

  return {
    messageId: pubSubBody.message.messageId || pubSubBody.message.message_id,
    publishTime: pubSubBody.message.publishTime || pubSubBody.message.publish_time,
    attributes: pubSubBody.message.attributes || {},
    data: decodedData,
    subscription: pubSubBody.subscription,
  };
}

function extractOrgId(pubSubEvent) {
  const data = pubSubEvent.data && typeof pubSubEvent.data === 'object' ? pubSubEvent.data : {};
  const attributes = pubSubEvent.attributes || {};
  const orgid = data.orgid || data.orgId || data.org_id || attributes.orgid || attributes.orgId || attributes.org_id;

  if (orgid === undefined || orgid === null || String(orgid).trim().length === 0) {
    throw Object.assign(new Error('Pub/Sub message must include orgid'), { statusCode: 400 });
  }

  return String(orgid).trim();
}

async function handleCreateDdlPubSub(req, res, dispatchTerraformPipeline) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    sendJson(res, 415, { error: 'Content-Type must be application/json' });
    return;
  }

  let pubSubEvent;
  let orgid;

  try {
    const payload = await readJsonBody(req);
    pubSubEvent = decodePubSubMessage(payload);
    orgid = extractOrgId(pubSubEvent);

    await dispatchTerraformPipeline({
      source: 'pubsub',
      topic: 'BACKOFFICE_CREATEORG_CREATEDDL',
      subscription: pubSubEvent.subscription || 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
      orgid,
      messageId: pubSubEvent.messageId,
      publishTime: pubSubEvent.publishTime,
      attributes: pubSubEvent.attributes,
      data: pubSubEvent.data,
    });

    sendJson(res, 202, {
      message: 'Terraform DDL pipeline trigger accepted',
      orgid,
      pubsubMessageId: pubSubEvent.messageId,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'Failed to process /backoffice/createddl/pubsub request',
        error: error.message,
        statusCode: error.statusCode || 500,
        details: error.details,
        orgid,
        pubsubMessageId: pubSubEvent && pubSubEvent.messageId,
        subscription: pubSubEvent && pubSubEvent.subscription,
        stack: error.stack,
      }),
    );

    sendJson(res, error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Internal server error',
    });
  }
}

function createApp(options = {}) {
  const repository = options.repository || { createOrganization };
  const dispatchTerraformPipeline = options.dispatchTerraformPipeline || triggerGithubDispatch;

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      sendNoContent(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/backoffice/onboardorg') {
      handleOnboardOrg(req, res, repository);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/backoffice/createddl/pubsub') {
      handleCreateDdlPubSub(req, res, dispatchTerraformPipeline);
      return;
    }

    sendJson(res, 404, { error: 'Route not found' });
  });
}

module.exports = {
  createApp,
  decodePubSubMessage,
  extractOrgId,
  validateOnboardOrgPayload,
  normalizeOrganizationPayload,
};

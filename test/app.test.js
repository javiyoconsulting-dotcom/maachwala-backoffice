const assert = require('node:assert/strict');
const test = require('node:test');
const { createApp, decodePubSubMessage, validateOnboardOrgPayload } = require('../src/app');
const { mapOrganizationToContractedOrg } = require('../src/organizationRepository');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port));
  });
}

test('valid onboard organization request returns 201', async () => {
  const savedOrganizations = [];
  const repository = {
    async createOrganization(organization) {
      savedOrganizations.push(organization);
      return {
        id: 1,
        name: organization.name,
        usercount: organization.headcount,
        businessregion: organization.businessregion,
        businesstype: organization.businesstype,
        status: true,
        data: organization.data,
        number: 1783123456789,
        createdAt: '2026-07-04T00:00:00.000Z',
      };
    },
  };
  const server = createApp({ repository });
  const port = await listen(server);

  try {
    const response = await fetch(`http://localhost:${port}/backoffice/onboardorg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'demo',
        headcount: 4,
        businessregion: 1,
        businesstype: 2,
        data: {
          owner: 'name',
          ownerphone: 9875352512,
        },
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(body.message, 'Organization onboarded successfully');
    assert.equal(body.organization.name, 'demo');
    assert.equal(body.organization.usercount, 4);
    assert.equal(body.organization.businessregion, 1);
    assert.equal(body.organization.businesstype, 2);
    assert.equal(body.organization.status, true);
    assert.equal(body.organization.data.owner, 'name');
    assert.deepEqual(savedOrganizations, [
      {
        name: 'demo',
        headcount: 4,
        businessregion: 1,
        businesstype: 2,
        data: {
          owner: 'name',
          ownerphone: 9875352512,
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('preflight request returns CORS headers', async () => {
  const server = createApp();
  const port = await listen(server);

  try {
    const response = await fetch(`http://localhost:${port}/backoffice/onboardorg`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');
    assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type,Authorization');
  } finally {
    server.close();
  }
});

test('createddl Pub/Sub endpoint triggers Terraform dispatch', async () => {
  const dispatches = [];
  const server = createApp({
    async dispatchTerraformPipeline(payload) {
      dispatches.push(payload);
    },
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://localhost:${port}/backoffice/createddl/pubsub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          messageId: 'message-1',
          publishTime: '2026-07-07T00:00:00Z',
          attributes: {
            reason: 'createorg-ddl',
          },
          data: Buffer.from(JSON.stringify({ requestedBy: 'pubsub-test' })).toString('base64'),
        },
        subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.message, 'Terraform DDL pipeline trigger accepted');
    assert.deepEqual(dispatches, [
      {
        source: 'pubsub',
        topic: 'BACKOFFICE_CREATEORG_CREATEDDL',
        subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
        messageId: 'message-1',
        publishTime: '2026-07-07T00:00:00Z',
        attributes: {
          reason: 'createorg-ddl',
        },
        data: {
          requestedBy: 'pubsub-test',
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('decodes Pub/Sub message data as JSON when possible', () => {
  const decoded = decodePubSubMessage({
    message: {
      message_id: 'message-2',
      data: Buffer.from(JSON.stringify({ action: 'apply-ddl' })).toString('base64'),
    },
    subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
  });

  assert.deepEqual(decoded, {
    messageId: 'message-2',
    publishTime: undefined,
    attributes: {},
    data: {
      action: 'apply-ddl',
    },
    subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
  });
});

test('payload validation reports missing required fields', () => {
  const errors = validateOnboardOrgPayload({
    name: '',
    headcount: -1,
    businessregion: 'north',
    data: {},
  });

  assert.deepEqual(errors, [
    'name must be a non-empty string',
    'headcount must be a non-negative integer',
    'businessregion must be a number',
    'businesstype must be a number',
    'data.owner must be a non-empty string',
    'data.ownerphone must be a number or string',
  ]);
});

test('maps organization input to contractedorg row with 13 digit number', () => {
  const before = Date.now();
  const row = mapOrganizationToContractedOrg({
    name: 'demo',
    headcount: 4,
    businessregion: 1,
    businesstype: 2,
    data: {
      owner: 'name',
      ownerphone: 9875352512,
    },
  });
  const after = Date.now();

  assert.equal(row.name, 'demo');
  assert.equal(row.usercount, 4);
  assert.equal(row.businessregion, 1);
  assert.equal(row.businesstype, 2);
  assert.equal(row.status, true);
  assert.deepEqual(row.data, {
    owner: 'name',
    ownerphone: 9875352512,
  });
  assert.equal(Number.isInteger(row.number), true);
  assert.equal(String(row.number).length, 13);
  assert.equal(row.number >= before, true);
  assert.equal(row.number <= after, true);
});
